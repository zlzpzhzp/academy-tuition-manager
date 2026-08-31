import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { validateInput, rules } from '@/lib/validate'
import { writeAuditLog } from '@/lib/auditLog'

const DESTROY_DELAY_MS = 60 * 60 * 1000 // 1시간 (착각 복구용 버퍼)

const METHOD_LABEL: Record<string, string> = {
  card: '카드',
  transfer: '계좌이체',
  cash: '현금',
  payssam: '결제선생',
  remote: '비대면',
  pay: '간편결제(PAY)',
  other: '기타',
}

export async function GET(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { searchParams } = new URL(request.url)
  const studentId = searchParams.get('student_id')
  const billingMonth = searchParams.get('billing_month')

  // 2026-05-22: deleted_at IS NULL 필터링 — soft-delete row(취소된 결제)는 UI에서 제외
  let query = supabase.from('tuition_payments').select('id, student_id, amount, method, payment_date, billing_month, cash_receipt, receipt_images, memo, created_at').is('deleted_at', null).order('payment_date', { ascending: false })
  if (studentId) query = query.eq('student_id', studentId)
  if (billingMonth) query = query.eq('billing_month', billingMonth)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // 2026-05-19: 브라우저 HTTP 캐시(max-age=5)가 SWR mutate 후 강제 fetch를
  // 가로채서 결제 처리 후 UI 갱신 안 되는 버그. no-store로 항상 server에 가지만
  // SWR 자체 클라이언트 캐시(dedupingInterval 5초)는 그대로 작동.
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export async function POST(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const body = await request.json()

  const validMethods = ['card', 'transfer', 'cash', 'payssam', 'remote', 'pay', 'other']
  const validationError = validateInput([
    rules.required('student_id', body.student_id),
    rules.required('amount', body.amount),
    rules.nonNegativeNumber('amount', body.amount),
    rules.validDate('payment_date', body.payment_date),
    rules.billingMonth('billing_month', body.billing_month),
    rules.oneOf('method', body.method, validMethods),
  ])
  if (validationError) return validationError

  const payload = {
    student_id: body.student_id,
    amount: body.amount,
    method: body.method,
    payment_date: body.payment_date,
    billing_month: body.billing_month,
    cash_receipt: body.cash_receipt ?? null,
    memo: body.memo || null,
  }

  const { data, error } = await supabase
    .from('tuition_payments')
    .insert(payload)
    .select('*, student:tuition_students(*)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const paymentWithStudent = data as { student?: { name?: string } | null } | null
  const studentName = paymentWithStudent?.student?.name ?? body.student_id
  await writeAuditLog('payment', data.id, 'create',
    `납부 등록: ${studentName} ${body.billing_month} ${body.amount?.toLocaleString()}원`,
    { ...payload, student_name: studentName })

  // 다른 결제수단으로 저장 시 같은 학생·월의 미결제 PaySsam 청구서 1시간 뒤 파기 예약
  // 즉시 파기하지 않는 이유: 착각 입력을 1시간 이내 취소하면 청구서 복구 가능해야 함.
  // 파기 예약이 안 걸리면 결제선생 청구서가 살아남아 학부모가 또 낸다 → 실패를 화면·감사에 표면화. (2026-07-26 감사)
  const destroyScheduleFailed: string[] = []
  if (body.method !== 'payssam') {
    const { data: sentBills, error: sentBillsError } = await supabase
      .from('tuition_bill_history')
      .select('bill_id, amount, phone')
      .eq('student_id', body.student_id)
      .eq('billing_month', body.billing_month)
      .eq('is_regular_tuition', true)
      .eq('status', 'sent')

    // 2026-07-31 조용한실패 점검: supabase-js는 오류를 throw하지 않고 {data:null,error}로 resolve한다.
    // error를 무시하면 '살아있는 청구서 없음'과 구별되지 않아 파기 예약이 통째로 조용히 스킵된다
    // (결제선생 청구서가 살아남아 학부모 이중결제). 큐 insert 실패와 동일하게 감사로그 + 응답으로 표면화.
    if (sentBillsError) {
      console.error('[delayed-destroy] 파기 대상 청구서 조회 실패:', body.student_id, sentBillsError)
      destroyScheduleFailed.push('(조회 실패)')
      await writeAuditLog('payment', body.student_id, 'update',
        `⚠️ ${METHOD_LABEL[body.method] || body.method} 납부 기록됨 but 청구서 조회 실패로 자동파기 예약 안 됨: ${studentName} ${body.billing_month} — 라이브 청구서 방치 위험, 수동 파기 확인 필요`,
        { paymentId: data.id, error: sentBillsError.message })
    }

    if (sentBills && sentBills.length > 0) {
      const methodLabel = METHOD_LABEL[body.method] || body.method
      const { data: studentRow } = await supabase
        .from('tuition_students')
        .select('name')
        .eq('id', body.student_id)
        .single()
      const studentName = studentRow?.name ?? ''
      const scheduledAt = new Date(Date.now() + DESTROY_DELAY_MS)
      for (const bill of sentBills) {
        const { error: queueError } = await supabase.from('tuition_bill_queue').insert({
          student_id: body.student_id,
          student_name: studentName,
          phone: bill.phone ?? '',
          billing_month: body.billing_month,
          is_regular_tuition: true,
          bill_note: `${methodLabel} 결제 — 1시간 뒤 청구서 자동 파기`,
          send_type: 'destroy',
          payload: { billId: bill.bill_id, amount: bill.amount, methodLabel, paymentId: data.id },
          scheduled_at: scheduledAt.toISOString(),
          status: 'pending',
        })
        if (queueError) {
          // 이건 이중결제 방지 장치다 — 예약이 안 걸리면 결제선생 청구서가 살아남아 학부모가 또 낼 수 있다.
          // 특강(/api/special/pay)은 이미 감사로그 + 응답 표면화를 하는데 정규만 조용했다. (2026-07-26 감사)
          console.error('[delayed-destroy] 큐 등록 실패:', bill.bill_id, queueError)
          destroyScheduleFailed.push(bill.bill_id)
          await writeAuditLog('payment', body.student_id, 'update',
            `⚠️ ${methodLabel} 납부 기록됨 but 청구서 자동파기 예약 실패: ${studentName} ${body.billing_month} bill ${bill.bill_id} — 라이브 청구서 방치 위험, 수동 파기 필요`,
            { billId: bill.bill_id, paymentId: data.id, error: queueError.message })
        }
      }
    }
  }

  return NextResponse.json({
    ...data,
    // 파기 예약이 하나라도 실패하면 화면이 알 수 있게 — 조용히 성공으로 보이면 안 된다.
    ...(destroyScheduleFailed.length > 0 ? { destroyScheduleFailed } : {}),
  })
}
