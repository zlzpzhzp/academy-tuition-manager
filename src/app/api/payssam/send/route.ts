import { NextRequest, NextResponse } from 'next/server'
import { scheduledResponse } from '@/lib/scheduledResponse'
import { recordSentBill } from '@/lib/billHistory'
import { writeAuditLog } from '@/lib/auditLog'
import { sendBill } from '@/lib/payssam'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { isBusinessHourKst, nextBusinessSlot } from '@/lib/schedule'
import { defaultBillProductName, defaultBillMessage } from '@/lib/billing-title'
import { normalizePhone } from '@/lib/student-codes'

export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  try {
    const { studentId, studentName, phone, amount, productName, message, billingMonth, isRegularTuition, billNote, billType: billTypeRaw } = await request.json()
    const billType: 'regular' | 'electives' = billTypeRaw === 'electives' ? 'electives' : 'regular'

    if (!studentId || !phone || !amount || !billingMonth) {
      return NextResponse.json({ error: '필수 정보가 누락되었습니다' }, { status: 400 })
    }

    if (amount <= 0) {
      return NextResponse.json({ error: '금액은 0원보다 커야 합니다' }, { status: 400 })
    }

    const cleanPhone = normalizePhone(phone)
    if (!/^01[016789]\d{7,8}$/.test(cleanPhone)) {
      return NextResponse.json({ error: '유효하지 않은 전화번호입니다' }, { status: 400 })
    }

    const isRegular = isRegularTuition !== false

    // 정규 수업료만 중복 발송 방지 (보충비/분할결제 등 비정규는 중복 허용)
    // billType이 다르면 별개 청구서로 취급 (regular vs electives 분리 발송 가능)
    if (isRegular) {
      // 납부기록(현금·카드·결제선생 등 모든 수단) 있으면 정규 청구 차단 — 이미 결제한 학생에게 오발송 절대 방지.
      // UI 일괄발송 명단이 이미 걸러내지만, 어떤 경로(직접 API 호출 등)로도 안 나가게 API 자체 이중잠금 (2026-07-15 원장 지시).
      // billType==='regular'로 한정: 별도 electives 청구는 정규 납부와 무관하게 발송 가능(정규 수업료 중복만 차단).
      // limit(1)+배열: maybeSingle()이 분할납부 등 2건+ 에서 error+data=null로 fail-open 되던 것 방어(크론 가드와 동일 패턴).
      if (billType === 'regular') {
        // 2026-07-31 조용한실패 점검: supabase-js는 오류를 throw하지 않고 {data:null,error}로 resolve한다.
        // error를 안 보면 DB 장애가 '납부기록 없음'과 구별되지 않아 가드가 fail-open(발송 강행)된다.
        // 가드는 막는 쪽이 안전 — 조회 실패 시 발송하지 않고 500.
        const { data: paidRows, error: paidErr } = await supabase
          .from('tuition_payments')
          .select('id, method, amount')
          .eq('student_id', studentId)
          .eq('billing_month', billingMonth)
          .is('deleted_at', null)
          .limit(1)
        if (paidErr) {
          console.error('[PaySsam] 납부기록 조회 실패 — 이중청구 방지로 발송 중단:', paidErr)
          return NextResponse.json({
            error: '납부 기록 조회에 실패해 발송을 중단했습니다 (이중청구 방지). 잠시 후 다시 시도하세요.',
            code: 'GUARD_QUERY_FAILED',
            detail: paidErr.message,
          }, { status: 500 })
        }
        if (paidRows && paidRows.length > 0) {
          return NextResponse.json({ error: '이미 납부한 학생입니다 (중복 청구 방지)', code: 'ALREADY_PAID' }, { status: 409 })
        }
      }

      // 2026-07-31 조용한실패 점검: 위와 같은 이유로 error면 fail-closed(발송 중단).
      const { data: existingBills, error: existingErr } = await supabase
        .from('tuition_bill_history')
        .select('bill_id, status, is_regular_tuition, bill_type')
        .eq('student_id', studentId)
        .eq('billing_month', billingMonth)
        .in('status', ['sent', 'paid'])

      if (existingErr) {
        console.error('[PaySsam] 기존 청구서 조회 실패 — 이중청구 방지로 발송 중단:', existingErr)
        return NextResponse.json({
          error: '기존 청구서 조회에 실패해 발송을 중단했습니다 (이중청구 방지). 잠시 후 다시 시도하세요.',
          code: 'GUARD_QUERY_FAILED',
          detail: existingErr.message,
        }, { status: 500 })
      }

      const regularBills = (existingBills ?? []).filter(b => b.is_regular_tuition !== false && (b.bill_type ?? 'regular') === billType)
      if (regularBills.length > 0) {
        const activeBill = regularBills.find(b => b.status === 'sent')
        const paidBill = regularBills.find(b => b.status === 'paid')

        if (paidBill) {
          return NextResponse.json({ error: '이미 결제 완료된 청구서가 있습니다', code: 'ALREADY_PAID' }, { status: 409 })
        }
        if (activeBill) {
          return NextResponse.json({ error: '이미 발송된 청구서가 있습니다. 기존 청구서를 파기한 후 다시 발송해주세요.', code: 'ALREADY_SENT', bill_id: activeBill.bill_id }, { status: 409 })
        }
      }
    }

    // 영업시간(평일 11:00~22:00, 토 11:00~20:00 KST) 외 요청 → 큐에 예약
    if (!isBusinessHourKst()) {
      const scheduledAt = nextBusinessSlot()
      const resolvedProductName = productName || defaultBillProductName(billingMonth)
      const resolvedMessage = (typeof message === 'string' && message.trim()) ? message : defaultBillMessage(studentName, billingMonth)

      const { error: queueError } = await supabase.from('tuition_bill_queue').insert({
        student_id: studentId,
        student_name: studentName,
        phone: cleanPhone,
        billing_month: billingMonth,
        is_regular_tuition: isRegular,
        bill_type: billType,
        bill_note: typeof billNote === 'string' && billNote.trim() ? billNote.trim() : null,
        send_type: 'single',
        payload: { amount, productName: resolvedProductName, message: resolvedMessage },
        scheduled_at: scheduledAt.toISOString(),
        status: 'pending',
      })

      if (queueError) {
        console.error('[PaySsam] 큐 등록 실패:', queueError)
        return NextResponse.json({ error: '예약 등록 실패' }, { status: 500 })
      }

      return scheduledResponse(scheduledAt)
    }

    const result = await sendBill({
      studentName,
      phone: cleanPhone,
      amount,
      productName: productName || defaultBillProductName(billingMonth),
      message: (typeof message === 'string' && message.trim()) ? message : defaultBillMessage(studentName, billingMonth),
    })

    if (result.code === '0000') {
      // 청구서 발송 성공 → DB에 기록
      const { error: dbError } = await recordSentBill({
        student_id: studentId,
        bill_id: result.bill_id,
        amount,
        billing_month: billingMonth,
        phone: cleanPhone,
        short_url: (result as { shortURL?: string }).shortURL ?? null,
        sent_at: new Date().toISOString(),
        is_regular_tuition: isRegular,
        bill_type: billType,
        bill_note: typeof billNote === 'string' && billNote.trim() ? billNote.trim() : null,
      })

      if (dbError) {
        // 2026-07-05 9app-full-review: DB기록 실패를 감사로그로 에스컬레이션(callback/cron과 동일 계약).
        // 청구서는 발송됐는데 tuition_bill_history에 흔적이 없으면 중복발송 가드가 눈멀어 재발송시 이중청구.
        console.error('[PaySsam] DB 기록 실패 (청구서는 발송됨):', dbError)
        await writeAuditLog('payment', studentId, 'update',
          `⚠️ 청구서 발송됨 but DB기록 실패: ${studentName ?? ''} ${billingMonth} — 중복발송 가드 사각, 수동확인 필요`,
          { billId: result.bill_id, error: dbError.message })
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[PaySsam] 청구서 발송 실패:', error)
    return NextResponse.json({ error: '청구서 발송 중 오류가 발생했습니다' }, { status: 500 })
  }
}
