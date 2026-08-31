import { NextRequest, NextResponse } from 'next/server'
import { scheduledResponse } from '@/lib/scheduledResponse'
import { recordSentBill } from '@/lib/billHistory'
import { writeAuditLog } from '@/lib/auditLog'
import { sendBill, destroyBill } from '@/lib/payssam'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { isBusinessHourKst, nextBusinessSlot } from '@/lib/schedule'
import { normalizePhone } from '@/lib/student-codes'

export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  try {
    const { studentId, studentName, phone, billingMonth, amounts, persist } = await request.json()

    if (!studentId || !phone || !Array.isArray(amounts) || !billingMonth) {
      return NextResponse.json({ error: '필수 정보가 누락되었습니다' }, { status: 400 })
    }
    if (amounts.length < 2 || amounts.length > 4) {
      return NextResponse.json({ error: '분할 개수는 2~4개만 가능합니다' }, { status: 400 })
    }
    const sanitized = amounts.map(a => Number(a)).filter(n => Number.isFinite(n) && n > 0)
    if (sanitized.length !== amounts.length) {
      return NextResponse.json({ error: '모든 분할 금액은 0원보다 커야 합니다' }, { status: 400 })
    }

    const cleanPhone = normalizePhone(phone)
    if (!/^01[016789]\d{7,8}$/.test(cleanPhone)) {
      return NextResponse.json({ error: '유효하지 않은 전화번호입니다' }, { status: 400 })
    }

    // 이미납부 가드 — send/route.ts와 동일 (2026-08-13 라인리뷰 P1-B: 분할 발송에만 이 가드가 없어
    // 현금·이체로 이미 낸 학생에게 새 청구서 2~4장이 나갈 수 있었다). 분할은 항상 정규 수업료.
    // 예약(큐) 경로도 이 가드 뒤에 있어야 함 — 큐에 들어가면 크론이 발송한다.
    // 2026-07-31 조용한실패 점검 계열: 조회 error는 '납부기록 없음'과 구별 불가 → fail-closed.
    const { data: paidRows, error: paidErr } = await supabase
      .from('tuition_payments')
      .select('amount')
      .eq('student_id', studentId)
      .eq('billing_month', billingMonth)
      .is('deleted_at', null)
    if (paidErr) {
      console.error('[PaySsam split-send] 납부기록 조회 실패 — 이중청구 방지로 중단:', paidErr)
      return NextResponse.json({
        error: '납부 기록 조회에 실패해 분할 발송을 중단했습니다 (이중청구 방지). 잠시 후 다시 시도하세요.',
        code: 'GUARD_QUERY_FAILED',
        detail: paidErr.message,
      }, { status: 500 })
    }
    // '납부 행 존재'만 보면 분할 1회차 납부 후의 정정 재분할·잔여분 재발송까지 통째로 막힌다
    // (2026-08-16 라인리뷰 — 분할은 여러 장이 한 세트라 부분 납부가 정상 상태다).
    // 완납(납부 합계 >= 이번 요청 합계)일 때만 차단하고, 문구에 두 금액을 실어 관리자가 판단하게 한다.
    const paidSum = (paidRows ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0)
    const requestSum = sanitized.reduce((s, n) => s + n, 0)
    if (paidSum >= requestSum && paidSum > 0) {
      return NextResponse.json({
        error: `이미 납부 완료된 학생입니다 (납부 ${paidSum.toLocaleString()}원 ≥ 청구 ${requestSum.toLocaleString()}원 — 중복 청구 방지)`,
        code: 'ALREADY_PAID',
      }, { status: 409 })
    }

    // 영업시간 외 요청 → 큐에 예약 (분할도 단일 큐 엔트리로, cron이 처리 시 분할 발송)
    if (!isBusinessHourKst()) {
      const scheduledAt = nextBusinessSlot()
      const { error: queueError } = await supabase.from('tuition_bill_queue').insert({
        student_id: studentId,
        student_name: studentName,
        phone: cleanPhone,
        billing_month: billingMonth,
        is_regular_tuition: true,
        send_type: 'split',
        payload: { amounts: sanitized, persist: persist !== false },
        scheduled_at: scheduledAt.toISOString(),
        status: 'pending',
      })

      if (queueError) {
        console.error('[PaySsam] 분할 큐 등록 실패:', queueError)
        return NextResponse.json({ error: '예약 등록 실패' }, { status: 500 })
      }

      return scheduledResponse(scheduledAt)
    }

    // 1) 기존 sent 정규 청구서 조회만 (파기는 분할 발송 성공 후로 미룸 — 실패 시 학생이 원래 청구서로 결제 가능하도록 보존)
    const { data: existing, error: existingErr } = await supabase
      .from('tuition_bill_history')
      .select('bill_id, amount, is_regular_tuition')
      .eq('student_id', studentId)
      .eq('billing_month', billingMonth)
      .eq('status', 'sent')

    // 2026-07-31 조용한실패 점검: supabase-js는 오류를 throw하지 않고 {data:null,error}로 resolve한다.
    // error를 무시하면 '파기할 기존 청구서 없음'과 구별되지 않아, 분할 발송 후 기존 청구서가 그대로
    // 살아남는다(기존분+분할분 공존 = 학부모 이중결제). 아직 아무것도 발송하지 않았으므로 중단이 안전.
    if (existingErr) {
      console.error('[PaySsam split-send] 기존 청구서 조회 실패 — 이중결제 방지로 중단:', existingErr)
      return NextResponse.json({
        error: '기존 청구서 조회에 실패해 분할 발송을 중단했습니다 (파기 대상을 알 수 없어 이중결제 위험). 잠시 후 다시 시도하세요.',
        code: 'GUARD_QUERY_FAILED',
        detail: existingErr.message,
      }, { status: 500 })
    }

    const activeRegular = (existing ?? []).filter(b => b.is_regular_tuition !== false)

    // 2) N개 청구서 순차 발송
    const parts = sanitized.length
    const results: { idx: number; bill_id: string; short_url: string | null; amount: number }[] = []
    const failures: { idx: number; amount: number; error: string }[] = []

    for (let i = 0; i < parts; i++) {
      const amount = sanitized[i]
      const label = `분할 ${i + 1}/${parts}`
      const [y, m] = billingMonth.split('-')
      const productName = `${y}년 ${parseInt(m)}월 수업료 (${label})`
      const message = `${studentName} ${productName}`
      try {
        const result = await sendBill({
          studentName,
          phone: cleanPhone,
          amount,
          productName,
          message,
        })
        if (result.code === '0000') {
          const billId = result.bill_id as string
          const shortUrl = (result as { shortURL?: string }).shortURL ?? null
          const { error: dbErr } = await recordSentBill({
            student_id: studentId,
            bill_id: billId,
            amount,
            billing_month: billingMonth,
            phone: cleanPhone,
            short_url: shortUrl,
            sent_at: new Date().toISOString(),
            is_regular_tuition: true,
            bill_note: label,
          })
          if (dbErr) {
            // 2026-07-05 9app-full-review: DB기록 실패 에스컬레이션(중복발송 가드 사각 방지).
            console.error('[PaySsam] split-send DB기록 실패:', dbErr)
            await writeAuditLog('payment', studentId, 'update',
              `⚠️ 분할청구 발송됨 but DB기록 실패: ${studentName ?? ''} ${billingMonth} #${i + 1} — 수동확인 필요`,
              { billId, error: dbErr.message })
          }
          results.push({ idx: i + 1, bill_id: billId, short_url: shortUrl, amount })
        } else {
          failures.push({ idx: i + 1, amount, error: result.msg || '발송 실패' })
        }
      } catch (e) {
        console.error('[PaySsam split-send] 분할 발송 오류:', e)
        failures.push({ idx: i + 1, amount, error: '네트워크 오류' })
      }
    }

    // 3) 분할 모두 성공한 경우에만 기존 sent 청구서 파기 (실패 시 원래 청구서 보존해서 학생 혼란 방지)
    // 파기 실패는 기존분 + 분할분 공존 = 학부모 이중결제인데, console.error만 남기고 '0000 성공'으로
    // 답하고 있었다(화면·감사 어디에도 안 남음). special/pay와 동일하게 감사로그 + 응답 표면화.
    // 응답 code!=='0000'과 throw(HTTP non-2xx, payssam.ts:52)를 동일 실패로 정규화. (2026-07-26 감사)
    const destroyFailed: string[] = []
    if (results.length === parts) {
      for (const bill of activeRegular) {
        let failMsg: string | null = null
        try {
          const destroyResult = await destroyBill(bill.bill_id, bill.amount)
          if (destroyResult.code === '0000') {
            await supabase
              .from('tuition_bill_history')
              .update({ status: 'destroyed', updated_at: new Date().toISOString() })
              .eq('bill_id', bill.bill_id)
          } else {
            failMsg = destroyResult.msg || '알 수 없음'
          }
        } catch (e) {
          failMsg = (e as Error).message
        }
        if (failMsg) {
          console.error('[PaySsam split-send] 분할 후 기존 파기 실패 — 두 청구서 공존:', bill.bill_id, failMsg)
          destroyFailed.push(bill.bill_id)
          await writeAuditLog('payment', studentId, 'update',
            `⚠️ 분할청구 발송됨 but 기존 청구서 파기 실패: ${studentName ?? ''} ${billingMonth} bill ${bill.bill_id} (${failMsg}) — 기존·분할 청구서 공존, 이중결제 위험. 수동 파기 필요`,
            { billId: bill.bill_id, amount: bill.amount, error: failMsg })
        }
      }
    }

    // 4) 학생 레코드에 분할 설정 저장 (다음달 자동 분할용)
    if (persist !== false && results.length === parts) {
      await supabase
        .from('tuition_students')
        .update({
          split_billing_parts: parts,
          split_billing_amounts: sanitized,
        })
        .eq('id', studentId)
    }

    if (failures.length > 0) {
      return NextResponse.json({
        code: 'PARTIAL',
        msg: `${results.length}/${parts}건 발송 성공, ${failures.length}건 실패. 기존 청구서는 보존됐습니다.`,
        results,
        failures,
      }, { status: 207 })
    }

    return NextResponse.json({
      code: '0000',
      msg: destroyFailed.length > 0
        ? `${parts}건 분할 청구서 발송 완료 — 다만 기존 청구서 ${destroyFailed.length}건 파기 실패(수동 파기 필요)`
        : `${parts}건 분할 청구서 발송 완료`,
      results,
      // 파기가 하나라도 실패하면 화면이 알 수 있게 — 조용히 완전성공으로 보이면 안 된다. (2026-07-26 감사)
      ...(destroyFailed.length > 0 ? { destroyFailed } : {}),
    })
  } catch (error) {
    console.error('[PaySsam] 분할 발송 실패:', error)
    return NextResponse.json({ error: '분할 발송 중 오류가 발생했습니다' }, { status: 500 })
  }
}
