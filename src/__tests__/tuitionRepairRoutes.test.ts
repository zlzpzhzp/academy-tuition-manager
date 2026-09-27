import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

type Result = { data: unknown; error: unknown }
const results: Record<string, Result[]> = {}
const writes: { table: string; method: string; payload: Record<string, unknown> }[] = []
const selects: { table: string; columns: string }[] = []
function makeBuilder(table: string) {
  const b: Record<string, unknown> = {}
  for (const m of ['eq', 'in', 'is', 'order', 'limit', 'gte', 'lte', 'single', 'maybeSingle', 'filter']) b[m] = () => b
  b.select = (columns: string) => { selects.push({ table, columns }); return b }
  for (const method of ['insert', 'update', 'upsert']) {
    b[method] = (payload: Record<string, unknown>) => { writes.push({ table, method, payload }); return b }
  }
  b.then = (resolve: (r: Result) => void) => resolve(results[table]?.shift() ?? { data: null, error: null })
  return b
}
const financeSession = vi.fn(() => false)
const sendBill = vi.fn()
const destroyBill = vi.fn()
const businessHour = vi.fn(() => true)
const audit = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => makeBuilder(table) } }))
vi.mock('@/lib/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAdminSession: () => null,
  hasFinanceSession: () => financeSession(),
}))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: (...args: unknown[]) => audit(...args), resolveAuditWarnings: async () => {} }))
vi.mock('@/lib/payssam', () => ({
  sendBill: (...args: unknown[]) => sendBill(...args),
  destroyBill: (...args: unknown[]) => destroyBill(...args),
  fetchPaySsamStatus: async () => 'sent',
}))
vi.mock('@/lib/schedule', () => ({
  isBusinessHourKst: () => businessHour(),
  nextBusinessSlot: () => new Date('2026-09-07T02:00:00Z'),
  formatKst: () => '9월 7일 11시',
}))
import { GET as grades } from '@/app/api/grades/route'
import { POST as teacherPost } from '@/app/api/teachers/route'
import { PUT as teacherPut } from '@/app/api/teachers/[id]/route'
import { PUT as paymentPut, DELETE as paymentDelete } from '@/app/api/payments/[id]/route'
import { POST as destroyRoute } from '@/app/api/payssam/destroy/route'
import { POST as studentPost } from '@/app/api/students/route'
import { POST as resettle } from '@/app/api/payssam/resettle/route'
import { POST as reissue } from '@/app/api/payssam/reissue/route'
import { defaultBillProductName } from '@/lib/billing-title'

const req = (body: unknown = {}) => ({ json: async () => body }) as NextRequest
const params = { params: Promise.resolve({ id: 'id1' }) }
const ok = (data: unknown): Result => ({ data, error: null })
const HISTORY = 'tuition_bill_history'
beforeEach(() => {
  for (const key of Object.keys(results)) delete results[key]
  writes.length = 0
  selects.length = 0
  financeSession.mockReturnValue(false)
  businessHour.mockReturnValue(true)
  sendBill.mockReset().mockResolvedValue({ code: '0000', bill_id: 'new-bill' })
  destroyBill.mockReset().mockResolvedValue({ code: '0000' })
  audit.mockClear()
})

describe('Finance PIN 응답 필드 보호 (#1)', () => {
  it.each([false, true])('grades 모든 중첩 teacher 경로: PIN=%s', async pin => {
    financeSession.mockReturnValue(pin)
    results.tuition_grades = [ok([{ id: 'g1', tuition_classes: [
      { id: 'c1', tuition_teachers: { id: 't1', name: '선생님', pay_ratio: 0.5 }, tuition_students: [] },
      { id: 'c2', tuition_teachers: null },
    ] }])]
    const res = await grades(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(JSON.stringify(body).includes('pay_ratio')).toBe(pin)
    expect(body[0].classes[0].teacher.name).toBe('선생님')
    expect(body[0].classes[1].teacher).toBeNull()
  })
  it.each(['POST', 'PUT'])('teachers %s: PIN 없으면 pay_ratio 제거', async method => {
    results.tuition_teachers = [ok({ id: 'id1', name: '선생님', pay_ratio: 0.5 })]
    const res = method === 'POST' ? await teacherPost(req({ name: '선생님' })) : await teacherPut(req({ name: '선생님' }), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'id1', name: '선생님' })
  })
  it.each(['POST', 'PUT'])('teachers %s: PIN 있으면 기존 배분율 유지', async method => {
    financeSession.mockReturnValue(true)
    results.tuition_teachers = [ok({ id: 'id1', name: '선생님', pay_ratio: 0.5 })]
    const res = method === 'POST' ? await teacherPost(req({ name: '선생님' })) : await teacherPut(req({ name: '선생님' }), params)
    expect((await res.json()).pay_ratio).toBe(0.5)
  })
})

describe('납부 메모 태그 보존 (#2)', () => {
  it.each(['변경 메모', '', '변경 메모[bill:임의태그]'])('사용자 메모 %s 수정 후 기존 태그 순서·개수 보존', async memo => {
    results.tuition_payments = [ok({ method: 'payssam', deleted_at: null, memo: '기존[bill:B2][bill:B1]' }), ok({ id: 'id1' })]
    const res = await paymentPut(req({ memo }), params)
    expect(res.status).toBe(200)
    const saved = writes.find(w => w.table === 'tuition_payments')!.payload.memo as string
    expect(saved.match(/\[bill:[^\]]+\]/g)).toEqual(['[bill:B2]', '[bill:B1]'])
    expect(saved).toBe(`${memo.replace(/\[bill:[^\]]+\]/g, '')}[bill:B2][bill:B1]`)
  })
  it('태그 없는 일반 메모는 기존대로 저장한다', async () => {
    results.tuition_payments = [ok({ method: 'cash', deleted_at: null, memo: '기존' }), ok({ id: 'id1' })]
    await paymentPut(req({ memo: '변경 메모' }), params)
    expect(writes[0].payload).toEqual({ memo: '변경 메모' })
  })
})

describe('정산 조회 오류 차단 (#4)', () => {
  const body = { studentId: 's1', studentName: '학생', billingMonth: '2026-09', resumedAmount: 100000, phone: '01012345678', dryRun: true }
  const bill = { bill_id: 'old', amount: 450000, status: 'paid', is_regular_tuition: true, bill_type: 'regular', billing_month: '2026-09' }
  it.each(['당월', '폴백'])('%s 조회 실패 시 500, 파기·발송 없음', async stage => {
    results[HISTORY] = [ok([]), ...(stage === '폴백' ? [ok([])] : []), { data: null, error: { message: 'DB down' } }]
    const res = await resettle(req(body))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: 'GUARD_QUERY_FAILED', detail: 'DB down' })
    expect(writes).toHaveLength(0)
    expect(sendBill).not.toHaveBeenCalled()
    expect(destroyBill).not.toHaveBeenCalled()
    expect(results[HISTORY]).toHaveLength(0)
  })
  it.each(['paid', 'sent'])('정상 당월 %s는 기존 정산 방식 유지', async status => {
    results[HISTORY] = [ok([]), ok([{ ...bill, status }])]
    const res = await resettle(req(body))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ mode: status === 'paid' ? 'refund' : 'unpaid', effectiveMonth: '2026-09', fellBack: false })
    expect(writes).toHaveLength(0)
  })
  it('당월에 비정규(특강) 청구서만 있으면 정규 기준으로 지난달 폴백한다', async () => {
    results[HISTORY] = [ok([]), ok([{ ...bill, is_regular_tuition: false }]), ok([{ ...bill, billing_month: '2026-08' }])]
    const res = await resettle(req(body))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ mode: 'refund', effectiveMonth: '2026-08', fellBack: true })
    expect(results[HISTORY]).toHaveLength(0)
  })
  it('당월 정상 빈 배열일 때만 지난달 폴백', async () => {
    results[HISTORY] = [ok([]), ok([]), ok([{ ...bill, billing_month: '2026-08' }])]
    const res = await resettle(req(body))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ mode: 'refund', effectiveMonth: '2026-08', fellBack: true })
  })
})

describe('학생 등록 결제일 (#9)', () => {
  it.each([1, 15, 31, 0, 32, -1, 1.5, null, undefined, '15'])('입력 %s: 정수 1~31만 저장', async day => {
    results.tuition_students = [ok(null), ok({ id: 's1' })]
    const res = await studentPost(req({ name: '학생', class_id: 'c1', enrollment_date: '2026-09-01', payment_due_day: day }))
    expect(res.status).toBe(200)
    const insert = writes.find(w => w.table === 'tuition_students' && w.method === 'insert')!
    expect(insert.payload.payment_due_day).toBe(typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 31 ? day : null)
    expect(writes.filter(w => w.table === 'tuition_students')).toHaveLength(1)
  })
})

describe('재발행 연결정보 보존 (#12)', () => {
  it.each([true, false])('영업시간=%s: bill_note·bill_type 유지, 상품명·금액 유지', async business => {
    businessHour.mockReturnValue(business)
    results[HISTORY] = [ok({ student_id: 's1', billing_month: '2026-09', phone: '01012345678', is_regular_tuition: false, status: 'sent', bill_note: '9월 특강', bill_type: 'electives', amount: 100000 })]
    results.tuition_special_payment = [ok([])]
    results.tuition_students = [ok({ name: '학생' })]
    const res = await reissue(req({ billId: 'old', amount: 100000 }))
    expect(res.status).toBe(200)
    const insert = writes.find(w => w.method === 'insert')!
    expect(insert.payload).toMatchObject({ bill_note: '9월 특강', bill_type: 'electives', is_regular_tuition: false })
    expect(selects.find(s => s.table === HISTORY)?.columns).toContain('bill_type')
    if (business) {
      expect(writes.find(w => w.method === 'update')!.payload).not.toHaveProperty('bill_note')
      expect(sendBill).toHaveBeenCalledWith(expect.objectContaining({ amount: 100000, productName: defaultBillProductName('2026-09') }))
      expect(audit).toHaveBeenCalledWith('payment', 's1', 'update', '수동 재발송으로 파기', { billId: 'old' })
    } else {
      expect(sendBill).not.toHaveBeenCalled()
      expect(insert.payload.payload).toMatchObject({ amount: 100000, productName: defaultBillProductName('2026-09'), oldBillId: 'old' })
    }
  })
})

describe('perf #6b 재발행·정산 결과 불명확', () => {
  it('reissue 새 발송 throw → 502 + 수동확인 감사', async () => {
    results[HISTORY] = [ok({ student_id: 's1', billing_month: '2026-09', phone: '01000000000', is_regular_tuition: false, status: 'sent', bill_note: '특강', bill_type: 'regular', amount: 100000 })]
    results.tuition_special_payment = [ok([])]
    results.tuition_students = [ok({ name: 'fixture' })]
    sendBill.mockRejectedValue(new Error('HTTP 502'))
    const res = await reissue(req({ billId: 'old', amount: 100000 }))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ code: 'SEND_RESULT_UNKNOWN' })
    expect(audit.mock.calls.some(a => String(a[3]).includes('발송 결과 불명확'))).toBe(true)
  })
  it.each(['paid', 'sent'])('resettle %s 새 발송 throw → 502, 미발송 단정 대신 수동확인', async status => {
    results[HISTORY] = [ok([]), ok([{ bill_id: 'old', amount: 450000, status, is_regular_tuition: true, bill_type: 'regular', billing_month: '2026-09' }])]
    sendBill.mockRejectedValue(new Error('HTTP 502'))
    const res = await resettle(req({ studentId: 's1', studentName: 'fixture', billingMonth: '2026-09', resumedAmount: 100000, phone: '01000000000' }))
    expect(res.status).toBe(502)
    const resJson = res.json()
    expect(await resJson).toMatchObject({ code: 'SEND_RESULT_UNKNOWN' })
    expect(audit.mock.calls.some(a => String(a[3]).includes('발송 결과 불명확') || String(a[3]).includes('발송 결과 불명확'))).toBe(true)
    // 미납형(sent)은 미납분을 이미 파기한 뒤라 '살아있는 청구서 없음' 사실(destroyedBillIds)이 응답·감사로그에 남아야 한다(2026-07-26 안전장치)
    if (status === 'sent') {
      expect(await resJson).toMatchObject({ destroyedBillIds: ['old'] })
      expect(audit.mock.calls.some(a => String(a[3]).includes('파기 완료') && String(a[3]).includes('불명확'))).toBe(true)
    } else {
      expect(await resJson).not.toHaveProperty('destroyedBillIds')
    }
  })
})

describe('금융 쓰기 전 선조회 오류 차단 (코드 검수 2026-09-26 WEB-01)', () => {
  it('납부 삭제: 선조회 오류면 500, 삭제·파기예약 해제·감사 0', async () => {
    results.tuition_payments = [{ data: null, error: { message: 'boom' } }]
    const res = await paymentDelete(req(), params)
    expect(res.status).toBe(500)
    expect(writes).toHaveLength(0)
    expect(audit).not.toHaveBeenCalled()
  })
  it('납부 삭제: 없는 납부면 404, 쓰기 0', async () => {
    results.tuition_payments = [ok(null)]
    const res = await paymentDelete(req(), params)
    expect(res.status).toBe(404)
    expect(writes).toHaveLength(0)
  })
  it('납부 삭제: 결제선생 건은 종전대로 400', async () => {
    results.tuition_payments = [ok({ id: 'id1', method: 'payssam', amount: 350000 })]
    const res = await paymentDelete(req(), params)
    expect(res.status).toBe(400)
    expect(writes).toHaveLength(0)
  })
  it('납부 삭제: 현금 건은 종전대로 soft-delete + 파기예약 해제 + 감사', async () => {
    results.tuition_payments = [ok({ id: 'id1', method: 'cash', amount: 350000, billing_month: '2026-09' }), ok(null)]
    const res = await paymentDelete(req(), params)
    expect(res.status).toBe(200)
    expect(writes.map(w => w.table)).toEqual(['tuition_payments', 'tuition_bill_queue'])
    expect(writes[0].payload).toHaveProperty('deleted_at')
    expect(audit).toHaveBeenCalledTimes(1)
  })
  it('즉시 파기: 청구 기록 조회 오류면 500 GUARD_QUERY_FAILED, 외부 파기 0', async () => {
    results[HISTORY] = [{ data: null, error: { message: 'boom' } }]
    const res = await destroyRoute(req({ billId: 'b1', amount: 350000 }))
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('GUARD_QUERY_FAILED')
    expect(destroyBill).not.toHaveBeenCalled()
  })
  it('즉시 파기: 금액 일치면 종전대로 외부 파기 1회', async () => {
    results[HISTORY] = [ok({ student_id: 's1', amount: 350000 }), ok(null)]
    const res = await destroyRoute(req({ billId: 'b1', amount: 350000 }))
    expect(res.status).toBe(200)
    expect(destroyBill).toHaveBeenCalledTimes(1)
  })
})
