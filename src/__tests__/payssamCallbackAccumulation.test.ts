import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

type Result = { data: unknown; error: unknown }
const results: Record<string, Result[]> = {}
const updates: { table: string; payload: Record<string, unknown>; eq: unknown[][]; select?: string }[] = []
const inserts = vi.fn()
function makeBuilder(table: string) {
  const b: Record<string, unknown> = {}
  let update: typeof updates[number] | undefined
  for (const m of ['is', 'order', 'limit', 'single']) b[m] = () => b
  b.select = (columns: string) => { if (update) update.select = columns; return b }
  b.eq = (...args: unknown[]) => { update?.eq.push(args); return b }
  b.update = (payload: Record<string, unknown>) => { update = { table, payload, eq: [] }; updates.push(update); return b }
  b.insert = (payload: unknown) => { inserts(payload); return b }
  b.then = (resolve: (r: Result) => void) => resolve(results[table]?.shift() ?? { data: null, error: null })
  return b
}
const audit = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => makeBuilder(table) } }))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: (...args: unknown[]) => audit(...args) }))
vi.mock('@/lib/paymentCancel', () => ({ clearPaymentForBill: vi.fn() }))
vi.mock('@/lib/payssam', () => ({ cancelBill: vi.fn() }))
vi.mock('@/lib/solapi', () => ({ sendSms: vi.fn() }))
import { POST } from '@/app/api/payssam/callback/route'
const PAYMENTS = 'tuition_payments'
const ok = (data: unknown): Result => ({ data, error: null })
const month = (amount: number, memo = '[bill:first]') => ok([{ id: 'p1', amount, memo }])
const call = () => POST({ json: async () => ({ apikey: 'test-only', bill_id: 'second', appr_state: 'F', appr_price: '100000' }) } as NextRequest)
const paymentUpdates = () => updates.filter(u => u.table === PAYMENTS)
beforeEach(() => {
  vi.stubEnv('PAYSSAM_API_KEY', 'test-only')
  for (const key of Object.keys(results)) delete results[key]
  updates.length = 0
  inserts.mockClear()
  audit.mockClear()
  results.tuition_bill_history = [ok(null), ok({ student_id: 's1', amount: 100000, billing_month: '2026-09', is_regular_tuition: true })]
})
afterEach(() => vi.unstubAllEnvs())

describe('콜백 누적 CAS (#3)', () => {
  it('1회 충돌 후 최신 금액·태그 기준으로 성공', async () => {
    results[PAYMENTS] = [month(200000), ok([]), month(250000, '[bill:first][bill:third]'), ok([{ id: 'p1' }])]
    expect((await call()).status).toBe(200)
    expect(paymentUpdates()).toHaveLength(2)
    expect(paymentUpdates()[0]).toMatchObject({ payload: { amount: 300000 }, eq: [['id', 'p1'], ['amount', 200000]], select: 'id' })
    expect(paymentUpdates()[1]).toMatchObject({ payload: { amount: 350000, memo: '[bill:first][bill:third][bill:second]' }, eq: [['id', 'p1'], ['amount', 250000]], select: 'id' })
    expect(audit).not.toHaveBeenCalled()
    expect(inserts).not.toHaveBeenCalled()
  })
  it('충돌 후 같은 bill 태그가 생겼으면 재누적하지 않는다', async () => {
    results[PAYMENTS] = [month(200000), ok([]), month(300000, '[bill:first][bill:second]')]
    expect((await call()).status).toBe(200)
    expect(paymentUpdates()).toHaveLength(1)
    expect(inserts).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })
  it('최대 3회 재시도 후에도 충돌하면 기존 누적 실패 감사로그', async () => {
    results[PAYMENTS] = Array.from({ length: 4 }, () => [month(200000), ok([])]).flat()
    await call()
    expect(paymentUpdates()).toHaveLength(4)
    expect(results[PAYMENTS]).toHaveLength(0)
    expect(audit).toHaveBeenCalledWith('payment', 'p1', 'update', expect.stringContaining('⚠️ 콜백 납부 누적 실패:'), expect.objectContaining({ bill_id: 'second', paidAmount: 100000 }))
  })
  it('비경합은 기존 최종 금액 그대로, 1회 UPDATE', async () => {
    results[PAYMENTS] = [month(200000), ok([{ id: 'p1' }])]
    await call()
    expect(paymentUpdates()).toHaveLength(1)
    expect(paymentUpdates()[0].payload).toEqual({ amount: 300000, memo: '[bill:first][bill:second]' })
    expect(audit).not.toHaveBeenCalled()
  })
  it('1차 조회 실패도 새 납부를 삽입하지 않고 기록 실패로 남긴다', async () => {
    results[PAYMENTS] = [{ data: null, error: { message: 'DB down' } }]
    const res = await call()
    // 청구서는 paid 인데 납부 원장이 비었다 — 0000 을 주면 결제선생이 재전송하지 않아 영영 미기록 (2026-09-06 코드비판 ①)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: '9999' })
    expect(inserts).not.toHaveBeenCalled()
    expect(paymentUpdates()).toHaveLength(0)
    expect(audit).toHaveBeenCalledWith('payment', null, 'create', expect.stringContaining('콜백 납부 기록 실패'), expect.objectContaining({ error: 'DB down' }))
  })
  it('재조회 실패는 새 납부를 삽입하지 않고 누적 실패로 남긴다', async () => {
    results[PAYMENTS] = [month(200000), ok([]), { data: null, error: { message: 'DB down' } }]
    const res = await call()
    expect(res.status).toBe(500)
    expect(inserts).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith('payment', 'p1', 'update', expect.stringContaining('콜백 납부 누적 실패'), expect.objectContaining({ error: 'DB down' }))
  })
})

describe('납부 기록 실패 응답 (코드비판 ①)', () => {
  it('누적 UPDATE 실패는 9999 로 재전송 유도', async () => {
    results[PAYMENTS] = [month(200000), { data: null, error: { message: 'write fail' } }]
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: '9999' })
  })
  it('신규 INSERT 실패는 9999 로 재전송 유도', async () => {
    results[PAYMENTS] = [ok([]), { data: null, error: { message: 'insert fail' } }]
    const res = await call()
    expect(inserts).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: '9999' })
  })
  it('신규 INSERT 성공은 0000', async () => {
    results[PAYMENTS] = [ok([]), ok(null)]
    const res = await call()
    expect(inserts).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ code: '0000' })
  })
})
