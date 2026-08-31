import { NextRequest, NextResponse } from 'next/server'
import { bumpResendCount } from '@/lib/billHistory'
import { scheduledResponse } from '@/lib/scheduledResponse'
import { resendBill, fetchPaySsamStatus } from '@/lib/payssam'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { isBusinessHourKst, nextBusinessSlot } from '@/lib/schedule'

// 기존 청구서 bill_id 그대로 유지하면서 카톡 알림만 다시 푸시.
// /if/bill/resend 호출 → 새 bill 발급 없음, 기존 결제 링크 그대로.
export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  try {
    const { billId, amount } = await request.json()
    if (!billId) {
      return NextResponse.json({ error: 'billId 누락' }, { status: 400 })
    }

    const { data: bill } = await supabase
      .from('tuition_bill_history')
      .select('student_id, billing_month, phone, is_regular_tuition, status, resend_count, bill_note')
      .eq('bill_id', billId)
      .single()

    if (!bill) {
      return NextResponse.json({ error: '청구서를 찾을 수 없습니다' }, { status: 404 })
    }
    if (bill.status !== 'sent') {
      return NextResponse.json({ error: '발송 상태가 아닌 청구서는 재발송할 수 없습니다' }, { status: 400 })
    }

    // 이미 낸 학부모에게 독촉이 가지 않게 하는 가드.
    // ⚠️ 2026-07-27: 특강 청구서도 billing_month가 정규와 같은 '2026-07'이라, 정규 납부기록만 보면
    //    "정규는 냈고 특강은 안 낸" 정상 미납자가 전부 ALREADY_PAID로 막혔다(그날 20건 중 19건 차단).
    //    특강비는 tuition_special_payment(label=bill_note)에 쌓이므로 청구서 종류에 맞는 테이블을 봐야 한다.
    // limit(1) + 배열 확인: 분할납부 등으로 결제 row가 2건 이상이면
    // maybeSingle()이 error+data=null 을 반환해 가드가 fail-open 되던 버그 방어.
    // 2026-07-31 조용한실패 점검: supabase-js는 오류를 throw하지 않고 {data:null,error}로 resolve한다.
    // error를 안 보면 DB 장애가 '납부기록 없음'과 같아져, 이미 낸 학부모에게 독촉이 나가는 fail-open이 된다.
    // 가드는 막는 쪽이 안전 — 조회 실패 시 재발송하지 않고 500.
    const paidQueryFailed = (msg: string) => NextResponse.json({
      error: '납부 기록 조회에 실패해 재발송을 중단했습니다 (이미 결제한 학부모 독촉 방지). 잠시 후 다시 시도하세요.',
      code: 'GUARD_QUERY_FAILED',
      detail: msg,
    }, { status: 500 })

    if (bill.is_regular_tuition === false) {
      const { data: specialPaid, error: specialErr } = await supabase
        .from('tuition_special_payment')
        .select('id')
        .eq('student_id', bill.student_id)
        .eq('label', bill.bill_note ?? '')
        .is('deleted_at', null)
        .limit(1)
      if (specialErr) {
        console.error('[PaySsam resend] 특강 납부기록 조회 실패:', specialErr)
        return paidQueryFailed(specialErr.message)
      }
      if (specialPaid && specialPaid.length > 0) {
        return NextResponse.json({ error: '이미 결제된 특강 건입니다', code: 'ALREADY_PAID' }, { status: 409 })
      }
    } else {
      const { data: existingPayments, error: paidErr } = await supabase
        .from('tuition_payments')
        .select('id')
        .eq('student_id', bill.student_id)
        .eq('billing_month', bill.billing_month)
        .is('deleted_at', null)
        .limit(1)
      if (paidErr) {
        console.error('[PaySsam resend] 납부기록 조회 실패:', paidErr)
        return paidQueryFailed(paidErr.message)
      }
      if (existingPayments && existingPayments.length > 0) {
        return NextResponse.json({ error: '이미 결제된 건입니다', code: 'ALREADY_PAID' }, { status: 409 })
      }
    }

    // PaySsam 실제 상태 동기화 — 우리 DB는 sent여도 결제선생에서 파기됐을 수 있음(drift).
    // 파기된 청구서는 재발송해도 죽은 링크라 무의미 → DB 동기화 후 새 발송 유도.
    const realStatus = await fetchPaySsamStatus(billId)
    if (realStatus === 'destroyed') {
      await supabase
        .from('tuition_bill_history')
        .update({ status: 'destroyed', bill_note: '결제선생 상태 동기화 (파기 감지)', updated_at: new Date().toISOString() })
        .eq('bill_id', billId)
      return NextResponse.json({
        error: '결제선생에서 이미 파기된 청구서입니다. 파기 처리했으니 새 청구서를 발송해주세요.',
        code: 'DESTROYED_ON_PAYSSAM',
      }, { status: 409 })
    }

    // 영업시간 외 → 재발송 큐 등록 (send_type='resend')
    if (!isBusinessHourKst()) {
      const { data: student } = await supabase
        .from('tuition_students')
        .select('name')
        .eq('id', bill.student_id)
        .single()
      const scheduledAt = nextBusinessSlot()
      const { error: queueError } = await supabase.from('tuition_bill_queue').insert({
        student_id: bill.student_id,
        student_name: student?.name ?? '',
        phone: bill.phone,
        billing_month: bill.billing_month,
        is_regular_tuition: bill.is_regular_tuition,
        bill_note: '수동 재발송 예약 (카톡 알림)',
        send_type: 'resend',
        payload: { billId },
        scheduled_at: scheduledAt.toISOString(),
        status: 'pending',
      })
      if (queueError) {
        console.error('[PaySsam resend] 큐 등록 실패:', queueError)
        return NextResponse.json({ error: '예약 등록 실패' }, { status: 500 })
      }
      return scheduledResponse(scheduledAt, '재발송')
    }

    const result = await resendBill(billId)
    if (result.code !== '0000') {
      return NextResponse.json({ error: '재발송 실패', code: result.code, msg: result.msg }, { status: 500 })
    }

    await bumpResendCount(billId, bill.resend_count, new Date().toISOString())

    void amount
    return NextResponse.json({ code: '0000', msg: '재발송 완료' })
  } catch (error) {
    console.error('[PaySsam] 재발송 실패:', error)
    return NextResponse.json({ error: '재발송 중 오류가 발생했습니다' }, { status: 500 })
  }
}
