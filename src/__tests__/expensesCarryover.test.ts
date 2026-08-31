/**
 * 고정비 승계 마커 고아 + billing_month 무검증 (2026-08-16 라인리뷰)
 *
 * 마커(academy_finance_months) insert 성공 뒤 prev/toCopy 조회 error를 버리면 복사 없이 빠져나가고,
 * 다음 요청부터 23505로 복사 블록을 건너뛰어 그 달 고정비 승계가 영구 누락된다.
 * → 어느 단계가 실패하든 마커를 롤백(delete)해야 다음 요청이 재시도할 수 있다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type MockResult = { data: unknown; error: unknown }
const results: Record<string, MockResult[]> = {}
const inserts: { table: string; row: unknown }[] = []
const deletes: string[] = []

function makeBuilder(table: string) {
  const b: Record<string, unknown> = {}
  const result = () => results[table]?.shift() ?? { data: null, error: null }
  for (const m of ['select', 'eq', 'lt', 'order', 'limit']) b[m] = () => b
  b.insert = (row: unknown) => {
    inserts.push({ table, row })
    return b
  }
  b.delete = () => {
    deletes.push(table)
    return b
  }
  b.single = async () => result()
  b.then = (resolve: (v: MockResult) => void) => resolve(result())
  return b
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }))
vi.mock('@/lib/auth', () => ({ requireAdminSession: vi.fn(() => null) }))

import { GET } from '@/app/api/expenses/route'

const OK: MockResult = { data: null, error: null }
const FAIL: MockResult = { data: null, error: { message: 'DB down' } }
const MARKER = 'academy_finance_months'
const EXPENSES = 'academy_expenses'
const req = (month: string) => ({ url: `http://x/api/expenses?billing_month=${month}` }) as Request

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k]
  inserts.length = 0
  deletes.length = 0
})

describe('expenses GET 고정비 승계', () => {
  it('이전 월 조회 실패 시 마커 롤백 (승계 영구 누락 방지)', async () => {
    results[MARKER] = [OK] // 마커 insert 성공
    results[EXPENSES] = [FAIL, { data: [], error: null }] // prev 조회 실패, 최종 목록 조회

    const res = await GET(req('2026-08'))

    expect(res.status).toBe(200)
    expect(deletes).toEqual([MARKER])
    expect(inserts.filter(i => i.table === EXPENSES)).toHaveLength(0)
  })

  it('복사 대상 조회 실패 시 마커 롤백', async () => {
    results[MARKER] = [OK]
    results[EXPENSES] = [
      { data: [{ billing_month: '2026-07' }], error: null }, // prev
      FAIL, // toCopy 조회 실패
      { data: [], error: null }, // 최종 목록
    ]

    await GET(req('2026-08'))

    expect(deletes).toEqual([MARKER])
    expect(inserts.filter(i => i.table === EXPENSES)).toHaveLength(0)
  })

  it('복사 insert 실패도 마커 롤백 (기존 동작 유지)', async () => {
    results[MARKER] = [OK]
    results[EXPENSES] = [
      { data: [{ billing_month: '2026-07' }], error: null },
      { data: [{ category: 'fixed', name: '월세', amount: 100, memo: null }], error: null },
      FAIL, // 복사 insert 실패
      { data: [], error: null },
    ]

    await GET(req('2026-08'))

    expect(deletes).toEqual([MARKER])
  })

  it('정상 경로: 이전 월 고정비를 복사하고 마커는 유지', async () => {
    results[MARKER] = [OK]
    results[EXPENSES] = [
      { data: [{ billing_month: '2026-07' }], error: null },
      { data: [{ category: 'fixed', name: '월세', amount: 100, memo: null }], error: null },
      OK, // 복사 insert 성공
      { data: [], error: null },
    ]

    await GET(req('2026-08'))

    expect(deletes).toEqual([])
    const copied = inserts.filter(i => i.table === EXPENSES)
    expect(copied).toHaveLength(1)
    expect((copied[0].row as { billing_month: string }[])[0].billing_month).toBe('2026-08')
  })

  it('billing_month 형식이 틀리면 400 — 마커 insert도 안 한다', async () => {
    const res = await GET(req('2026-8-1; drop'))

    expect(res.status).toBe(400)
    expect(inserts).toHaveLength(0)
  })
})
