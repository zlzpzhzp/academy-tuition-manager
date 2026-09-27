import { NextRequest, NextResponse } from 'next/server'
import { recordSentBill } from '@/lib/billHistory'
import { writeAuditLog } from '@/lib/auditLog'
import { sendBill, destroyBill } from '@/lib/payssam'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { isBusinessHourKst, nextBusinessSlot, formatKst } from '@/lib/schedule'
import { normalizePhone } from '@/lib/student-codes'

/**
 * 중도퇴원 정산 원클릭: 이미 결제완료(paid)된 정규 청구서가 있는 학생이 중도 퇴원 →
 * 실수강분 금액으로 '정산분 청구서'를 발송하고, 그 정산분이 결제 완료되면 기존 완납분을 환불.
 *
 * ⚠️ 순서 (2026-07-15 원장 지시): 기존 결제를 '먼저 취소(환불)'하지 않는다.
 *   정산분(정확한 금액) 청구서를 먼저 발송 → 이 청구서가 '결제 완료'되면(콜백) 그때 기존 완납분을 취소(환불).
 *   → 정산분이 결제 안 되면 기존 결제는 그대로 유지(환불 안 됨) = 재청구 누락으로 인한 학원 손실 방지.
 *   연결: 새 청구서의 supersedes_bill_id = 기존 완납 bill_id. 콜백이 이 링크를 보고 기존 결제를 취소.
 *
 * 퇴원 처리 메뉴(WithdrawActionMenu)의 "취소 후 수업분 재청구" 버튼이 호출.
 * 실제 환불 취소 로직은 콜백(/api/payssam/callback)에서 처리.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  // 2026-07-26 감사: destroyBill/sendBill은 HTTP non-2xx에서 throw한다(payssam.ts:52). 그러면 아래
  //   outer catch로 빠지는데, 이미 파기한 미납분 목록이 로그에도 응답에도 안 남아 '청구서 없는 학생'이
  //   조용히 생긴다. catch에서도 읽을 수 있도록 try 밖에 둔다.
  const destroyedUnpaid: string[] = []
  let ctxStudentId: string | null = null
  let ctxStudentName = ''
  let ctxMonth = ''
  try {
    const { studentId, studentName, phone, billingMonth, resumedAmount, productName, message, dryRun } = await request.json()
    // dryRun: 아무것도 발송·파기하지 않고 '무엇을 할 것인지'만 판정해서 돌려준다.
    // 화면이 자기 캐시로 안내문구를 지어내면 실제 동작과 어긋날 수 있다(한 달에 완납분과 미납분이
    // 함께 있는 학생 등). 확인창에 띄울 문구를 서버 판정으로 받아가게 해서 '보인 것 = 실행되는 것'을
    // 코드로 보장한다. (2026-07-22 운영자님 지적 — "버튼 두 개로 나누는 게 안전하지 않나")
    const isDryRun = dryRun === true
    if (!studentId || !billingMonth || !resumedAmount) {
      return NextResponse.json({ error: '필수 정보가 누락되었습니다' }, { status: 400 })
    }
    if (resumedAmount <= 0) {
      return NextResponse.json({ error: '재청구 금액은 0원보다 커야 합니다' }, { status: 400 })
    }

    // 0) 중복 정산 차단 — 이미 발송된(미결제) 정산분이 있으면 거부. (2026-07-19 코드검수 P1)
    //   없으면: 정산분 발송 후 학부모가 아직 결제 안 한 동안 기존 완납분은 status='paid' 그대로라(설계상 의도)
    //   관리자가 "안 갔나?" 하고 재클릭하면 같은 완납분을 또 잡아 정산 청구서가 2장 나간다.
    //   둘 다 결제되면 콜백의 `oldBill.status==='paid'` 조건이 2회차 환불을 막아 환불은 1회 → 학부모 초과납부.
    //   ※ 이미 결제완료된 정산분도 차단 대상: 그 정산분 자체가 regular/paid라 다음 호출의 환불대상으로 잡혀
    //     '정산분을 정산하는' 체인이 생긴다.
    // 2026-07-31 조용한실패 점검: supabase-js는 오류를 throw하지 않고 {data:null,error}로 resolve한다.
    // error를 무시하면 DB 장애가 '기존 정산분 없음'과 같아져 중복 정산 가드가 fail-open된다
    // (정산 청구서 2장 발송 → 둘 다 결제 시 환불은 1회 = 학부모 초과납부).
    // 가드는 막는 쪽이 안전 — 조회 실패 시 아무것도 파기·발송하지 않고 500.
    const { data: existingResettles, error: existingResettlesErr } = await supabase
      .from('tuition_bill_history')
      .select('bill_id, status, amount, billing_month, supersedes_bill_id')
      .eq('student_id', studentId)
      .eq('bill_note', '중도퇴원 정산')
      .in('status', ['sent', 'paid'])
      .limit(5)
    if (existingResettlesErr) {
      console.error('[PaySsam resettle] 기존 정산분 조회 실패 — 중복정산 방지로 중단:', existingResettlesErr)
      return NextResponse.json({
        error: '기존 정산분 조회에 실패해 중단했습니다 (중복 정산 방지). 잠시 후 다시 시도하세요.',
        code: 'GUARD_QUERY_FAILED',
        detail: existingResettlesErr.message,
      }, { status: 500 })
    }
    const liveResettle = (existingResettles ?? [])[0]
    if (liveResettle) {
      return NextResponse.json({
        error: liveResettle.status === 'paid'
          ? `이미 정산이 완료된 학생입니다 (정산분 ${Number(liveResettle.amount).toLocaleString()}원 결제완료).`
          : `이미 발송된 정산분 청구서가 있습니다 (${Number(liveResettle.amount).toLocaleString()}원, 결제대기). 중복 청구를 막기 위해 차단했습니다. 다시 보내려면 기존 정산분을 먼저 파기하세요.`,
        code: liveResettle.status === 'paid' ? 'RESETTLE_ALREADY_PAID' : 'RESETTLE_ALREADY_SENT',
        billId: liveResettle.bill_id,
      }, { status: 409 })
    }
    // 예약(큐) 대기 중인 정산분도 차단 — 영업시간 외 예약 직후 재클릭 방어
    const { data: queuedResettle, error: queuedResettleErr } = await supabase
      .from('tuition_bill_queue')
      .select('id, billing_month')
      .eq('student_id', studentId)
      .eq('bill_note', '중도퇴원 정산')
      .eq('status', 'pending')
      .limit(1)
    // 2026-07-31 조용한실패 점검: 위와 동일 — error면 '예약 없음'과 구별되지 않아 중복 예약이 뚫린다.
    if (queuedResettleErr) {
      console.error('[PaySsam resettle] 정산 예약 조회 실패 — 중복정산 방지로 중단:', queuedResettleErr)
      return NextResponse.json({
        error: '정산분 예약 조회에 실패해 중단했습니다 (중복 정산 방지). 잠시 후 다시 시도하세요.',
        code: 'GUARD_QUERY_FAILED',
        detail: queuedResettleErr.message,
      }, { status: 500 })
    }
    if (queuedResettle && queuedResettle.length > 0) {
      return NextResponse.json({
        error: '이미 정산분 재청구가 예약되어 있습니다 (영업시간에 자동 발송). 중복 예약을 막기 위해 차단했습니다.',
        code: 'RESETTLE_ALREADY_SCHEDULED',
      }, { status: 409 })
    }

    // 1) 정산 방식 판정 — 보고 있는 달의 정규 청구서 상태로 갈린다.
    //   (a) 결제완료(paid) → '환불형': 정산분 발송 → 결제완료되면 콜백이 기존 완납분을 환불 (기존 흐름)
    //   (b) 미납(sent)     → '미납형': 환불할 돈이 없다. 미납 청구서를 파기하고 실수강분만 재청구.
    //   ⚠️ (b)를 폴백보다 먼저 걸러야 한다. 미납인데 폴백이 돌면 이미 만근한 지난달 완납분을
    //      환불 대상으로 집어와 엉뚱한 달이 취소된다. (2026-07-22 마동석 — 7월 미납인데 6월 완납분이 잡혔음)
    const isRegularBill = (b: { is_regular_tuition: boolean | null; bill_type: string | null }) =>
      b.is_regular_tuition !== false && (b.bill_type ?? 'regular') === 'regular'

    const { data: monthBills, error: monthBillsErr } = await supabase
      .from('tuition_bill_history')
      .select('bill_id, amount, status, is_regular_tuition, bill_type, phone, billing_month')
      .eq('student_id', studentId)
      .eq('billing_month', billingMonth)
      .in('status', ['paid', 'sent'])

    if (monthBillsErr) {
      console.error('[PaySsam resettle] 당월 청구서 조회 실패 — 정산 중단:', monthBillsErr)
      return NextResponse.json({
        error: '당월 청구서 조회에 실패해 중단했습니다 (잘못된 정산 방지). 잠시 후 다시 시도하세요.',
        code: 'GUARD_QUERY_FAILED',
        detail: monthBillsErr.message,
      }, { status: 500 })
    }

    let paidBill = (monthBills ?? []).filter(b => b.status === 'paid').find(isRegularBill)
    const unpaidBills = (monthBills ?? []).filter(b => b.status === 'sent' && isRegularBill(b))

    // 폴백: 보고 있는 달에 정규 청구서가 '아예 없을' 때만 가장 최근 결제완료 정규분으로 정산.
    // 결제일이 월 후반(예: 23일)이면 다음 달 청구 전에 퇴원하는 케이스 (2026-07-16 공유)
    // 미납분이 있으면 폴백하지 않는다 — 위 (b) 미납형으로 간다.
    // ⚠️ 2026-09-05 astra 병합 검수: 조건을 `monthBills.length === 0`(청구서 전무)로 좁힌 제안은 되돌렸다 —
    //    당월에 특강·선택과목 청구서만 있는 학생(실측 6쌍)의 정산이 404로 막힌다. 조회 오류는 위 GUARD 가 잡는다.
    if (!paidBill && unpaidBills.length === 0) {
      // 월 하한 = 직전 달. 없으면 몇 달 묵은 완납분(예: 6·7월 미납인 학생의 5월분)이 환불 대상이 되어
      // 이미 수강을 마친 과거 달 결제가 취소된다. 정산액은 현재 요금 기준이라 금액도 어긋난다. (검수 P1)
      const [y, m] = billingMonth.split('-').map(Number)
      const prevD = new Date(y, m - 2, 1) // m-1이 당월 index → m-2가 직전 달
      const minMonth = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`
      const { data: recentBills, error: recentBillsErr } = await supabase
        .from('tuition_bill_history')
        .select('bill_id, amount, status, is_regular_tuition, bill_type, phone, billing_month')
        .eq('student_id', studentId)
        .eq('status', 'paid')
        .gte('billing_month', minMonth)
        .lte('billing_month', billingMonth)
        .order('billing_month', { ascending: false })
        .limit(5)
      if (recentBillsErr) {
        console.error('[PaySsam resettle] 최근 청구서 조회 실패 — 정산 중단:', recentBillsErr)
        return NextResponse.json({
          error: '최근 청구서 조회에 실패해 중단했습니다 (잘못된 정산 방지). 잠시 후 다시 시도하세요.',
          code: 'GUARD_QUERY_FAILED',
          detail: recentBillsErr.message,
        }, { status: 500 })
      }

      paidBill = (recentBills ?? []).find(isRegularBill)
    }
    if (!paidBill && unpaidBills.length === 0) {
      return NextResponse.json({ error: '정산할 청구서가 없습니다 (결제완료분도 미납분도 없음). 일반 청구로 발송하세요.' }, { status: 404 })
    }

    /** 'refund' = 완납분 환불형(정산분 결제완료 시 콜백이 환불) / 'unpaid' = 미납형(미납분 파기 후 실수강분만 청구) */
    const mode: 'refund' | 'unpaid' = paidBill ? 'refund' : 'unpaid'
    const baseBill = paidBill ?? unpaidBills[0]

    // 정산 기준 월 = 실제 대상 청구서의 월. 폴백 시 상품명/문구도 그 월 기준으로 재생성
    // (기록·콜백 환불·납부 대체가 전부 같은 월에 정합되도록)
    const effectiveMonth: string = baseBill.billing_month
    const monthLabel = effectiveMonth.replace('-', '년 ')
    const fellBack = effectiveMonth !== billingMonth

    /**
     * 정산 진행상태 마킹. 폴백이 걸리면 effectiveMonth(과거 달)에만 쓰던 탓에,
     * 관리자가 보고 있는 달(billingMonth) 화면엔 '정산 처리중' 배지가 안 떠서
     * "아무 일도 안 일어났다"→재클릭→중복발송의 방아쇠가 됐다. 두 달 모두에 기록한다. (검수 P1)
     */
    const markResettleStatus = async (status: 'resettle_pending' | 'resettle_scheduled') => {
      const months = fellBack ? [effectiveMonth, billingMonth] : [effectiveMonth]
      const now = new Date().toISOString()
      await supabase.from('tuition_withdrawal_status').upsert(
        months.map(mm => ({ student_id: studentId, billing_month: mm, status, updated_at: now })),
        { onConflict: 'student_id,billing_month' },
      )
    }

    // 2) 재청구 전화번호 확인 (발송 전에 미리 검증 — 무효면 아무것도 안 함)
    const cleanPhone = normalizePhone(String(phone || baseBill.phone || ''))
    if (!/^01[016789]\d{7,8}$/.test(cleanPhone)) {
      return NextResponse.json({ error: '재청구 전화번호가 유효하지 않습니다.' }, { status: 422 })
    }

    const resolvedProductName = (fellBack || !productName)
      ? `${monthLabel}월 수업료 (중도퇴원 정산)`
      : productName
    // 미납형은 환불할 기존 결제가 없다 — '기존 결제금액은 취소 처리' 문구를 쓰면 거짓말이 된다.
    const defaultMessage = mode === 'unpaid'
      ? `${studentName} ${monthLabel}월 수업료 정산분입니다. 실제 수강하신 만큼만 청구드리며, 기존 청구서는 파기했습니다.`
      : `${studentName} ${monthLabel}월 수업료 정산분입니다. 결제해 주시면 기존 결제금액은 취소 처리 후 영수증을 보내드립니다.`
    const resolvedMessage = (!fellBack && mode === 'refund' && typeof message === 'string' && message.trim())
      ? message
      : defaultMessage

    // dryRun — 여기까지가 '판정'. 실제 파기·발송은 이 아래부터라 여기서 끊으면 부작용이 0이다.
    if (isDryRun) {
      return NextResponse.json({
        dryRun: true,
        mode,
        effectiveMonth,
        fellBack,
        resumedAmount,
        phone: cleanPhone,
        productName: resolvedProductName,
        message: resolvedMessage,
        ...(mode === 'refund'
          ? { refundTarget: { billId: baseBill.bill_id, amount: baseBill.amount, billingMonth: baseBill.billing_month } }
          : { destroyTargets: unpaidBills.map(b => ({ billId: b.bill_id, amount: b.amount })) }),
        // 확인창에 그대로 띄울 문구 — 화면이 지어내지 않고 서버 판정을 받아 쓴다.
        planText: mode === 'refund'
          ? `기존 결제 ${Number(baseBill.amount).toLocaleString()}원(${baseBill.billing_month})은 지금 취소하지 않습니다.\n`
            + `정산분 ${Number(resumedAmount).toLocaleString()}원을 청구하고, 그게 결제 완료되면 기존 결제가 자동 환불됩니다.`
          : `미납 청구서 ${unpaidBills.map(b => `${Number(b.amount).toLocaleString()}원`).join(', ')}을 먼저 파기합니다.\n`
            + `그 다음 실수강분 ${Number(resumedAmount).toLocaleString()}원을 청구합니다. 환불되는 금액은 없습니다(낸 돈 없음).`,
      })
    }

    /**
     * 미납형: 살아있는 미납 청구서를 먼저 파기한다.
     * 순서가 중요 — 파기 전에 정산분을 보내면 두 장이 동시에 살아있어 학부모가 전액(43만)을
     * 결제해버릴 수 있다. 파기 후 발송이면 최악의 경우에도 '청구서 없음'이라 재발송으로 복구된다.
     * (같은 원칙: 특강 명단 제외 시에도 파기 선행 — 2026-07-21)
     */
    ctxStudentId = studentId
    ctxStudentName = studentName ?? ''
    ctxMonth = effectiveMonth
    if (mode === 'unpaid') {
      for (const b of unpaidBills) {
        const r = await destroyBill(b.bill_id, b.amount)
        if (r.code !== '0000') {
          // 앞 건이 이미 파기됐을 수 있다(부분 파기 상태) — 조용히 끝내면 추적이 안 되므로 반드시 남긴다.
          await writeAuditLog('payment', studentId, 'update',
            `⚠️ 중도퇴원 정산(미납형) 중단 — 미납분 파기 실패: ${studentName ?? ''} ${effectiveMonth} bill ${b.bill_id} (${r.msg || '알 수 없음'}). 이미 파기된 건: ${destroyedUnpaid.join(', ') || '없음'}. 정산분 미발송.`,
            { failedBillId: b.bill_id, alreadyDestroyed: destroyedUnpaid, resumedAmount, detail: r })
          return NextResponse.json({
            error: `미납 청구서 파기에 실패해 중단했습니다 (${b.bill_id}: ${r.msg || '알 수 없음'}). 살아있는 청구서와 정산분이 겹치면 이중결제가 되므로 재청구하지 않았습니다.`,
            code: 'DESTROY_FAILED',
            destroyedBillIds: destroyedUnpaid,
          }, { status: 502 })
        }
        await supabase
          .from('tuition_bill_history')
          .update({ status: 'destroyed', bill_note: '중도퇴원 정산으로 파기(미납분)', updated_at: new Date().toISOString() })
          .eq('bill_id', b.bill_id)
        destroyedUnpaid.push(b.bill_id)
      }
      await writeAuditLog('payment', studentId, 'update',
        `중도퇴원 정산(미납형): ${studentName ?? ''} ${effectiveMonth} 미납분 ${destroyedUnpaid.length}건 파기 후 실수강분 ${Number(resumedAmount).toLocaleString()}원 재청구`,
        { destroyed: destroyedUnpaid, resumedAmount })
    }

    // 3) 영업시간 외 → 정산분 재청구를 큐에 예약 (기존 결제는 그대로 유지). supersedesBillId를 payload에 담아
    //    크론(single)이 발송 시 supersedes 링크를 설정하도록 함.
    if (!isBusinessHourKst()) {
      const scheduledAt = nextBusinessSlot()
      const { error: queueError } = await supabase.from('tuition_bill_queue').insert({
        student_id: studentId,
        student_name: studentName,
        phone: cleanPhone,
        billing_month: effectiveMonth,
        is_regular_tuition: true,
        bill_type: 'regular',
        bill_note: '중도퇴원 정산',
        send_type: 'single',
        // 미납형은 supersedes가 없다(환불 대상 없음). resettleUnpaid는 '이 예약이 미납형 정산분'임을
        // 표시하는 진단용 마커다 — 크론의 중복발송 가드를 면제하지는 않는다(면제하면 예약 후
        // 현장 수납 시 이중청구. 2026-07-22 야간검수 지적).
        payload: mode === 'refund'
          ? { amount: resumedAmount, productName: resolvedProductName, message: resolvedMessage, supersedesBillId: baseBill.bill_id }
          : { amount: resumedAmount, productName: resolvedProductName, message: resolvedMessage, resettleUnpaid: true },
        scheduled_at: scheduledAt.toISOString(),
        status: 'pending',
      })
      if (queueError) {
        console.error('[PaySsam resettle] 큐 등록 실패:', queueError)
        if (mode === 'unpaid') {
          // 미납분은 이미 파기한 뒤라 지금 이 학생에게 살아있는 청구서가 없다 → 재청구 필요.
          await writeAuditLog('payment', studentId, 'update',
            `⚠️ 중도퇴원 정산(미납형) 예약 등록 실패: ${studentName ?? ''} ${effectiveMonth} — 미납분 ${destroyedUnpaid.join(', ')} 파기됨 but 정산분 예약 안 됨. 청구서 없는 상태이므로 재청구 필요.`,
            { destroyed: destroyedUnpaid, resumedAmount, error: queueError.message })
          return NextResponse.json({
            error: '미납 청구서는 파기됐으나 정산분 예약에 실패했습니다. 현재 청구서가 없는 상태이니 다시 시도하세요.',
            destroyedBillIds: destroyedUnpaid,
          }, { status: 500 })
        }
        return NextResponse.json({ error: '정산분 재청구 예약 등록 실패' }, { status: 500 })
      }
      // 예약됨 → 학생 줄에 '정산 예약됨' 표시 (발송~결제 사이 진행상태 가시화, 2026-07-18 원장 지시)
      await markResettleStatus('resettle_scheduled')
      return NextResponse.json({
        scheduled: true,
        code: 'SCHEDULED',
        msg: mode === 'refund'
          ? `정산분 재청구가 영업시간 외라 ${formatKst(scheduledAt)} KST 에 자동 발송됩니다. (정산분 결제완료 시 기존 결제 자동 환불)`
          : `미납 청구서를 파기했고, 정산분 재청구는 영업시간 외라 ${formatKst(scheduledAt)} KST 에 자동 발송됩니다.`,
        scheduled_at_kst: formatKst(scheduledAt),
        mode,
        ...(mode === 'refund' ? { supersedesBillId: baseBill.bill_id } : { destroyedBillIds: destroyedUnpaid }),
      })
    }

    // 4) 정산분 청구서 발송 (supersedes = 기존 완납분 bill_id). 기존 결제는 아직 취소하지 않음.
    let sendResult: { code?: string; msg?: string; bill_id?: string; shortURL?: string }
    try {
      sendResult = await sendBill({
        studentName,
        phone: cleanPhone,
        amount: resumedAmount,
        productName: resolvedProductName,
        message: resolvedMessage,
      })
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      if (mode === 'unpaid' && destroyedUnpaid.length > 0) {
        // 미납형은 이미 미납분을 파기한 뒤다 — '발송 여부 불명확' 과 '지금 살아있는 청구서가 없다' 두 사실을 다 남긴다.
        // (2026-07-26 감사 안전장치 = destroyedBillIds 응답 + 감사로그. 9/7 코드 검수: 불명확 분기가 이걸 삼키던 회귀 차단)
        await writeAuditLog('payment', studentId, 'update',
          `⚠️ 중도퇴원 정산(미납형) 발송 결과 불명확: ${studentName ?? ''} ${effectiveMonth} — 미납분 ${destroyedUnpaid.join(', ')} 파기 완료, 정산분은 결제선생 응답 없음. 결제선생에서 실발송 여부 확인 후 수동 처리(미발송이면 재청구 필요).`,
          { destroyed: destroyedUnpaid, resumedAmount, error: errMsg })
        return NextResponse.json({
          code: 'SEND_RESULT_UNKNOWN',
          error: '미납 청구서는 파기됐으나 정산분 발송 응답을 받지 못했습니다. 결제선생에서 발송 여부를 확인한 뒤(미발송이면 재청구) 처리하세요.',
          destroyedBillIds: destroyedUnpaid,
        }, { status: 502 })
      }
      await writeAuditLog('payment', studentId, 'update',
        `⚠️ 발송 결과 불명확: ${effectiveMonth} [resettle] — 결제선생에서 실발송 여부 확인 후 수동 처리`,
        { error: errMsg })
      return NextResponse.json({ code: 'SEND_RESULT_UNKNOWN', error: '결제선생 응답을 받지 못했습니다. 결제선생에서 발송 여부를 확인한 뒤 다시 시도하세요.' }, { status: 502 })
    }

    if (sendResult.code !== '0000') {
      if (mode === 'unpaid') {
        // 미납형은 이미 미납분을 파기한 뒤라 지금 학생에게 살아있는 청구서가 없다.
        // 돈이 잘못 나간 건 아니지만 청구가 비므로 재시도해야 한다 → 감사로그로 남긴다.
        await writeAuditLog('payment', studentId, 'update',
          `⚠️ 중도퇴원 정산(미납형) 발송 실패: ${studentName ?? ''} ${effectiveMonth} — 미납분 ${destroyedUnpaid.join(', ')} 파기됨 but 정산분 미발송. 청구서 없는 상태이므로 재청구 필요.`,
          { destroyed: destroyedUnpaid, resumedAmount, detail: sendResult })
        return NextResponse.json({
          error: '미납 청구서는 파기됐으나 정산분 발송에 실패했습니다. 현재 청구서가 없는 상태이니 다시 시도하세요.',
          detail: sendResult,
          destroyedBillIds: destroyedUnpaid,
        }, { status: 502 })
      }
      // 발송 실패 → 기존 결제 그대로 유지(환불 안 함). 손실 없음.
      return NextResponse.json({ error: '정산분 재청구 발송 실패 — 기존 결제는 그대로 유지됩니다.', detail: sendResult }, { status: 502 })
    }

    const { error: dbErr } = await recordSentBill({
      student_id: studentId,
      bill_id: sendResult.bill_id as string,
      amount: resumedAmount,
      billing_month: effectiveMonth,
      phone: cleanPhone,
      short_url: sendResult.shortURL ?? null,
      sent_at: new Date().toISOString(),
      is_regular_tuition: true,
      bill_type: 'regular',
      bill_note: '중도퇴원 정산',
      // 미납형은 환불 대상이 없으므로 supersedes를 걸지 않는다(걸면 콜백이 엉뚱한 환불을 시도).
      ...(mode === 'refund' ? { supersedes_bill_id: baseBill.bill_id } : {}),
    })
    if (dbErr) {
      // supersedes 링크가 DB에 안 남으면 콜백이 기존 결제를 자동 환불 못 함 → 반드시 에스컬레이션.
      console.error('[PaySsam] resettle DB기록 실패:', dbErr)
      await writeAuditLog('payment', studentId, 'update',
        mode === 'refund'
          ? `⚠️ 중도퇴원 정산분 발송됨 but DB기록 실패: ${studentName ?? ''} ${effectiveMonth} — supersedes 링크 유실, 정산분 결제완료돼도 기존 완납 bill ${baseBill.bill_id} 자동환불 안 될 수 있음. 수동 확인 필요.`
          : `⚠️ 중도퇴원 정산분(미납형) 발송됨 but DB기록 실패: ${studentName ?? ''} ${effectiveMonth} — 화면·납부기록에 안 잡힐 수 있음. 수동 확인 필요.`,
        { billId: sendResult.bill_id, supersedes: mode === 'refund' ? baseBill.bill_id : null, error: dbErr.message })
    }

    // 정산분 발송됨 → '정산 처리중(결제대기)' 마킹. 결제완료 콜백이 'resettled_paid'(완료)로 덮어씀.
    // (발송~결제 사이 화면에 진행상태가 안 보이던 공백 해소, 2026-07-18 원장 지시)
    await markResettleStatus('resettle_pending')

    return NextResponse.json({
      resent: true,
      newBillId: sendResult.bill_id,
      newAmount: resumedAmount,
      mode,
      ...(mode === 'refund'
        ? { supersedesBillId: baseBill.bill_id, supersedesAmount: baseBill.amount }
        : { destroyedBillIds: destroyedUnpaid }),
      shortURL: sendResult.shortURL ?? null,
      msg: mode === 'refund'
        ? '정산분 청구서를 발송했습니다. 이 청구서가 결제 완료되면 기존 결제가 자동 환불됩니다.'
        : `미납 청구서 ${destroyedUnpaid.length}건을 파기하고 실수강분 청구서를 발송했습니다.`,
    })
  } catch (error) {
    console.error('[PaySsam] 정산 재청구 실패:', error)
    if (destroyedUnpaid.length > 0) {
      // 미납분을 파기한 뒤 예외로 끊겼다 — 이 학생에겐 살아있는 청구서가 없다.
      // 위 code!=='0000' 경로와 같은 취급(감사로그 + 파기된 bill_id 반환). (2026-07-26 감사)
      await writeAuditLog('payment', ctxStudentId, 'update',
        `⚠️ 중도퇴원 정산(미납형) 처리 중 오류: ${ctxStudentName} ${ctxMonth} — 미납분 ${destroyedUnpaid.join(', ')} 파기됨 but 정산분 미발송. 청구서 없는 상태이므로 재청구 필요.`,
        { destroyed: destroyedUnpaid, error: error instanceof Error ? error.message : String(error) })
      return NextResponse.json({
        error: '미납 청구서는 파기됐으나 정산분 처리 중 오류가 발생했습니다. 현재 청구서가 없는 상태이니 다시 시도하세요.',
        destroyedBillIds: destroyedUnpaid,
      }, { status: 500 })
    }
    return NextResponse.json({ error: '정산 재청구 중 오류가 발생했습니다' }, { status: 500 })
  }
}
