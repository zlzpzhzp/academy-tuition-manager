import { NextRequest, NextResponse } from 'next/server'
import { recordSentBill, bumpResendCount } from '@/lib/billHistory'
import { sendBill, destroyBill, resendBill } from '@/lib/payssam'
import { supabase } from '@/lib/supabase'
import { isBusinessHourKst } from '@/lib/schedule'
import { writeAuditLog } from '@/lib/auditLog'
import { requireCronSecret } from '@/lib/auth'
import { isGuardExemptResettle } from '@/lib/resettleGuard'
import { recoverStaleDestroys, finishDestroyQueue } from '@/lib/deferredDestroy'

// CRON_SECRET(Bearer)으로 보호. 호출자 = 서버 root crontab `0 11 * * 1-6`(월~토 11:00 KST) →
// 서버 crontab 의 호출 스크립트 → http://127.0.0.1:<PORT> (2026-07-31 Vercel 크론에서 이관).
// ⛔ vercel.json 에 크론을 다시 넣지 마라 — 서버 크론과 이중 집행돼 청구가 두 번 나간다.
// 큐에 쌓인 예약 청구서를 일괄 발송.
// 영업시간 외에 실수로 호출되는 것 방지용 isBusinessHourKst 게이트도 함께 체크.
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  if (!isBusinessHourKst()) {
    return NextResponse.json({ ok: true, skipped: 'outside_business_hours', at: new Date().toISOString() })
  }

  const now = new Date()
  await recoverStaleDestroys(now)

  // 선점(processing) 후 프로세스가 크래시하면 row가 processing에 갇힌다. 발송 여부를 알 수 없어
  // 자동 재시도는 금지(중복발송 위험) — 대신 조용히 방치되지 않게 감사로그로 올린다. (2026-07-19)
  const staleCutoff = new Date(now.getTime() - 30 * 60 * 1000).toISOString()
  const { data: stuck } = await supabase
    .from('tuition_bill_queue')
    .select('id, student_name, billing_month, send_type, updated_at')
    .eq('status', 'processing')
    .lt('updated_at', staleCutoff)
    .limit(20)
  for (const st of stuck ?? []) {
    if (st.send_type === 'destroy') continue
    await writeAuditLog('payment', null, 'update',
      `⚠️ 예약 발송이 처리중 상태로 멈춤: ${st.student_name ?? ''} ${st.billing_month} [${st.send_type}] — 결제선생에 실제 발송됐는지 수동 확인 필요(자동 재시도 안 함)`,
      { queueId: st.id, stuckSince: st.updated_at })
  }

  const { data: pending, error } = await supabase
    .from('tuition_bill_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(100)

  if (error) {
    console.error('[cron/send-queued] query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const summary = { checked: 0, sent: 0, failed: 0, retrying: 0, skipped_duplicate: 0, skipped: 0 }
  // 분할 발송 후 기존 청구서 파기에 실패한 bill_id — 응답에도 올려 조용히 묻히지 않게. (2026-07-26 감사)
  const destroyFailedBillIds: string[] = []
  const storageWarnings: string[] = []
  const warnStorage = async (queueId: string, message: string) => {
    storageWarnings.push(queueId)
    await writeAuditLog('payment', null, 'update', `⚠️ 예약 청구서 발송됨 but ${message} — 자동 재시도 안 함, 수동확인 필요`, { queueId })
  }
  // 외부 성공은 이력 저장의 반환 오류·throw와 무관하다.
  const recordKnownSent = async (values: Parameters<typeof recordSentBill>[0], studentName: string) => {
    let failure: unknown
    try {
      const { error } = await recordSentBill(values)
      failure = error
    } catch (error) { failure = error }
    if (failure) {
      const message = failure && typeof failure === 'object' && 'message' in failure ? String(failure.message) : String(failure)
      console.error('[PaySsam] DB 기록 실패 (청구서는 발송됨):', failure)
      await writeAuditLog('payment', values.student_id, 'update',
        `⚠️ 청구서 발송됨 but DB기록 실패: ${studentName ?? ''} ${values.billing_month} — 중복발송 가드 사각, 수동확인 필요`,
        { billId: values.bill_id, error: message })
    }
  }

  // 2026-07-02: 실패가 조용히 영구 방치되던 문제 — 3회까지 재시도(다음 영업일 크론), 최종 실패는 감사로그.
  // ⚠️ 분할 부분성공은 재시도 금지(성공분 중복 발송 위험) — 호출부에서 finalFail로 직행.
  const MAX_RETRY = 3
  const failOrRetry = async (row: { id: string; retry_count?: number | null; student_name?: string | null; send_type?: string | null; claimedAt: string }, msg: string, opts?: { noRetry?: boolean }) => {
    const retry = (row.retry_count ?? 0) + 1
    if (!opts?.noRetry && retry < MAX_RETRY) {
      const values = { status: 'pending', retry_count: retry, error_msg: `${msg} (${retry}회 실패, 다음 영업일 재시도)` }
      // processing에서 pending 복귀. destroy는 현재 선점 소유자만 재시도를 예약한다.
      if (row.send_type === 'destroy') {
        if (!await finishDestroyQueue(row.id, row.claimedAt, values)) return
      } else {
        await supabase.from('tuition_bill_queue').update(values).eq('id', row.id)
      }
      summary.retrying++
    } else {
      const values = { status: 'failed', retry_count: retry, error_msg: `${msg} (${retry}회 최종 실패)`, sent_at: now.toISOString() }
      if (row.send_type === 'destroy') {
        if (!await finishDestroyQueue(row.id, row.claimedAt, values)) return
      } else {
        await supabase.from('tuition_bill_queue').update(values).eq('id', row.id)
      }
      await writeAuditLog('payment', null, 'update',
        `⚠️ 예약 발송 최종 실패: ${row.student_name ?? ''} [${row.send_type ?? ''}] ${msg} — 수동 처리 필요`,
        { queueId: row.id, error: msg })
      summary.failed++
    }
  }

  for (const pendingRow of pending ?? []) {
    const row = { ...pendingRow, claimedAt: new Date().toISOString() }
    let allSent = false
    let anySent = false
    let sentStoreAttempted = false
    const finishKnownSent = async (values: Record<string, unknown> = {}) => {
      sentStoreAttempted = true
      try {
        const { data, error } = await supabase.from('tuition_bill_queue')
          .update({ status: 'sent', sent_at: now.toISOString(), ...values })
          .eq('id', row.id).eq('status', 'processing').eq('updated_at', row.claimedAt).select('id')
        if (error) throw error
        if (!data?.length) throw new Error('선점 상태 변경으로 sent 저장 안 됨')
        summary.sent++
      } catch (error) {
        console.error('[cron/send-queued] sent 저장 실패:', row.id, error)
        await warnStorage(row.id, '큐 sent 저장 실패')
      }
    }
    summary.checked++
    try {
      // 원자적 선점 (2026-07-19 코드검수 P1): 읽고→외부발송→나중에 status 기록 구조라,
      // 발송 성공 직후 크래시하면 row가 pending으로 남아 다음 실행이 같은 학생에게 재발송했다.
      // 특히 정산분(isResettle)과 split은 아래 중복가드가 적용되지 않아 무방비였다.
      // 조건부 UPDATE(=락)로 pending일 때만 processing으로 전이 — 못 잡으면 다른 실행이 처리 중이므로 skip.
      const { data: claimed } = await supabase
        .from('tuition_bill_queue')
        .update({ status: 'processing', updated_at: row.claimedAt })
        .eq('id', row.id)
        .eq('status', 'pending')
        .select('id')
      if (!claimed || claimed.length === 0) {
        summary.skipped++
        continue
      }

      // 환불형 퇴원 정산분(supersedesBillId 보유)만 아래 중복발송 가드에서 면제한다.
      // 그 학생은 이미 완납분이 있어(=납부기록·정규청구가 존재) 가드에 걸리는데, 정산분은 그것과
      // '의도적으로 공존'하는 청구서라 면제가 필요하다. (2026-07-15)
      //
      // ⚠️ 미납형 정산분(payload.resettleUnpaid)은 면제하지 않는다 — 낸 돈이 없으니 면제 근거가 없다.
      //   2026-07-22에 미납형까지 면제 대상에 넣었다가 야간 검수에서 구멍으로 지적됨: 밤에 정산분을
      //   예약한 뒤 영업 개시 전에 학부모가 현장 수납하면, 납부기록 가드가 꺼져 청구서가 그대로 나가
      //   이중청구가 된다. 미납형은 두 가드를 그냥 통과한다 —
      //   납부기록: 안 냈으니 없음 / 정규청구: 발송 직전 미납분을 파기(status=destroyed)했으니 없음.
      //   즉 정상 흐름은 면제 없이도 통과하고, 비정상(그 사이 수납·수동청구)일 때만 걸려서 막힌다.
      const isResettle = isGuardExemptResettle(row.payload as { supersedesBillId?: string; resettleUnpaid?: boolean } | null)

      // 2026-07-02 정합성 전수검사: 예약 후 발송 전에 현장 수납(수동 납부)된 학생에게
      // 청구서가 그대로 나가 이중청구되던 구멍 — 활성 납부 기록 있으면 발송 취소 (destroy는 예외: 파기는 항상 안전)
      // 🔴 billType 스코핑(2026-09-01): 이 가드는 send API와 동일하게 **정규 청구에만** 적용해야 한다.
      //   납부 기록은 정규분(스냅샷 요금)이라, electives 예약분까지 막으면 "정규를 먼저 낸 학생"의
      //   선택과목 청구가 자동취소된다 — 9/1 11:00 이효리 기하 15만이 정규 45만 납부를 사유로
      //   취소된 실사고. 별도 electives 청구는 정규 납부와 무관하게 발송 가능해야 한다.
      const guardBillType = row.bill_type === 'electives' ? 'electives' : 'regular'
      if (row.send_type !== 'destroy' && !isResettle && row.is_regular_tuition !== false && guardBillType === 'regular') {
        // limit(1) + 배열 확인: 분할납부 등으로 같은 달 결제 row가 2건 이상이면
        // maybeSingle()이 error+data=null 로 이중청구 방지 가드를 fail-open 시키던 버그 방어.
        const { data: paidRows, error: paidErr } = await supabase
          .from('tuition_payments')
          .select('id, method, amount')
          .eq('student_id', row.student_id)
          .eq('billing_month', row.billing_month)
          .is('deleted_at', null)
          .limit(1)
        // 2026-07-31 조용한실패 점검: supabase-js는 오류를 throw하지 않고 {data:null,error}로 resolve한다.
        // error를 무시하면 DB 장애가 '납부기록 없음'과 같아져 이중청구 가드가 fail-open된다.
        // 가드는 막는 쪽이 안전 — 이번 회차는 발송하지 않고 pending으로 되돌려 다음 영업일에 재시도한다.
        if (paidErr) {
          console.error('[cron/send-queued] 납부기록 조회 실패:', row.id, paidErr)
          await failOrRetry(row, `납부기록 조회 실패(${paidErr.message}) — 이중청구 방지로 발송 보류`)
          continue
        }
        const paidRow = paidRows?.[0]
        if (paidRow) {
          await supabase
            .from('tuition_bill_queue')
            .update({ status: 'cancelled', error_msg: `이미 납부 기록 존재(${paidRow.method} ${Number(paidRow.amount).toLocaleString()}원) — 이중청구 방지 자동취소`, sent_at: now.toISOString() })
            .eq('id', row.id)
          summary.skipped_duplicate++
          continue
        }
      }

      // 정규 수업료 중복 발송 방지 (예약 후 사이에 수동 발송된 케이스 대비)
      // bill_type별로 분리: 같은 학생에 regular/electives 한 건씩 공존 가능
      // 정산분(isResettle)은 기존 정규청구와 의도적 공존이라 예외.
      if (row.is_regular_tuition && !isResettle) {
        const rowBillType: 'regular' | 'electives' = row.bill_type === 'electives' ? 'electives' : 'regular'
        const { data: existing, error: existingErr } = await supabase
          .from('tuition_bill_history')
          .select('bill_id, status, is_regular_tuition, bill_type')
          .eq('student_id', row.student_id)
          .eq('billing_month', row.billing_month)
          .in('status', ['sent', 'paid'])

        // 2026-07-31 조용한실패 점검: error를 안 보면 DB 장애가 '기존 청구서 없음'과 같아져
        // 중복발송 가드가 fail-open된다 — 발송 보류(다음 영업일 재시도)가 안전한 방향.
        if (existingErr) {
          console.error('[cron/send-queued] 기존 청구서 조회 실패:', row.id, existingErr)
          await failOrRetry(row, `기존 청구서 조회 실패(${existingErr.message}) — 중복발송 방지로 발송 보류`)
          continue
        }

        const regularBills = (existing ?? []).filter(b => b.is_regular_tuition !== false && (b.bill_type ?? 'regular') === rowBillType)
        if (regularBills.length > 0 && row.send_type === 'single') {
          await supabase
            .from('tuition_bill_queue')
            .update({ status: 'cancelled', error_msg: '이미 발송/결제된 정규 청구서 존재', sent_at: now.toISOString() })
            .eq('id', row.id)
          summary.skipped_duplicate++
          continue
        }
      }

      if (row.send_type === 'single') {
        // supersedesBillId: 퇴원 정산 예약분 — 이 청구서 결제완료 시 콜백이 기존 완납분을 환불하도록 링크.
        const { amount, productName, message, supersedesBillId } = row.payload as { amount: number; productName: string; message: string; supersedesBillId?: string }
        let result: Awaited<ReturnType<typeof sendBill>>
        try {
          result = await sendBill({
            studentName: row.student_name,
            phone: row.phone,
            amount,
            productName,
            message,
          })
        } catch (error) {
          await failOrRetry(row, `발송 결과 불명확 — 결제선생에서 실발송 여부 확인 후 수동 처리 (${error instanceof Error ? error.message : String(error)})`, { noRetry: true })
          continue
        }

        if (result.code === '0000') {
          const billId = result.bill_id as string
          const shortUrl = (result as { shortURL?: string }).shortURL ?? null
          allSent = anySent = true
          await finishKnownSent({ bill_id: billId })
          await recordKnownSent({
            student_id: row.student_id,
            bill_id: billId,
            amount,
            billing_month: row.billing_month,
            phone: row.phone,
            short_url: shortUrl,
            sent_at: now.toISOString(),
            is_regular_tuition: row.is_regular_tuition,
            bill_type: row.bill_type === 'electives' ? 'electives' : 'regular',
            bill_note: row.bill_note,
            ...(supersedesBillId ? { supersedes_bill_id: supersedesBillId } : {}),
          }, row.student_name)
          // 퇴원 정산 예약분이 실제 발송됨 → '정산 예약됨' → '정산 처리중(결제대기)'로 승격 (2026-07-18)
          if (supersedesBillId) {
            const { error: withdrawalError } = await supabase.from('tuition_withdrawal_status').upsert(
              { student_id: row.student_id, billing_month: row.billing_month, status: 'resettle_pending', updated_at: now.toISOString() },
              { onConflict: 'student_id,billing_month' },
            )
            if (withdrawalError) throw withdrawalError
          }
        } else {
          await failOrRetry(row, result.msg || '발송 실패')
        }
      } else if (row.send_type === 'reissue') {
        const { amount, productName, message, oldBillId, supersedesBillId: payloadSupersedes } = row.payload as { amount: number; productName: string; message: string; oldBillId: string; supersedesBillId?: string }

        // 기존 청구서 아직 sent면 파기
        const { data: oldBill, error: oldBillErr } = await supabase
          .from('tuition_bill_history')
          .select('status, bill_note, bill_type, supersedes_bill_id')
          .eq('bill_id', oldBillId)
          .single()
        // 조회 장애를 '기존 청구서 없음'으로 읽으면 파기 없이 새 청구서가 나가 두 장이 동시에 산다(이중청구).
        // row 없음(PGRST116)만 기존대로 통과, 그 외 오류는 보류·재시도. (2026-09-05 astra 병합 검수)
        if (oldBillErr && oldBillErr.code !== 'PGRST116') {
          await failOrRetry(row, `기존 청구서 조회 실패(${oldBillErr.message}) — 이중청구 방지로 재발송 보류`)
          continue
        }
        const supersedesBillId = oldBill?.supersedes_bill_id ?? payloadSupersedes ?? null

        if (oldBill?.status === 'sent') {
          // 파기 실패해도 새 청구서를 강행 발송하던 구멍 — 두 장이 동시에 살아 학부모가 둘 다 결제(이중청구).
          // 대화형 경로(/api/payssam/reissue)는 파기 실패 시 500으로 중단하는데 크론만 강행했다.
          // 응답 code!=='0000'과 throw(HTTP non-2xx, payssam.ts:52)를 동일한 실패로 정규화한다. (2026-07-26 감사)
          let destroyFailMsg: string | null = null
          try {
            const destroyResult = await destroyBill(oldBillId, amount)
            if (destroyResult.code === '0000') {
              await supabase
                .from('tuition_bill_history')
                .update({ status: 'destroyed', updated_at: now.toISOString() })
                .eq('bill_id', oldBillId)
              await writeAuditLog('payment', row.student_id, 'update',
                '수동 재발송 (예약)으로 파기', { billId: oldBillId })
            } else {
              destroyFailMsg = destroyResult.msg || '알 수 없음'
            }
          } catch (e) {
            destroyFailMsg = (e as Error).message
          }
          if (destroyFailMsg) {
            await failOrRetry(row, `기존 청구서 파기 실패(${destroyFailMsg}) — 이중청구 방지로 재발송 중단`)
            continue
          }
        }

        let sendResult: Awaited<ReturnType<typeof sendBill>>
        try {
          sendResult = await sendBill({
            studentName: row.student_name,
            phone: row.phone,
            amount,
            productName,
            message,
          })
        } catch (error) {
          await failOrRetry(row, `발송 결과 불명확 — 결제선생에서 실발송 여부 확인 후 수동 처리 (${error instanceof Error ? error.message : String(error)})`, { noRetry: true })
          continue
        }
        if (sendResult.code === '0000') {
          const newBillId = sendResult.bill_id as string
          const shortUrl = (sendResult as { shortURL?: string }).shortURL ?? null
          allSent = anySent = true
          await finishKnownSent({ bill_id: newBillId })
          await recordKnownSent({
            student_id: row.student_id,
            bill_id: newBillId,
            amount,
            billing_month: row.billing_month,
            phone: row.phone,
            short_url: shortUrl,
            sent_at: now.toISOString(),
            is_regular_tuition: row.is_regular_tuition,
            bill_note: oldBill ? oldBill.bill_note : row.bill_note,
            bill_type: oldBill ? oldBill.bill_type : row.bill_type,
            ...(supersedesBillId ? { supersedes_bill_id: supersedesBillId } : {}),
          }, row.student_name)
          await writeAuditLog('payment', row.student_id, 'update',
            '수동 재발송 (예약)', { oldBillId, billId: newBillId })
        } else {
          await failOrRetry(row, sendResult.msg || '재발송 실패')
        }
      } else if (row.send_type === 'destroy') {
        const { billId, amount, methodLabel } = row.payload as { billId: string; amount: number; methodLabel?: string }

        const { data: bill, error: billErr } = await supabase
          .from('tuition_bill_history')
          .select('status')
          .eq('bill_id', billId)
          .single()

        if (billErr && billErr.code !== 'PGRST116') {
          await failOrRetry(row, `청구서 조회 실패(${billErr.message})`)
          continue
        }

        if (!bill || bill.status !== 'sent') {
          if (await finishDestroyQueue(row.id, row.claimedAt, { status: 'cancelled', error_msg: '대상 청구서 상태 변동', sent_at: now.toISOString() })) summary.skipped_duplicate++
          continue
        }

        const result = await destroyBill(billId, amount)
        if (result.code === '0000') {
          await supabase
            .from('tuition_bill_history')
            .update({
              status: 'destroyed',
              bill_note: `${methodLabel ?? '타 결제수단'} 결제로 자동 파기`,
              updated_at: now.toISOString(),
            })
            .eq('bill_id', billId)
          if (await finishDestroyQueue(row.id, row.claimedAt, { status: 'sent', bill_id: billId, sent_at: now.toISOString() })) summary.sent++
        } else {
          await failOrRetry(row, result.msg || '파기 실패')
        }
      } else if (row.send_type === 'resend') {
        const { billId } = row.payload as { billId: string }

        const { data: bill, error: billErr } = await supabase
          .from('tuition_bill_history')
          .select('status, resend_count')
          .eq('bill_id', billId)
          .single()

        if (billErr && billErr.code !== 'PGRST116') {
          await failOrRetry(row, `청구서 조회 실패(${billErr.message})`)
          continue
        }

        if (!bill || bill.status !== 'sent') {
          await supabase
            .from('tuition_bill_queue')
            .update({ status: 'cancelled', error_msg: '대상 청구서 상태 변동', sent_at: now.toISOString() })
            .eq('id', row.id)
          summary.skipped_duplicate++
          continue
        }

        const result = await resendBill(billId)
        if (result.code === '0000') {
          const { error: dbError } = await bumpResendCount(billId, bill.resend_count, now.toISOString())
          if (dbError) {
            console.error('[PaySsam] DB 기록 실패 (청구서는 발송됨):', dbError)
            await writeAuditLog('payment', row.student_id, 'update',
              `⚠️ 청구서 발송됨 but DB기록 실패: ${row.student_name ?? ''} ${row.billing_month} — 중복발송 가드 사각, 수동확인 필요`,
              { billId, error: dbError.message })
          }
          await supabase
            .from('tuition_bill_queue')
            .update({ status: 'sent', bill_id: billId, sent_at: now.toISOString() })
            .eq('id', row.id)
          summary.sent++
        } else {
          await failOrRetry(row, result.msg || '재발송 실패')
        }
      } else if (row.send_type === 'split') {
        const { amounts, persist } = row.payload as { amounts: number[]; persist: boolean }
        const parts = amounts.length

        // 기존 정규 sent 조회 (⚠️ 파기는 새 분할 전건 성공 후 아래에서 — 먼저 파기하면 발송실패시
        // 학생이 낼 청구서 유실. 대화형 split-send와 동일 순서로 정정, 2026-07-03 버그수정)
        const { data: existing, error: existingErr } = await supabase
          .from('tuition_bill_history')
          .select('bill_id, amount, is_regular_tuition, bill_type')
          .eq('student_id', row.student_id)
          .eq('billing_month', row.billing_month)
          .eq('status', 'sent')

        // 2026-07-31 조용한실패 점검: 이 조회가 실패하면 activeRegular가 빈 배열이 되어
        // '파기할 기존 청구서 없음'과 구별되지 않는다 → 분할 발송 후 기존 청구서가 그대로 살아남아
        // 기존분+분할분 공존 = 학부모 이중결제. 아직 아무것도 발송하지 않은 시점이므로
        // '대상 없음'으로 진행하지 말고 실패로 처리한다(파기 실패와 동일하게 감사로그로 표면화).
        if (existingErr) {
          console.error('[cron/send-queued] split 기존 청구서 조회 실패:', row.id, existingErr)
          await writeAuditLog('payment', row.student_id, 'update',
            `⚠️ 분할청구(예약) 중단 — 기존 청구서 조회 실패: ${row.student_name ?? ''} ${row.billing_month} (${existingErr.message}) — 파기 대상을 알 수 없어 발송하지 않음(이중결제 방지)`,
            { queueId: row.id, error: existingErr.message })
          await failOrRetry(row, `기존 청구서 조회 실패(${existingErr.message}) — 이중결제 방지로 분할 발송 보류`)
          continue
        }

        const activeRegular = (existing ?? []).filter(b => b.is_regular_tuition !== false && (b.bill_type ?? 'regular') === 'regular')

        const successResults: { bill_id: string; amount: number }[] = []
        const failResults: { amount: number; error: string }[] = []

        let sendResultUnknown = false
        for (let i = 0; i < parts; i++) {
          const amount = amounts[i]
          const label = `분할 ${i + 1}/${parts}`
          const [y, m] = row.billing_month.split('-')
          const productName = `${y}년 ${parseInt(m)}월 수업료 (${label})`
          const message = `${row.student_name} ${productName}`
          let awaitingSend = false
          try {
            awaitingSend = true
            const result = await sendBill({
              studentName: row.student_name,
              phone: row.phone,
              amount,
              productName,
              message,
            })
            awaitingSend = false
            if (result.code === '0000') {
              const billId = result.bill_id as string
              const shortUrl = (result as { shortURL?: string }).shortURL ?? null
              successResults.push({ bill_id: billId, amount })
              anySent = true
              await recordKnownSent({
                student_id: row.student_id,
                bill_id: billId,
                amount,
                billing_month: row.billing_month,
                phone: row.phone,
                short_url: shortUrl,
                sent_at: now.toISOString(),
                is_regular_tuition: true,
                bill_note: label,
              }, row.student_name)
            } else {
              failResults.push({ amount, error: result.msg || '발송 실패' })
            }
          } catch (e) {
            console.error('[cron/send-queued] split send error:', e)
            if (awaitingSend) sendResultUnknown = true
            failResults.push({ amount, error: '네트워크 오류' })
          }
        }

        // 분할 전건 성공 후에만 기존 청구서 파기(실패시 원본 보존 = 학생 청구서 유실 방지).
        // 대화형 split-send와 동일 순서 (2026-07-03 순서버그 수정: 기존엔 발송 전 무조건 파기했음)
        allSent = successResults.length === parts
        const rowDestroyFailed: string[] = []
        if (successResults.length === parts) {
          for (const bill of activeRegular) {
            // 파기 실패 = 기존분 + 분할분 공존 = 이중결제. console.error만 남기고 'sent'로 종결하면
            // 감사 어디에도 안 남는다 — special/pay와 동일하게 감사로그로 표면화. (2026-07-26 감사)
            let failMsg: string | null = null
            try {
              const destroyResult = await destroyBill(bill.bill_id, bill.amount)
              if (destroyResult.code === '0000') {
                await supabase
                  .from('tuition_bill_history')
                  .update({ status: 'destroyed', updated_at: now.toISOString() })
                  .eq('bill_id', bill.bill_id)
              } else {
                failMsg = destroyResult.msg || '알 수 없음'
              }
            } catch (e) {
              failMsg = (e as Error).message
            }
            if (failMsg) {
              console.error('[cron/send-queued] destroy error:', bill.bill_id, failMsg)
              rowDestroyFailed.push(bill.bill_id)
              destroyFailedBillIds.push(bill.bill_id)
              await writeAuditLog('payment', row.student_id, 'update',
                `⚠️ 분할청구(예약) 발송됨 but 기존 청구서 파기 실패: ${row.student_name ?? ''} ${row.billing_month} bill ${bill.bill_id} (${failMsg}) — 기존·분할 청구서 공존, 이중결제 위험. 수동 파기 필요`,
                { queueId: row.id, billId: bill.bill_id, error: failMsg })
            }
          }
        }

        if (persist && successResults.length === parts) {
          const { error: persistError } = await supabase
            .from('tuition_students')
            .update({
              split_billing_parts: parts,
              split_billing_amounts: amounts,
            })
            .eq('id', row.student_id)
          if (persistError) throw persistError
        }

        if (failResults.length === 0) {
          await finishKnownSent({
            // 발송은 성공했으니 sent. 파기 실패는 기존대로 큐와 응답에도 남긴다.
            ...(rowDestroyFailed.length > 0 ? { error_msg: `분할 발송 성공 but 기존 청구서 파기 실패: ${rowDestroyFailed.join(', ')} — 수동 파기 필요` } : {}),
          })
        } else {
          // 부분성공 재시도 금지(성공분 중복 발송 위험) — 전건 실패만 재시도
          const msg = `${successResults.length}/${parts}건 성공, ${failResults.length}건 실패`
            + (sendResultUnknown ? ' — 발송 결과 불명확 — 결제선생에서 실발송 여부 확인 후 수동 처리' : '')
          await failOrRetry(row, msg, { noRetry: sendResultUnknown || successResults.length > 0 })
        }
      }
    } catch (e) {
      console.error('[cron/send-queued] row error:', row.id, e)
      if (allSent) {
        // 알려진 전건 성공 뒤 후처리 예외가 발송 재시도로 이어지면 안 된다.
        if (!sentStoreAttempted) await finishKnownSent()
        await warnStorage(row.id, '후처리 저장 실패')
      } else {
        await failOrRetry(row, (e as Error).message, { noRetry: anySent })
      }
    }
  }

  return NextResponse.json({
    ok: true,
    ...summary,
    ...(storageWarnings.length > 0 ? { storageWarnings: [...new Set(storageWarnings)] } : {}),
    ...(destroyFailedBillIds.length > 0 ? { destroyFailed: destroyFailedBillIds } : {}),
    at: now.toISOString(),
  })
}
