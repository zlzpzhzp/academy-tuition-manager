/**
 * cancel 라우트 금액 대조·기록부재 정책 회귀 (2026-08-16 주간 라인리뷰 [2][13])
 *
 * - [13] 화면은 bill.amount를 보내는데 대조가 appr_price ?? amount 단일값이라, 콜백 보정으로
 *   appr_price ≠ amount인 행(2026-06-22 보정 1건 실존)은 취소가 400으로 막혔다.
 *   → 어느 한쪽과 일치하면 통과, 실행액은 항상 서버 값(실결제액 우선).
 * - [2] .single() 404가 bill_history에 없는 청구서(외부 수동 발송·기록 유실)의 환불을 막았다.
 *   → destroy와 동일하게 maybeSingle + 요청액 진행 + 감사로그.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

type MockResult = { data: unknown; error: unknown }
const results: Record<string, MockResult[]> = {}
const updates: { table: string; payload: unknown }[] = []

function makeBuilder(table: string) {
  const b: Record<string, unknown> = {}
  const result = () => results[table]?.shift() ?? { data: null, error: null }
  for (const m of ['select', 'eq', 'is', 'ilike', 'maybeSingle', 'single']) b[m] = () => b
  b.update = (payload: unknown) => { updates.push({ table, payload }); return b }
  b.then = (resolve: (v: MockResult) => void) => resolve(result())
  return b
}

const cancelBill = vi.fn()
const clearPaymentForBill = vi.fn().mockResolvedValue(1)
const writeAuditLog = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }))
vi.mock('@/lib/auth', () => ({ requireAdminSession: vi.fn(() => null) }))
vi.mock('@/lib/payssam', () => ({ cancelBill: (...a: unknown[]) => cancelBill(...a) }))
vi.mock('@/lib/paymentCancel', () => ({ clearPaymentForBill: (...a: unknown[]) => clearPaymentForBill(...a) }))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }))

import { POST } from '@/app/api/payssam/cancel/route'

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k]
  updates.length = 0
  cancelBill.mockReset().mockResolvedValue({ code: '0000' })
  clearPaymentForBill.mockClear()
  writeAuditLog.mockClear()
})

describe('cancel 금액 대조', () => {
  it('appr_price ≠ amount 인 보정 행: 화면이 보내는 amount와 일치해도 통과, 실행은 실결제액(appr_price)', async () => {
    results['tuition_bill_history'] = [{
      data: { student_id: 's1', billing_month: '2026-06', is_regular_tuition: true, appr_price: 550000, amount: 450000 },
      error: null,
    }]

    const res = await POST(req({ billId: 'TM-fix', amount: 450000 }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.code).toBe('0000')
    expect(cancelBill).toHaveBeenCalledWith('TM-fix', 550000) // 실결제액으로 취소
  })

  it('어느 쪽과도 다른 금액은 400 AMOUNT_MISMATCH — 두 값이 문구에 실린다', async () => {
    results['tuition_bill_history'] = [{
      data: { student_id: 's1', billing_month: '2026-06', is_regular_tuition: true, appr_price: 550000, amount: 450000 },
      error: null,
    }]

    const res = await POST(req({ billId: 'TM-fix', amount: 500000 }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('AMOUNT_MISMATCH')
    expect(body.error).toContain('450,000')
    expect(body.error).toContain('550,000')
    expect(cancelBill).not.toHaveBeenCalled()
  })

  it('bill_history에 없는 청구서: 404 대신 요청액으로 진행 + 감사로그 (destroy와 동일 정책)', async () => {
    results['tuition_bill_history'] = [{ data: null, error: null }]

    const res = await POST(req({ billId: 'TM-ghost', amount: 300000 }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.code).toBe('0000')
    expect(cancelBill).toHaveBeenCalledWith('TM-ghost', 300000)
    expect(clearPaymentForBill).not.toHaveBeenCalled() // 대조할 row가 없으니 수납 해제도 없음
    expect(writeAuditLog).toHaveBeenCalled() // 흔적은 남긴다
  })

  it('🔴 조회 장애(error 세팅)면 500 GUARD_QUERY_FAILED — body 금액 그대로 실환불되지 않는다 (2026-08-23 라인리뷰 P1)', async () => {
    // maybeSingle 전환 때 error 를 구조분해에서 빼, 조회 장애가 '행 없음'과 구별되지 않았다.
    // 그러면 금액 대조·수납 해제가 통째로 스킵된 채 클라 body 금액으로 실환불된다 — fail-closed 회귀.
    results['tuition_bill_history'] = [{ data: null, error: { message: 'connection reset' } }]

    const res = await POST(req({ billId: 'TM-err', amount: 999999 }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.code).toBe('GUARD_QUERY_FAILED')
    expect(cancelBill).not.toHaveBeenCalled() // 환불 실행 자체가 없어야 한다
    expect(clearPaymentForBill).not.toHaveBeenCalled()
  })

  it('정상 행(appr_price 없음): 청구액 일치 시 상태 전이 + 수납 해제', async () => {
    results['tuition_bill_history'] = [
      { data: { student_id: 's1', billing_month: '2026-08', is_regular_tuition: true, appr_price: null, amount: 350000 }, error: null },
      { data: null, error: null }, // status update
    ]

    const res = await POST(req({ billId: 'TM-n', amount: 350000 }))
    expect(res.status).toBe(200)
    expect(cancelBill).toHaveBeenCalledWith('TM-n', 350000)
    expect(clearPaymentForBill).toHaveBeenCalledWith('s1', '2026-08', 'TM-n', 350000)
    expect(updates.some(u => u.table === 'tuition_bill_history')).toBe(true)
  })
})
