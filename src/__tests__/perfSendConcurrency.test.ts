import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

type Row = Record<string, unknown>
const history: Row[] = []
const queued: Row[] = []
const sendBill = vi.fn()
const destroyBill = vi.fn()
const business = vi.fn()
const audit = vi.fn()
function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = []
  let op = 'select'
  let payload: Row = {}
  const b = {
    select() { return b },
    eq(k: string, v: unknown) { filters.push(r => r[k] === v); return b },
    in(k: string, v: unknown[]) { filters.push(r => v.includes(r[k])); return b },
    is() { return b },
    limit() { return b },
    update(row: Row) { op = 'update'; payload = row; return b },
    insert(row: Row) { op = 'insert'; payload = row; return b },
    then(resolve: (v: { data: unknown; error: null }) => unknown) {
      const rows = (table === 'tuition_bill_history' ? history : table === 'tuition_bill_queue' ? queued : []).filter(r => filters.every(f => f(r)))
      if (op === 'update') rows.forEach(r => Object.assign(r, payload))
      if (op === 'insert' && table === 'tuition_bill_queue') queued.push(payload)
      return resolve({ data: op === 'select' ? rows.map(r => ({ ...r })) : null, error: null })
    },
  }
  return b
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => builder(table) } }))
vi.mock('@/lib/auth', () => ({ requireAdminSession: () => null }))
vi.mock('@/lib/payssam', () => ({ sendBill: (...a: unknown[]) => sendBill(...a), destroyBill: (...a: unknown[]) => destroyBill(...a) }))
vi.mock('@/lib/billHistory', () => ({ recordSentBill: async (row: Row) => { history.push({ ...row, status: 'sent' }); return { error: null } } }))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: (...a: unknown[]) => audit(...a) }))
vi.mock('@/lib/schedule', () => ({ isBusinessHourKst: () => business(), nextBusinessSlot: () => new Date('2026-09-07T02:00:00Z'), formatKst: () => '예약 시간' }))
import { POST as send } from '@/app/api/payssam/send/route'
import { POST as split } from '@/app/api/payssam/split-send/route'
const base = { studentId: 's1', studentName: 'fixture', phone: '01000000000', amount: 100, billingMonth: '2026-09', amounts: [50, 50], persist: false }
const req = (body: Row = {}) => ({ json: async () => ({ ...base, ...body }) }) as NextRequest
beforeEach(() => {
  history.length = 0
  queued.length = 0
  business.mockReset().mockReturnValue(true)
  sendBill.mockReset().mockImplementation(async () => { await new Promise(r => setTimeout(r, 10)); return { code: '0000', bill_id: `bill-${sendBill.mock.calls.length}` } })
  destroyBill.mockReset().mockResolvedValue({ code: '0000' })
  audit.mockReset()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('실제 네트워크 금지') }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('perf #5 청구 동시성', () => {
  it('동일 학생·월·종류 동시 단건은 sendBill 1회, 200+409 ALREADY_SENT', async () => {
    const responses = await Promise.all([send(req()), send(req())])
    expect(sendBill).toHaveBeenCalledTimes(1)
    expect(responses.map(r => r.status).sort()).toEqual([200, 409])
    expect(await responses.find(r => r.status === 409)!.json()).toMatchObject({ code: 'ALREADY_SENT' })
  })
  it('다른 학생은 2개 발송이 동시에 진행되고 둘 다 200', async () => {
    let active = 0
    let maxActive = 0
    sendBill.mockImplementation(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(r => setTimeout(r, 10))
      active--
      return { code: '0000', bill_id: `b-${maxActive}-${active}` }
    })
    const responses = await Promise.all([send(req()), send(req({ studentId: 's2' }))])
    expect(responses.map(r => r.status)).toEqual([200, 200])
    expect(maxActive).toBe(2)
  })
  it.each(['split-first', 'send-first', 'split-split'])('%s 동시 정규 분할·단건은 뒤 요청이 409', async order => {
    const responses = await Promise.all(order === 'send-first' ? [send(req()), split(req())] : order === 'split-split' ? [split(req()), split(req())] : [split(req()), send(req())])
    expect(responses.map(r => r.status)).toEqual([200, 409])
    expect(sendBill).toHaveBeenCalledTimes(order === 'send-first' ? 1 : 2)
    expect(destroyBill).not.toHaveBeenCalled()
  })
  it('선행 요청이 끝난 뒤의 명시적 분할 교체는 기존대로 성공 후 원본 파기', async () => {
    await send(req())
    const old = history[0].bill_id
    const res = await split(req())
    expect(res.status).toBe(200)
    expect(sendBill).toHaveBeenCalledTimes(3)
    expect(destroyBill).toHaveBeenCalledWith(old, 100)
    expect(history[0].status).toBe('destroyed')
  })
  it('선택과목·특강은 정규 청구와 공존', async () => {
    const responses = await Promise.all([send(req()), send(req({ billType: 'electives' })), send(req({ isRegularTuition: false }))])
    expect(responses.map(r => r.status)).toEqual([200, 200, 200])
    expect(sendBill).toHaveBeenCalledTimes(3)
  })
  it('영업시간 외 예약 응답·발송 없음 보존', async () => {
    business.mockReturnValue(false)
    const res = await send(req())
    expect(await res.json()).toMatchObject({ code: 'SCHEDULED' })
    expect(queued).toHaveLength(1)
    expect(sendBill).not.toHaveBeenCalled()
  })
})

describe('perf #6b 대화형 결과 불명확', () => {
  it('발송 인자 생성 실패는 기존 500이며 결과 불명확으로 오분류하지 않는다', async () => {
    const res = await send(req({ billingMonth: {} }))
    expect(res.status).toBe(500)
    expect(sendBill).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })
  it.each(['send', 'split'])('%s sendBill throw → 502 SEND_RESULT_UNKNOWN + 감사', async type => {
    sendBill.mockRejectedValue(new Error('HTTP 502'))
    const res = await (type === 'send' ? send : split)(req())
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ code: 'SEND_RESULT_UNKNOWN', error: '결제선생 응답을 받지 못했습니다. 결제선생에서 발송 여부를 확인한 뒤 다시 시도하세요.' })
    expect(audit.mock.calls.some(a => String(a[3]).includes('⚠️') && String(a[3]).includes('발송 결과 불명확'))).toBe(true)
    expect(destroyBill).not.toHaveBeenCalled()
  })
})
