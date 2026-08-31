/**
 * split-send 이미납부 가드 회귀 (2026-08-13 라인리뷰 P1-B)
 *
 * 분할 발송에만 send/route.ts의 이미납부 가드가 없어, 현금·이체로 이미 낸 학생에게
 * 새 청구서 2~4장이 나갈 수 있었다(예약 경로도 통과). 가드는 즉시발송·예약등록보다 앞.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

type MockResult = { data: unknown; error: unknown }
const results: Record<string, MockResult[]> = {}
const inserts: { table: string; row: unknown }[] = []

function makeBuilder(table: string) {
  const b: Record<string, unknown> = {}
  const result = () => results[table]?.shift() ?? { data: null, error: null }
  for (const m of ['select', 'eq', 'is', 'in', 'limit', 'update']) b[m] = () => b
  b.insert = (row: unknown) => {
    inserts.push({ table, row })
    return b
  }
  b.then = (resolve: (v: MockResult) => void) => resolve(result())
  return b
}

const sendBill = vi.fn()
const destroyBill = vi.fn()
const businessHour = vi.fn(() => true)

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }))
vi.mock('@/lib/auth', () => ({ requireAdminSession: vi.fn(() => null) }))
vi.mock('@/lib/payssam', () => ({
  sendBill: (...a: unknown[]) => sendBill(...a),
  destroyBill: (...a: unknown[]) => destroyBill(...a),
}))
vi.mock('@/lib/billHistory', () => ({ recordSentBill: vi.fn().mockResolvedValue({ error: null }) }))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/schedule', () => ({
  isBusinessHourKst: () => businessHour(),
  nextBusinessSlot: () => new Date('2026-08-14T02:00:00Z'),
}))
vi.mock('@/lib/scheduledResponse', () => ({
  scheduledResponse: () => new Response(JSON.stringify({ code: 'SCHEDULED' }), { status: 200 }),
}))

import { POST } from '@/app/api/payssam/split-send/route'

const BODY = {
  studentId: 'stu1', studentName: '테스트', phone: '010-1234-5678',
  billingMonth: '2026-08', amounts: [200000, 150000], persist: false,
}
const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k]
  inserts.length = 0
  sendBill.mockReset()
  businessHour.mockReturnValue(true)
})

describe('split-send 이미납부 가드', () => {
  it('완납(납부합계 >= 청구합계)이면 409 — 발송 0건 (P1-B 회귀)', async () => {
    results['tuition_payments'] = [{ data: [{ amount: 350000 }], error: null }]

    const res = await POST(req(BODY))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('ALREADY_PAID')
    expect(body.error).toContain('350,000') // 관리자 판단용 금액 표기
    expect(sendBill).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })

  it('부분 납부(1회차만)면 재발송을 막지 않는다 — 분할은 부분 납부가 정상 상태 (2026-08-16 라인리뷰)', async () => {
    results['tuition_payments'] = [{ data: [{ amount: 200000 }], error: null }] // 청구합계 350,000 미만
    results['tuition_bill_history'] = [{ data: [], error: null }]
    sendBill.mockResolvedValue({ code: '0000', bill_id: 'TM-test', shortURL: null })

    const res = await POST(req(BODY))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.code).toBe('0000')
  })

  it('가드 조회 실패는 fail-closed: 500 — 발송 0건', async () => {
    results['tuition_payments'] = [{ data: null, error: { message: 'DB down' } }]

    const res = await POST(req(BODY))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.code).toBe('GUARD_QUERY_FAILED')
    expect(sendBill).not.toHaveBeenCalled()
  })

  it('영업시간 외 예약 경로도 가드 뒤 — 납부자면 큐에 안 들어간다', async () => {
    businessHour.mockReturnValue(false)
    results['tuition_payments'] = [{ data: [{ amount: 350000 }], error: null }]

    const res = await POST(req(BODY))

    expect(res.status).toBe(409)
    expect(inserts).toHaveLength(0) // tuition_bill_queue 미등록
  })

  it('미납자는 정상 발송된다 (가드 오차단 없음)', async () => {
    results['tuition_payments'] = [{ data: [], error: null }]
    results['tuition_bill_history'] = [{ data: [], error: null }]
    sendBill.mockResolvedValue({ code: '0000', bill_id: 'TM-test', shortURL: null })

    const res = await POST(req(BODY))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.code).toBe('0000')
    expect(sendBill).toHaveBeenCalledTimes(2) // 분할 2건
  })
})
