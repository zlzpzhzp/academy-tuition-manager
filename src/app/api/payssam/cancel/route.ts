import { NextRequest, NextResponse } from 'next/server'
import { cancelBill } from '@/lib/payssam'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { clearPaymentForBill } from '@/lib/paymentCancel'
import { writeAuditLog } from '@/lib/auditLog'

export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  try {
    const { billId, amount } = await request.json()
    if (!billId || !amount) {
      return NextResponse.json({ error: '필수 정보가 누락되었습니다' }, { status: 400 })
    }

    // 취소(환불) 금액을 클라이언트 body 값 그대로 믿지 않는다 — reissue와 동일하게 DB 청구액 대조.
    // 대조 없이는 부분환불·과소환불 금액이 그대로 결제선생에 전달된다 (2026-08-13 라인리뷰 P2).
    // maybeSingle: bill_history에 없는 청구서(외부 수동 발송·콜백 기록 유실)는 destroy와 동일 정책으로
    // 요청 금액으로 진행 — .single() 404는 그런 청구서의 환불을 앱에서 아예 막았다 (2026-08-16 라인리뷰).
    const { data: billRow, error: billErr } = await supabase
      .from('tuition_bill_history')
      .select('student_id, billing_month, is_regular_tuition, appr_price, amount')
      .eq('bill_id', billId)
      .maybeSingle()
    // supabase-js는 오류를 throw하지 않고 {data:null,error}로 준다 — error를 안 보면 조회 장애가
    // '행 없음'과 구별되지 않아 금액 대조·수납 해제가 통째로 스킵된 채 body 금액 그대로 실환불된다.
    // 형제 경로(send·resend·reissue)와 같은 규약: 조회 실패면 500 중단, '행 없음'일 때만 요청액 진행.
    if (billErr) {
      console.error('[PaySsam cancel] 청구 조회 실패 — 금액 대조 불가로 취소 중단:', billErr)
      return NextResponse.json({
        error: '청구 기록 조회에 실패해 취소를 중단했습니다 (금액 대조 불가). 잠시 후 다시 시도하세요.',
        code: 'GUARD_QUERY_FAILED',
        detail: billErr.message,
      }, { status: 500 })
    }

    let dbAmount = Number(amount)
    if (billRow) {
      const apprPrice = billRow.appr_price != null ? Number(billRow.appr_price) : null
      const baseAmount = Number(billRow.amount)
      // 화면은 bill.amount를 보내는데 콜백 보정으로 appr_price(실결제액)와 갈린 행이 실존한다(2026-06-22
      // 보정 1건 실측) — 어느 한쪽과 일치하면 통과. 실행액은 항상 서버 값(실결제액 우선)이라 안전.
      if (Number(amount) !== baseAmount && (apprPrice == null || Number(amount) !== apprPrice)) {
        return NextResponse.json({
          error: `요청 금액(${Number(amount).toLocaleString()}원)이 청구액(${baseAmount.toLocaleString()}원)${apprPrice != null && apprPrice !== baseAmount ? `/실결제액(${apprPrice.toLocaleString()}원)` : ''}과 다릅니다.`,
          code: 'AMOUNT_MISMATCH',
        }, { status: 400 })
      }
      dbAmount = apprPrice ?? baseAmount
    }

    const result = await cancelBill(billId, dbAmount)

    if (result.code === '0000') {
      if (billRow) {
        // 결제선생에서 취소됐는데 DB 상태 전이가 실패하면 화면엔 여전히 '결제완료' — 조용히 넘기지 않는다
        const { error: updErr } = await supabase
          .from('tuition_bill_history')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('bill_id', billId)
        if (updErr) {
          console.error('[PaySsam cancel] 상태 전이 실패:', billId, updErr)
          await writeAuditLog('payment', billRow.student_id, 'update',
            `⚠️ 결제 취소됨 but DB 상태전이 실패: bill ${billId} — 화면에 결제완료로 남아 있음, 수동 확인 필요 (${updErr.message})`,
            { billId, error: updErr.message })
        }

        // 콜백이 자동수납한 payments 레코드 반영 해제 — 분할 누적 row는 해당 청구분만 차감 (2026-07-02)
        if (billRow.is_regular_tuition !== false) {
          await clearPaymentForBill(billRow.student_id, billRow.billing_month, billId, dbAmount)
        }
      } else {
        // 기록 없는 청구 취소 — 납부 해제·상태 전이할 row가 없으니 감사로그로만 흔적을 남긴다
        await writeAuditLog('payment', null, 'update',
          `⚠️ bill_history에 없는 청구서 취소됨: bill ${billId} ${dbAmount.toLocaleString()}원 — 수납 기록 대조 수동 확인 필요`,
          { billId, amount: dbAmount })
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[PaySsam] 결제 취소 실패:', error)
    return NextResponse.json({ error: '결제 취소 중 오류가 발생했습니다' }, { status: 500 })
  }
}
