/**
 * clearPaymentForBill 회귀 테스트 (2026-07-12 코드품질 감사 #6 — 돈 경로 테스트 공백)
 *
 * supabase 쿼리빌더를 체이닝 mock으로 대체해 세 갈래를 고정:
 *  1. 분할 누적 row(태그 2개+) 부분취소 → 금액 차감 + 해당 태그만 제거
 *  2. 단독 row 취소 → soft-delete (deleted_at 마킹, DELETE 아님)
 *  3. 태그 매칭 0건 → 레거시 무태그 row만 fallback soft-delete
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── supabase mock ────────────────────────────────────────────────
// from() 호출 순서대로 미리 큐에 넣은 결과를 돌려주는 체이닝 빌더.
type MockResult = { data: unknown; error: null }
const queue: MockResult[] = []
const calls: { table: string; op: string; payload?: unknown; filters: Record<string, unknown[]> }[] = []

function makeBuilder(table: string) {
  const call = { table, op: '', payload: undefined as unknown, filters: {} as Record<string, unknown[]> }
  calls.push(call)
  const result = () => queue.shift() ?? { data: null, error: null }
  const b: Record<string, unknown> = {}
  const chain = (name: string) => (...args: unknown[]) => {
    if (name === 'select' && !call.op) call.op = 'select'
    if (name === 'update') { call.op = 'update'; call.payload = args[0] }
    ;(call.filters[name] ??= []).push(args)
    return b
  }
  for (const m of ['select', 'update', 'eq', 'is', 'ilike', 'or', 'order', 'limit']) b[m] = chain(m)
  // await 가능하게 thenable
  b.then = (resolve: (v: MockResult) => void) => resolve(result())
  return b
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { clearPaymentForBill } from '@/lib/paymentCancel'

beforeEach(() => {
  queue.length = 0
  calls.length = 0
})

describe('clearPaymentForBill', () => {
  it('분할 누적 row는 해당 청구분만 차감하고 태그를 제거한다', async () => {
    // 47만 = 30만(bill:A) + 17만(bill:B) 누적 row에서 B만 취소
    queue.push({ data: [{ id: 'p1', amount: 470000, memo: '[bill:A][bill:B]' }], error: null }) // select
    queue.push({ data: null, error: null }) // update

    const n = await clearPaymentForBill('stu1', '2026-07', 'B', 170000)

    expect(n).toBe(1)
    const update = calls.find(c => c.op === 'update')!
    expect(update.payload).toEqual({ amount: 300000, memo: '[bill:A]' })
  })

  it('단독 row 취소는 soft-delete(deleted_at)만 하고 금액은 건드리지 않는다', async () => {
    queue.push({ data: [{ id: 'p1', amount: 470000, memo: '[bill:A]' }], error: null })
    queue.push({ data: null, error: null })

    const n = await clearPaymentForBill('stu1', '2026-07', 'A', 470000)

    expect(n).toBe(1)
    const update = calls.find(c => c.op === 'update')!
    const payload = update.payload as Record<string, unknown>
    expect(Object.keys(payload)).toEqual(['deleted_at'])
    expect(payload.deleted_at).toBeTruthy()
  })

  it('취소금액이 row 전액 이상이라도 분할태그 2개+ 면 차감(하한 0)+태그 제거만 한다', async () => {
    // 2026-08-13 라인리뷰 반전: 구 동작(soft-delete)은 다른 청구분([bill:A]) 납부 기록까지
    // 통째로 지웠다. 이상 데이터라도 0원 row 유지가 타 청구분 삭제보다 안전.
    queue.push({ data: [{ id: 'p1', amount: 170000, memo: '[bill:A][bill:B]' }], error: null })
    queue.push({ data: null, error: null })

    await clearPaymentForBill('stu1', '2026-07', 'B', 170000)

    const update = calls.find(c => c.op === 'update')!
    expect(update.payload).toEqual({ amount: 0, memo: '[bill:A]' })
  })

  it('태그 매칭 0건이면 레거시 무태그 row만 fallback soft-delete 한다', async () => {
    queue.push({ data: [], error: null }) // 태그 매칭 select → 0건
    queue.push({ data: [{ id: 'legacy1' }], error: null }) // 레거시 update ... select

    const n = await clearPaymentForBill('stu1', '2026-07', 'X', 100000)

    expect(n).toBe(1)
    const legacy = calls[1]
    expect(legacy.op).toBe('update')
    expect(Object.keys(legacy.payload as object)).toEqual(['deleted_at'])
    // 무태그 row만 노리는 or 필터가 걸려 있어야 함 (태그 있는 row 오폭 방지)
    const orArgs = legacy.filters.or as unknown[][] | undefined
    expect(orArgs?.[0]?.[0]).toBe('memo.is.null,memo.eq.')
  })

  it('매칭 row가 아예 없으면 0을 반환한다', async () => {
    queue.push({ data: [], error: null })
    queue.push({ data: [], error: null })

    const n = await clearPaymentForBill('stu1', '2026-07', 'X', 100000)
    expect(n).toBe(0)
  })
})

// 뮤테이션 드릴 2026-08-14: 차감 하한 0(Math.max)이 무보증이었다(M20 생존).
// 하한이 사라지면 이상 데이터(취소액 > row 금액)에서 납부액이 음수로 남아 정산·통계가 오염된다.
describe('clearPaymentForBill 차감 하한', () => {
  it('분할 누적 row에서 취소액이 row 금액을 넘어도 0원까지만 차감한다(음수 금지)', async () => {
    queue.push({ data: [{ id: 'p1', amount: 100000, memo: '[bill:A][bill:B]' }], error: null }) // select
    queue.push({ data: null, error: null }) // update

    const n = await clearPaymentForBill('stu1', '2026-07', 'B', 150000)

    expect(n).toBe(1)
    const update = calls.find(c => c.op === 'update')!
    expect(update.payload).toEqual({ amount: 0, memo: '[bill:A]' })
  })
})
