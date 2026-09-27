import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

type Result = { data: unknown; error: unknown }
const results: Record<string, Result[]> = {}
const updates: { table: string; payload: Record<string, unknown> }[] = []
const selects: { table: string; columns: string }[] = []
function makeBuilder(table: string) {
  const b: Record<string, unknown> = {}
  let values: Record<string, unknown> | undefined
  let id: unknown
  for (const m of ['eq', 'in', 'is', 'order', 'limit', 'lt', 'lte', 'single']) b[m] = () => b
  b.eq = (key: string, value: unknown) => { if (key === 'id') id = value; return b }
  b.select = (columns: string) => { selects.push({ table, columns }); return b }
  b.update = (payload: Record<string, unknown>) => { values = payload; return b }
  b.then = (resolve: (r: Result) => void) => {
    if (table === 'tuition_bill_queue' && values && id === undefined) return resolve(ok([]))
    if (values) updates.push({ table, payload: values })
    return resolve(results[table]?.shift() ?? { data: values && table === 'tuition_bill_queue' ? [{ id }] : null, error: null })
  }
  return b
}
const sendBill = vi.fn()
const destroyBill = vi.fn()
const resendBill = vi.fn()
const recordSentBill = vi.fn()
const bumpResendCount = vi.fn()
const audit = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => makeBuilder(table) } }))
vi.mock('@/lib/auth', () => ({ requireCronSecret: () => null }))
vi.mock('@/lib/schedule', () => ({ isBusinessHourKst: () => true }))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: (...args: unknown[]) => audit(...args) }))
vi.mock('@/lib/payssam', () => ({
  sendBill: (...args: unknown[]) => sendBill(...args),
  destroyBill: (...args: unknown[]) => destroyBill(...args),
  resendBill: (...args: unknown[]) => resendBill(...args),
}))
vi.mock('@/lib/billHistory', () => ({
  recordSentBill: (...args: unknown[]) => recordSentBill(...args),
  bumpResendCount: (...args: unknown[]) => bumpResendCount(...args),
}))
import { GET } from '@/app/api/cron/send-queued/route'
const QUEUE = 'tuition_bill_queue'
const HISTORY = 'tuition_bill_history'
const ok = (data: unknown): Result => ({ data, error: null })
const base = { id: 'q1', student_id: 's1', student_name: '학생', billing_month: '2026-09', phone: '01012345678', is_regular_tuition: false, bill_type: 'regular', bill_note: '특강', retry_count: 0 }
function queue(send_type: string, overrides: Record<string, unknown> = {}) {
  results[QUEUE] = [ok([]), ok([{ ...base, send_type, payload: { amount: 100000, amounts: [50000, 50000], persist: false, productName: '기존 상품명', message: '기존 메시지', oldBillId: 'old', billId: 'old' }, ...overrides }]), ok([{ id: 'q1' }])]
}
const call = () => GET({} as NextRequest)
const queueUpdates = () => updates.filter(u => u.table === QUEUE).map(u => u.payload)
beforeEach(() => {
  for (const key of Object.keys(results)) delete results[key]
  updates.length = 0
  selects.length = 0
  sendBill.mockReset().mockResolvedValue({ code: '0000', bill_id: 'new' })
  destroyBill.mockReset().mockResolvedValue({ code: '0000' })
  resendBill.mockReset().mockResolvedValue({ code: '0000' })
  recordSentBill.mockReset().mockResolvedValue({ error: null })
  bumpResendCount.mockReset().mockResolvedValue({ error: null })
  audit.mockClear()
})

describe('예약 발송 저장 실패 감사 (#6)', () => {
  it.each(['single', 'reissue', 'split', 'resend'])('%s: DB 기록 실패를 감사하고 큐는 sent 유지', async type => {
    queue(type)
    results[HISTORY] = [ok(type === 'split' ? [] : { status: 'sent', resend_count: 2, bill_note: '특강', bill_type: 'regular' })]
    recordSentBill.mockResolvedValue({ error: { message: 'DB down' } })
    bumpResendCount.mockResolvedValue({ error: { message: 'DB down' } })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ sent: 1, retrying: 0, failed: 0 })
    expect(queueUpdates().at(-1)).toMatchObject({ status: 'sent' })
    expect(audit).toHaveBeenCalledWith('payment', 's1', 'update',
      '⚠️ 청구서 발송됨 but DB기록 실패: 학생 2026-09 — 중복발송 가드 사각, 수동확인 필요',
      { billId: type === 'resend' ? 'old' : 'new', error: 'DB down' })
    expect(audit.mock.calls.filter(args => String(args[3]).includes('DB기록 실패'))).toHaveLength(type === 'split' ? 2 : 1)
    expect(sendBill).toHaveBeenCalledTimes(type === 'resend' ? 0 : type === 'split' ? 2 : 1)
    if (type === 'resend') expect(bumpResendCount).toHaveBeenCalledWith('old', 2, expect.any(String))
  })
  it('정상 기록은 경고 없이 sent 유지', async () => {
    queue('single')
    await call()
    expect(recordSentBill).toHaveBeenCalledWith(expect.objectContaining({ amount: 100000, bill_note: '특강' }))
    expect(queueUpdates().at(-1)).toMatchObject({ status: 'sent' })
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('대상 청구서 조회 실패 (#7)', () => {
  it.each(['destroy', 'resend'])('%s 조회 장애는 cancelled 대신 pending 재시도', async type => {
    queue(type)
    results[HISTORY] = [{ data: null, error: { code: '08006', message: 'DB down' } }]
    const res = await call()
    expect(await res.json()).toMatchObject({ retrying: 1, skipped_duplicate: 0 })
    expect(queueUpdates().at(-1)).toMatchObject({ status: 'pending', retry_count: 1 })
    expect(destroyBill).not.toHaveBeenCalled()
    expect(resendBill).not.toHaveBeenCalled()
  })
  it.each(['destroy', 'resend'])('%s 실제 부재(PGRST116)는 기존대로 cancelled', async type => {
    queue(type)
    results[HISTORY] = [{ data: null, error: { code: 'PGRST116', message: 'no rows' } }]
    await call()
    expect(queueUpdates().at(-1)).toMatchObject({ status: 'cancelled' })
  })
  it.each(['destroy', 'resend'])('%s paid 상태 변동도 기존대로 cancelled', async type => {
    queue(type)
    results[HISTORY] = [ok({ status: 'paid' })]
    await call()
    expect(queueUpdates().at(-1)).toMatchObject({ status: 'cancelled' })
  })
})

describe('특강 예약과 정규 납부 분리 (#8)', () => {
  it('특강은 정규 납부가 있어도 발송된다', async () => {
    queue('single')
    results.tuition_payments = [ok([{ id: 'p1', method: 'cash', amount: 450000 }])]
    const res = await call()
    expect(await res.json()).toMatchObject({ sent: 1, skipped_duplicate: 0 })
    expect(sendBill).toHaveBeenCalledWith({ studentName: '학생', phone: '01012345678', amount: 100000, productName: '기존 상품명', message: '기존 메시지' })
    expect(selects.some(s => s.table === 'tuition_payments')).toBe(false)
  })
  it.each([true, null])('정규 여부 %s는 기존 납부 가드 유지', async regular => {
    queue('single', { is_regular_tuition: regular })
    results.tuition_payments = [ok([{ id: 'p1', method: 'cash', amount: 450000 }])]
    const res = await call()
    expect(await res.json()).toMatchObject({ sent: 0, skipped_duplicate: 1 })
    expect(sendBill).not.toHaveBeenCalled()
    expect(queueUpdates().at(-1)).toMatchObject({ status: 'cancelled' })
  })
})

describe('예약 재발행 연결정보 (#12)', () => {
  it('원 청구의 null 메모도 예약 사유로 대체하지 않는다', async () => {
    queue('reissue', { bill_note: '예전 예약 사유' })
    results[HISTORY] = [ok({ status: 'sent', bill_note: null, bill_type: 'regular' })]
    await call()
    expect(recordSentBill).toHaveBeenCalledWith(expect.objectContaining({ bill_note: null, bill_type: 'regular' }))
  })
  it('원본과 새 청구의 bill_note·bill_type을 보존한다', async () => {
    queue('reissue', { bill_note: '예전 예약 사유', bill_type: 'regular' })
    results[HISTORY] = [ok({ status: 'sent', bill_note: '9월 특강', bill_type: 'electives' })]
    await call()
    expect(selects.find(s => s.table === HISTORY)?.columns).toBe('status, bill_note, bill_type, supersedes_bill_id')
    expect(updates.find(u => u.table === HISTORY)?.payload).toMatchObject({ status: 'destroyed' })
    expect(updates.find(u => u.table === HISTORY)?.payload).not.toHaveProperty('bill_note')
    expect(recordSentBill).toHaveBeenCalledWith(expect.objectContaining({ bill_note: '9월 특강', bill_type: 'electives', amount: 100000, is_regular_tuition: false }))
    expect(audit).toHaveBeenCalledWith('payment', 's1', 'update', '수동 재발송 (예약)으로 파기', { billId: 'old' })
    expect(audit).toHaveBeenCalledWith('payment', 's1', 'update', '수동 재발송 (예약)', { oldBillId: 'old', billId: 'new' })
  })
  it('정산 청구서(supersedes) 재발행은 환불 링크를 승계한다', async () => {
    queue('reissue')
    results[HISTORY] = [ok({ status: 'sent', bill_note: '중도퇴원 정산', bill_type: 'regular', supersedes_bill_id: 'paid-old' })]
    await call()
    expect(recordSentBill).toHaveBeenCalledWith(expect.objectContaining({ bill_note: '중도퇴원 정산', supersedes_bill_id: 'paid-old' }))
  })
  it('일반 청구서 재발행은 supersedes_bill_id 를 넣지 않는다', async () => {
    queue('reissue')
    results[HISTORY] = [ok({ status: 'sent', bill_note: null, bill_type: 'regular', supersedes_bill_id: null })]
    await call()
    expect(recordSentBill.mock.calls[0][0]).not.toHaveProperty('supersedes_bill_id')
  })
  it('기존 청구서 조회 장애(PGRST116 외)는 파기·발송 없이 보류한다', async () => {
    queue('reissue')
    results[HISTORY] = [{ data: null, error: { code: 'XX000', message: 'DB down' } }]
    await call()
    expect(destroyBill).not.toHaveBeenCalled()
    expect(sendBill).not.toHaveBeenCalled()
    expect(queueUpdates().at(-1)).toMatchObject({ status: 'pending' })
  })
})

describe('perf #6 발송 결과 불명확은 자동 재시도 금지', () => {
  it.each(['single', 'reissue', 'split'])('%s sendBill throw → failed, retry 없음, 수동확인 감사', async type => {
    queue(type)
    results[HISTORY] = [ok(type === 'split' ? [] : { status: 'sent' })]
    sendBill.mockRejectedValue(new Error('PaySsam API timeout 20ms /if/bill/send'))
    const res = await call()
    expect(await res.json()).toMatchObject({ failed: 1, retrying: 0 })
    expect(queueUpdates().at(-1)).toMatchObject({ status: 'failed' })
    expect(audit.mock.calls.some(a => String(a[3]).includes('발송 결과 불명확 — 결제선생에서 실발송 여부 확인 후 수동 처리'))).toBe(true)
    expect(queueUpdates().some(u => u.status === 'pending')).toBe(false)
  })
  it.each(['single', 'reissue', 'split'])('%s 확정 실패 9999 → 기존 pending+retry_count', async type => {
    queue(type)
    results[HISTORY] = [ok(type === 'split' ? [] : { status: 'sent' })]
    sendBill.mockResolvedValue({ code: '9999', msg: '확정 거절' })
    const res = await call()
    expect(await res.json()).toMatchObject({ failed: 0, retrying: 1 })
    expect(queueUpdates().at(-1)).toMatchObject({ status: 'pending', retry_count: 1 })
  })
  it.each(['destroy', 'resend', 'reissue'])('%s 발송 전 파기·동일 bill_id 재알림 throw는 재시도 유지', async type => {
    queue(type)
    results[HISTORY] = [ok({ status: 'sent', resend_count: 0 })]
    destroyBill.mockRejectedValue(new Error('HTTP 502'))
    resendBill.mockRejectedValue(new Error('HTTP 502'))
    const res = await call()
    expect(await res.json()).toMatchObject({ failed: 0, retrying: 1 })
    expect(queueUpdates().at(-1)).toMatchObject({ status: 'pending', retry_count: 1 })
    expect(sendBill).not.toHaveBeenCalled()
  })
  it.each(['throw', '9999'])('분할 부분성공 후 %s는 원본 보존·noRetry 유지', async failure => {
    queue('split')
    results[HISTORY] = [ok([{ bill_id: 'old', status: 'sent', amount: 100000, is_regular_tuition: true }])]
    sendBill.mockResolvedValueOnce({ code: '0000', bill_id: 'part1' })
    if (failure === 'throw') sendBill.mockRejectedValueOnce(new Error('HTTP 502'))
    else sendBill.mockResolvedValueOnce({ code: '9999', msg: '확정 거절' })
    const res = await call()
    expect(await res.json()).toMatchObject({ failed: 1, retrying: 0 })
    expect(recordSentBill).toHaveBeenCalledTimes(1)
    expect(destroyBill).not.toHaveBeenCalled()
    expect(queueUpdates().at(-1)).toMatchObject({ status: 'failed' })
    if (failure === 'throw') expect(audit.mock.calls.some(a => String(a[3]).includes('발송 결과 불명확'))).toBe(true)
  })
})
