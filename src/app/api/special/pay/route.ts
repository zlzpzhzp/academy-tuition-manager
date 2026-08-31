import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { writeAuditLog } from '@/lib/auditLog'
import { getTodayString } from '@/lib/date'
import { SPECIAL_LABEL } from '../route'

const DESTROY_DELAY_MS = 60 * 60 * 1000 // 1시간 (착각 복구용 버퍼) — 정규 payments와 동일
const METHOD_LABEL: Record<string, string> = {
  card: '카드', transfer: '계좌이체', cash: '현금', pay: '간편결제(PAY)', other: '기타',
}

/** 특강비 직접 납부 기록 (현장 카드/현금/이체/PAY 등). 결제선생 청구와 별개. */
export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  try {
    const { studentId, amount, method, memo, label, paidAt } = await request.json()
    if (!studentId || !amount || !method) {
      return NextResponse.json({ error: '필수 정보가 누락되었습니다' }, { status: 400 })
    }
    // 금액·수단 타입 검증 — 음수/문자열 금액, 미정의 수단이 그대로 저장되던 구멍 (2026-07-10 전수점검 L6)
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: '금액은 양수여야 합니다' }, { status: 400 })
    }
    const validMethods = ['card', 'transfer', 'cash', 'pay', 'other']
    if (!validMethods.includes(method)) {
      return NextResponse.json({ error: '올바르지 않은 결제수단입니다' }, { status: 400 })
    }
    // 납부일 지정 (선택) — 지난 계좌이체를 뒤늦게 기록하는 경우가 있어 과거 날짜 허용.
    // 미지정 시 오늘. 미래 날짜는 오입력이므로 차단. (2026-07-18 제니 이중결제 정리 중 필요해서 추가)
    let paidDate = getTodayString()
    if (paidAt !== undefined && paidAt !== null && paidAt !== '') {
      if (typeof paidAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) {
        return NextResponse.json({ error: '납부일은 YYYY-MM-DD 형식이어야 합니다' }, { status: 400 })
      }
      if (paidAt > getTodayString()) {
        return NextResponse.json({ error: '납부일은 미래일 수 없습니다' }, { status: 400 })
      }
      paidDate = paidAt
    }
    const { data, error } = await supabase
      .from('tuition_special_payment')
      .insert({
        student_id: studentId,
        label: typeof label === 'string' && label.trim() ? label.trim() : SPECIAL_LABEL,
        amount,
        method,
        memo: typeof memo === 'string' && memo.trim() ? memo.trim() : null,
        paid_at: paidDate,
      })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // 다른 결제수단으로 특강비를 받았으면, 같은 특강(label==bill_note)의 미결제 결제선생 청구서를
    // 1시간 뒤 자동 파기 예약한다. 정규 원비(/api/payments)엔 이 로직이 있었는데 특강엔 누락돼 있어서,
    // 이체/현금으로 특강 내도 결제선생 링크가 살아남아 학부모 이중결제 위험이 있었다. (2026-07-21 로제 건)
    // 즉시 파기 안 하는 이유: 착각 입력을 1시간 내 취소(DELETE)하면 청구서가 복구돼야 하므로 — 정규와 동일 버퍼.
    const destroyScheduleFailed: string[] = []
    const paidLabel = data.label
    const { data: sentBills, error: sentBillsError } = await supabase
      .from('tuition_bill_history')
      .select('bill_id, amount, phone')
      .eq('student_id', studentId)
      .eq('is_regular_tuition', false)
      .eq('bill_note', paidLabel)
      .eq('status', 'sent')
    // 2026-07-31 조용한실패 점검: supabase-js는 오류를 throw하지 않고 {data:null,error}로 resolve한다.
    // error를 무시하면 '살아있는 특강 청구서 없음'과 구별되지 않아 파기 예약이 통째로 조용히 스킵된다
    // (결제선생 링크가 살아남아 학부모 이중결제). 큐 insert 실패와 동일하게 감사로그 + 응답으로 표면화.
    if (sentBillsError) {
      console.error('[special/pay delayed-destroy] 파기 대상 청구서 조회 실패:', studentId, sentBillsError)
      destroyScheduleFailed.push('(조회 실패)')
      await writeAuditLog('payment', studentId, 'update',
        `⚠️ 특강비 ${METHOD_LABEL[method] || method} 납부 기록됨 but 청구서 조회 실패로 자동파기 예약 안 됨: ${paidLabel} — 라이브 청구서 방치 위험, 수동 파기 확인 필요`,
        { specialPaymentId: data.id, error: sentBillsError.message })
    }
    if (sentBills && sentBills.length > 0) {
      const methodLabel = METHOD_LABEL[method] || method
      const { data: studentRow } = await supabase
        .from('tuition_students').select('name').eq('id', studentId).single()
      const scheduledAt = new Date(Date.now() + DESTROY_DELAY_MS)
      for (const bill of sentBills) {
        const { error: queueError } = await supabase.from('tuition_bill_queue').insert({
          student_id: studentId,
          student_name: studentRow?.name ?? '',
          phone: bill.phone ?? '',
          billing_month: paidDate.slice(0, 7), // 오늘이 아니라 '납부일' 기준 — 과거 납부를 뒤늦게 기록할 때 큐 행이 엉뚱한 달로 잡히던 것 (2026-07-22 검수 #7)
          is_regular_tuition: false,
          bill_note: `${methodLabel} 결제 — 1시간 뒤 특강 청구서 자동 파기`,
          send_type: 'destroy',
          payload: { billId: bill.bill_id, amount: bill.amount, methodLabel, specialPaymentId: data.id },
          scheduled_at: scheduledAt.toISOString(),
          status: 'pending',
        })
        if (queueError) {
          // 이건 이중결제 방지 장치다 — 예약이 안 걸리면 결제선생 청구서가 살아남아 학부모가 또 낼 수 있다.
          // DELETE 쪽은 해제 실패를 500으로 표면화하는데 여기만 조용하면 대칭이 안 맞는다. (2026-07-22 검수 #4)
          console.error('[special/pay delayed-destroy] 큐 등록 실패:', bill.bill_id, queueError)
          destroyScheduleFailed.push(bill.bill_id)
          await writeAuditLog('payment', studentId, 'update',
            `⚠️ 특강비 ${methodLabel} 납부 기록됨 but 청구서 자동파기 예약 실패: ${studentRow?.name ?? ''} bill ${bill.bill_id} — 라이브 청구서 방치 위험, 수동 파기 필요`,
            { billId: bill.bill_id, specialPaymentId: data.id, error: queueError.message })
        }
      }
    }

    await writeAuditLog('payment', studentId, 'create',
      `특강비 직접 납부 기록: ${data.label} ${Number(amount).toLocaleString()}원 (${METHOD_LABEL[method] || method}, ${paidDate})`,
      { specialPaymentId: data.id, amount, method, label: data.label, paidAt: paidDate })

    return NextResponse.json({
      ok: true,
      payment: data,
      // 파기 예약이 하나라도 실패하면 화면이 알 수 있게 — 조용히 성공으로 보이면 안 된다.
      ...(destroyScheduleFailed.length > 0 ? { destroyScheduleFailed } : {}),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '오류' }, { status: 500 })
  }
}

/** 특강비 직접 납부 취소 (soft-delete) */
export async function DELETE(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  try {
    const { id } = await request.json()
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
    const { error } = await supabase
      .from('tuition_special_payment')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // 아직 실행되지 않은 파기 예약 취소 (1시간 버퍼 안에서 취소하면 청구서 복구)
    // 이게 없으면 POST가 심어둔 예약이 살아남아, 취소했는데도 1시간 뒤 deferredDestroy가
    // 멀쩡한 특강 청구서를 파기한다(대상 status가 'sent' 그대로라 그쪽 가드도 못 막음).
    // 정규 payments/[id] DELETE와 동일한 처리. (2026-07-22)
    const { data: cancelled, error: queueError } = await supabase
      .from('tuition_bill_queue')
      .update({ status: 'cancelled', error_msg: '특강 납부 취소로 파기 예약 해제', sent_at: new Date().toISOString() })
      .eq('send_type', 'destroy')
      .eq('status', 'pending')
      .filter('payload->>specialPaymentId', 'eq', id)
      .select('id')
    if (queueError) {
      // 예약이 남으면 오파기로 이어지므로 조용히 넘기지 않는다.
      console.error('[special/pay DELETE] 파기 예약 해제 실패:', id, queueError)
      return NextResponse.json({ error: '납부는 취소됐으나 파기 예약 해제에 실패했습니다. 청구서 파기 예약을 수동 확인하세요.' }, { status: 500 })
    }
    await writeAuditLog('payment', null, 'delete',
      `특강비 직접 납부 취소(soft-delete): payment ${id} — 파기 예약 ${cancelled?.length ?? 0}건 해제`,
      { specialPaymentId: id, cancelledDestroys: cancelled?.length ?? 0 })
    return NextResponse.json({ ok: true, cancelledDestroys: cancelled?.length ?? 0 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '오류' }, { status: 500 })
  }
}
