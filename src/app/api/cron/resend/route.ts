import { NextRequest, NextResponse } from 'next/server'
import { bumpResendCount } from '@/lib/billHistory'
import { supabase } from '@/lib/supabase'
import { resendBill, readBill } from '@/lib/payssam'
import { requireCronSecret } from '@/lib/auth'
import { getTodayString } from '@/lib/date'

// Vercel Cron 전용 엔드포인트. CRON_SECRET으로 보호.
// ⚠️ 현재 미배선 (2026-04-21 운영자님 지시로 자동 재발송 정지). vercel.json·시스템 crontab 어디에도
//    이 경로가 없어 실제로는 호출되지 않는다 — 2026-07-26 감사에서 "매일 15:00 KST 실행" 주석이 거짓임을 확인.
// 되살릴 때의 설계: 매일 15:00 KST(06:00 UTC) — 미결제 PaySsam 청구서를 5일 간격 최대 3회 재발송,
//    주말(토/일) 실행 시 스킵 → 실질 발송은 월~금 15:00 KST.
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const now = new Date()

  // 주말 스킵 (KST 기준 요일 판정). Sat=6, Sun=0
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const kstDay = kstNow.getUTCDay()
  if (kstDay === 0 || kstDay === 6) {
    return NextResponse.json({ ok: true, skipped: 'weekend', kst_day: kstDay, at: now.toISOString() })
  }

  const fiveDaysAgoISO = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()

  // sent 상태 + (재발송 없음 | 마지막 재발송 5일 이상 경과) + resend_count < 3
  const { data: candidates, error } = await supabase
    .from('tuition_bill_history')
    .select('bill_id, amount, student_id, billing_month, resend_count, last_resend_at, sent_at')
    .eq('status', 'sent')
    .eq('is_regular_tuition', true)
    .lt('resend_count', 3)

  if (error) {
    console.error('[cron/resend] query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const summary = { checked: 0, resent: 0, synced_paid: 0, skipped: 0, failed: 0 }

  for (const bill of candidates || []) {
    summary.checked++
    const lastActionAt = bill.last_resend_at || bill.sent_at
    if (lastActionAt && new Date(lastActionAt) > new Date(fiveDaysAgoISO)) {
      summary.skipped++
      continue
    }

    try {
      // 안전장치 1: 이미 다른 수단으로 결제된 경우 → 재발송 금지 (#77 흐름의 누수 보완)
      // limit(1) + 배열 확인: 분할납부 등으로 같은 달 결제 row가 2건 이상일 때
      // maybeSingle()이 fail-open(재발송 허용) 되던 버그 방어.
      const { data: existingPayments } = await supabase
        .from('tuition_payments')
        .select('id, method')
        .eq('student_id', bill.student_id)
        .eq('billing_month', bill.billing_month)
        .is('deleted_at', null)
        .limit(1)
      if (existingPayments && existingPayments.length > 0) {
        summary.skipped++
        continue
      }

      // 안전장치 2: 실제 결제 상태 조회. 이미 결제완료면 DB 동기화만 하고 재발송 스킵.
      const readResult = await readBill(bill.bill_id) as { code?: string; appr_state?: string }
      if (readResult.code === '0000' && readResult.appr_state === 'F') {
        await supabase
          .from('tuition_bill_history')
          .update({ status: 'paid', updated_at: new Date().toISOString() })
          .eq('bill_id', bill.bill_id)

        // maybeSingle()은 row 2건+(분할발송)에서 error→data=null fail-open으로 중복 insert되므로 배열 조회.
        // memo에 [bill:ID] 태그 필수 — 콜백 멱등검사·취소시 clearPaymentForBill 매칭이 이 태그 기준.
        const { data: existingRows } = await supabase
          .from('tuition_payments')
          .select('id, memo')
          .eq('student_id', bill.student_id)
          .eq('billing_month', bill.billing_month)
          .eq('method', 'payssam')
          .is('deleted_at', null)
          .limit(10)

        if (!existingRows || existingRows.length === 0) {
          await supabase.from('tuition_payments').insert({
            student_id: bill.student_id,
            amount: bill.amount,
            method: 'payssam',
            payment_date: getTodayString(), // KST (toISOString().slice는 UTC라 0~9시 하루 밀림 — bulletin rule.timezone)
            billing_month: bill.billing_month,
            memo: `[bill:${bill.bill_id}] 결제선생 자동수납 (재발송 확인 시 동기화)`,
          })
        }
        summary.synced_paid++
        continue
      }

      const resendResult = await resendBill(bill.bill_id) as { code?: string }
      if (resendResult.code === '0000') {
        await bumpResendCount(bill.bill_id, bill.resend_count, now.toISOString(), `자동 재발송 ${(bill.resend_count ?? 0) + 1}회차`)
        summary.resent++
      } else {
        summary.failed++
      }
    } catch (e) {
      console.error('[cron/resend] bill error:', bill.bill_id, e)
      summary.failed++
    }
  }

  return NextResponse.json({ ok: true, ...summary, at: now.toISOString() })
}
