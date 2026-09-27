import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

type Result = { data: unknown; error: unknown }
const results: Record<string, Result[]> = {}
const updates: { table: string; payload: Record<string, unknown>; filters: unknown[][] }[] = []
const inserts: { table: string; payload: Record<string, unknown> }[] = []
function makeBuilder(table: string) {
  const b: Record<string, unknown> = {}
  let update: typeof updates[number] | undefined
  for (const m of ['select', 'single', 'order']) b[m] = () => b
  for (const m of ['eq', 'in', 'filter']) b[m] = (...args: unknown[]) => { update?.filters.push([m, ...args]); return b }
  b.update = (payload: Record<string, unknown>) => { update = { table, payload, filters: [] }; updates.push(update); return b }
  b.insert = (payload: Record<string, unknown>) => { inserts.push({ table, payload }); return b }
  b.then = (resolve: (r: Result) => void) => resolve(results[table]?.shift() ?? { data: null, error: null })
  return b
}
const audit = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => makeBuilder(table) } }))
vi.mock('@/lib/auth', () => ({ requireAdminSession: () => null }))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: (...args: unknown[]) => audit(...args) }))
vi.mock('@/app/api/special/route', () => ({ SPECIAL_LABEL: '특강' }))
import { POST, DELETE } from '@/app/api/special/pay/route'
const QUEUE = 'tuition_bill_queue'
const HISTORY = 'tuition_bill_history'
const SPECIAL = 'tuition_special_payment'
const ok = (data: unknown): Result => ({ data, error: null })
const req = (body: unknown) => ({ json: async () => body } as NextRequest)
const queueUpdates = () => updates.filter(u => u.table === QUEUE)
beforeEach(() => {
  for (const key of Object.keys(results)) delete results[key]
  updates.length = 0
  inserts.length = 0
  audit.mockClear()
  results[SPECIAL] = [ok({ id: 'sp1', label: '9월 특강', amount: 100000 })]
})

describe('특강 현금수납 시 예약 발송 취소 (코드비판 ②)', () => {
  const body = { studentId: 's1', amount: 100000, method: 'cash', label: '9월 특강' }
  it('pending 예약 발송을 취소하고 payload 에 납부 id 를 남긴다', async () => {
    results[HISTORY] = [ok([])]
    results[QUEUE] = [ok([{ id: 'q1', payload: { amount: 100000, productName: '9월 특강' } }]), ok(null)]
    const res = await POST(req(body))
    expect(res.status).toBe(200)
    expect(await res.json()).not.toHaveProperty('destroyScheduleFailed')
    expect(queueUpdates()).toHaveLength(1)
    expect(queueUpdates()[0].payload).toMatchObject({ status: 'cancelled', payload: { amount: 100000, productName: '9월 특강', cancelledBySpecialPaymentId: 'sp1' } })
    expect(queueUpdates()[0].filters).toEqual(expect.arrayContaining([['eq', 'id', 'q1'], ['eq', 'status', 'pending']]))
  })
  it('예약 발송이 없으면 큐 UPDATE 없이 정상', async () => {
    results[HISTORY] = [ok([])]
    results[QUEUE] = [ok([])]
    const res = await POST(req(body))
    expect(res.status).toBe(200)
    expect(queueUpdates()).toHaveLength(0)
  })
  it('예약 조회 실패는 응답·감사로그로 표면화한다', async () => {
    results[HISTORY] = [ok([])]
    results[QUEUE] = [{ data: null, error: { message: 'DB down' } }]
    const res = await POST(req(body))
    expect(res.status).toBe(200)
    expect((await res.json()).destroyScheduleFailed).toContain('(예약 조회 실패)')
    expect(audit).toHaveBeenCalledWith('payment', 's1', 'update', expect.stringContaining('예약 발송 조회 실패'), expect.objectContaining({ error: 'DB down' }))
  })
  it('납부 취소(DELETE)는 취소했던 예약 발송을 복원한다', async () => {
    results[SPECIAL] = [ok(null)]
    results[QUEUE] = [ok([]), ok([{ id: 'q1' }])]
    const res = await DELETE(req({ id: 'sp1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, restoredSends: 1 })
    const restore = queueUpdates()[1]
    expect(restore.payload).toMatchObject({ status: 'pending' })
    expect(restore.filters).toEqual(expect.arrayContaining([['filter', 'payload->>cancelledBySpecialPaymentId', 'eq', 'sp1'], ['eq', 'status', 'cancelled']]))
  })
})
