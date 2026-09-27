import { NextRequest, NextResponse } from 'next/server'
import { scheduledResponse } from '@/lib/scheduledResponse'
import { recordSentBill } from '@/lib/billHistory'
import { writeAuditLog } from '@/lib/auditLog'
import { destroyBill, sendBill, fetchPaySsamStatus } from '@/lib/payssam'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { isBusinessHourKst, nextBusinessSlot } from '@/lib/schedule'
import { defaultBillProductName } from '@/lib/billing-title'

// 기존 청구서 파기 + 같은 조건(학생·월·금액)으로 새 청구서 발송.
// 새 bill_id가 발급되므로 PaySsam/카톡 입장에선 별개 캠페인 → 스팸 감지 안 걸림.
export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  try {
    const { billId, amount } = await request.json()
    if (!billId || !amount) {
      return NextResponse.json({ error: '필수 정보가 누락되었습니다' }, { status: 400 })
    }

    const { data: oldBill } = await supabase
      .from('tuition_bill_history')
      .select('student_id, billing_month, phone, is_regular_tuition, status, bill_note, bill_type, amount, supersedes_bill_id')
      .eq('bill_id', billId)
      .single()

    if (!oldBill) {
      return NextResponse.json({ error: '기존 청구서를 찾을 수 없습니다' }, { status: 404 })
    }
    if (oldBill.status !== 'sent') {
      return NextResponse.json({ error: '발송 상태가 아닌 청구서는 재발송할 수 없습니다' }, { status: 400 })
    }

    // 2026-08-01 (7/26 감사 P2-6, '보고만' 으로 남겼던 것을 회수해 수정):
    // 금액이 클라이언트 body 에서 오는데 DB 청구액과 대조하지 않았다. 대개는 결제선생 hash 에
    // amount 가 포함돼 불일치가 거부되지만, realStatus==='destroyed' 경로는 destroyBill 을 건너뛰어
    // 그 암묵적 검증조차 없이 **클라이언트가 준 금액으로 새 청구서**가 나간다.
    // 손실·과청구를 막는 방향이라 fail-closed 로 막는다(원래 '동작 변경'이라 미뤘던 사유는 성립 안 함).
    if (Number(amount) !== Number(oldBill.amount)) {
      return NextResponse.json({
        error: `요청 금액(${Number(amount).toLocaleString()}원)이 기존 청구액(${Number(oldBill.amount).toLocaleString()}원)과 다릅니다. 금액을 바꾸려면 파기 후 새로 발송하세요.`,
        code: 'AMOUNT_MISMATCH',
      }, { status: 400 })
    }

    // 이미 결제된 건이면 차단 (#77이 놓친 edge case 방어)
    // limit(1) + 배열 확인: 분할납부 등으로 같은 달 결제 row가 2건 이상이면
    // maybeSingle()이 error+data=null 을 반환해 가드가 fail-open(재발송 허용)되던 버그 방어.
    // 2026-07-27: resend와 같은 결함이 여기에도 있었다 — 특강 청구서도 billing_month가 정규와 같은
    // '2026-07'이라, 정규 납부기록만 보면 "정규는 냈고 특강은 안 낸" 미납자가 전부 막힌다.
    // 특강비는 tuition_special_payment(label=bill_note)에 쌓인다. (형제 경로 동시 수정 — rule.path_coverage)
    // 2026-07-31 조용한실패 점검: supabase-js는 오류를 throw하지 않고 {data:null,error}로 resolve한다.
    // error를 안 보면 DB 장애가 '납부기록 없음'과 같아져 이미 결제한 건을 파기+재발송하는 fail-open이 된다.
    // 가드는 막는 쪽이 안전 — 조회 실패 시 파기·재발송하지 않고 500. (형제 경로 resend와 동일 — rule.path_coverage)
    const paidQueryFailed = (msg: string) => NextResponse.json({
      error: '납부 기록 조회에 실패해 재발송을 중단했습니다 (결제된 청구서 파기·이중청구 방지). 잠시 후 다시 시도하세요.',
      code: 'GUARD_QUERY_FAILED',
      detail: msg,
    }, { status: 500 })

    if (oldBill.is_regular_tuition === false) {
      const { data: specialPaid, error: specialErr } = await supabase
        .from('tuition_special_payment')
        .select('id')
        .eq('student_id', oldBill.student_id)
        .eq('label', oldBill.bill_note ?? '')
        .is('deleted_at', null)
        .limit(1)
      if (specialErr) {
        console.error('[PaySsam reissue] 특강 납부기록 조회 실패:', specialErr)
        return paidQueryFailed(specialErr.message)
      }
      if (specialPaid && specialPaid.length > 0) {
        return NextResponse.json({ error: '이미 결제된 특강 건입니다. 재발송할 수 없습니다', code: 'ALREADY_PAID' }, { status: 409 })
      }
    } else {
      const { data: existingPayments, error: paidErr } = await supabase
        .from('tuition_payments')
        .select('id')
        .eq('student_id', oldBill.student_id)
        .eq('billing_month', oldBill.billing_month)
        .is('deleted_at', null)
        .limit(1)
      if (paidErr) {
        console.error('[PaySsam reissue] 납부기록 조회 실패:', paidErr)
        return paidQueryFailed(paidErr.message)
      }
      if (existingPayments && existingPayments.length > 0) {
        return NextResponse.json({ error: '이미 결제된 건입니다. 재발송할 수 없습니다', code: 'ALREADY_PAID' }, { status: 409 })
      }
    }

    const { data: student } = await supabase
      .from('tuition_students')
      .select('name')
      .eq('id', oldBill.student_id)
      .single()
    if (!student) {
      return NextResponse.json({ error: '학생을 찾을 수 없습니다' }, { status: 404 })
    }

    // 영업시간 외 → 재발송 큐 등록 (cron이 처리 시 기존 파기 + 새 발송)
    if (!isBusinessHourKst()) {
      const scheduledAt = nextBusinessSlot()
      const productName = defaultBillProductName(oldBill.billing_month)
      const { error: queueError } = await supabase.from('tuition_bill_queue').insert({
        student_id: oldBill.student_id,
        student_name: student.name,
        phone: oldBill.phone,
        billing_month: oldBill.billing_month,
        is_regular_tuition: oldBill.is_regular_tuition,
        bill_note: oldBill.bill_note,
        bill_type: oldBill.bill_type,
        send_type: 'reissue',
        payload: { amount, productName, message: `${student.name} ${productName}`, oldBillId: billId, ...(oldBill.supersedes_bill_id ? { supersedesBillId: oldBill.supersedes_bill_id } : {}) },
        scheduled_at: scheduledAt.toISOString(),
        status: 'pending',
      })
      if (queueError) {
        console.error('[PaySsam reissue] 큐 등록 실패:', queueError)
        return NextResponse.json({ error: '예약 등록 실패' }, { status: 500 })
      }
      await writeAuditLog('payment', oldBill.student_id, 'update',
        '수동 재발송 예약', { billId })
      return scheduledResponse(scheduledAt, '재발송')
    }

    // PaySsam 실제 상태 동기화 — DB(sent)와 어긋났을 수 있음
    const realStatus = await fetchPaySsamStatus(billId)
    if (realStatus === 'paid') {
      // 결제선생엔 결제완료인데 우리 DB엔 결제 기록 없음 → 이중청구 방지
      return NextResponse.json({ error: '결제선생에서 이미 결제 완료된 청구서입니다. 재발송할 수 없습니다.', code: 'PAID_ON_PAYSSAM' }, { status: 409 })
    }

    // 1단계: 기존 청구서 파기 (PaySsam에서 이미 파기된 경우 호출 스킵)
    if (realStatus !== 'destroyed') {
      const destroyResult = await destroyBill(billId, amount)
      if (destroyResult.code !== '0000') {
        return NextResponse.json({ error: '기존 청구서 파기 실패', detail: destroyResult }, { status: 500 })
      }
    }
    await supabase
      .from('tuition_bill_history')
      .update({
        status: 'destroyed',
        updated_at: new Date().toISOString(),
      })
      .eq('bill_id', billId)

    await writeAuditLog('payment', oldBill.student_id, 'update',
      realStatus === 'destroyed' ? '결제선생 파기 동기화' : '수동 재발송으로 파기', { billId })

    // 2단계: 새 청구서 발송 (새 bill_id 자동 발급)
    const productName = defaultBillProductName(oldBill.billing_month)
    let sendResult: { code?: string; msg?: string; bill_id?: string; shortURL?: string }
    try {
      sendResult = await sendBill({
        studentName: student.name,
        phone: oldBill.phone,
        amount,
        productName,
        message: `${student.name} ${productName}`,
      })
    } catch (error) {
      await writeAuditLog('payment', oldBill.student_id, 'update',
        `⚠️ 발송 결과 불명확: ${oldBill.billing_month} [reissue] — 결제선생에서 실발송 여부 확인 후 수동 처리`,
        { error: error instanceof Error ? error.message : String(error) })
      return NextResponse.json({ code: 'SEND_RESULT_UNKNOWN', error: '결제선생 응답을 받지 못했습니다. 결제선생에서 발송 여부를 확인한 뒤 다시 시도하세요.' }, { status: 502 })
    }

    if (sendResult.code === '0000') {
      const { error: dbErr } = await recordSentBill({
        student_id: oldBill.student_id,
        bill_id: sendResult.bill_id as string,  // code==='0000' 성공시 항상 존재(split-send와 동일 패턴)
        amount,
        billing_month: oldBill.billing_month,
        phone: oldBill.phone,
        short_url: sendResult.shortURL ?? null,
        sent_at: new Date().toISOString(),
        is_regular_tuition: oldBill.is_regular_tuition,
        bill_note: oldBill.bill_note,
        bill_type: oldBill.bill_type,
        // 정산 청구서(중도퇴원 정산)를 재발송하면 콜백이 bill_note 로 '정산 처리완료'를 마킹한다 — 환불 링크도
        // 같이 승계해야 기존 완납분이 실제로 환불된다(2026-09-05 astra 병합 검수: note 만 승계하면 이중납부가 묻힘).
        ...(oldBill.supersedes_bill_id ? { supersedes_bill_id: oldBill.supersedes_bill_id } : {}),
      })
      await writeAuditLog('payment', oldBill.student_id, 'update',
        '수동 재발송', { oldBillId: billId, billId: sendResult.bill_id })
      if (dbErr) {
        // 2026-07-05 9app-full-review: DB기록 실패 에스컬레이션(중복발송 가드 사각 방지).
        console.error('[PaySsam] reissue DB기록 실패:', dbErr)
        await writeAuditLog('payment', oldBill.student_id, 'update',
          `⚠️ 재발송됨 but DB기록 실패: ${student.name ?? ''} ${oldBill.billing_month} — 수동확인 필요`,
          { billId: sendResult.bill_id, error: dbErr.message })
      }
    }

    return NextResponse.json(sendResult)
  } catch (error) {
    console.error('[PaySsam] 재발송 실패:', error)
    return NextResponse.json({ error: '재발송 중 오류가 발생했습니다' }, { status: 500 })
  }
}
