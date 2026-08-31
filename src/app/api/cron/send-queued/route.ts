import { NextRequest, NextResponse } from 'next/server'
import { recordSentBill, bumpResendCount } from '@/lib/billHistory'
import { sendBill, destroyBill, resendBill } from '@/lib/payssam'
import { supabase } from '@/lib/supabase'
import { isBusinessHourKst } from '@/lib/schedule'
import { writeAuditLog } from '@/lib/auditLog'
import { requireCronSecret } from '@/lib/auth'
import { isGuardExemptResettle } from '@/lib/resettleGuard'

// Vercel Cron 전용. CRON_SECRET으로 보호.
// 평일 11:00 KST (02:00 UTC) 실행 — 큐에 쌓인 예약 청구서를 일괄 발송.
// 영업시간 외에 실수로 호출되는 것 방지용 isBusinessHourKst 게이트도 함께 체크.
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  if (!isBusinessHourKst()) {
    return NextResponse.json({ ok: true, skipped: 'outside_business_hours', at: new Date().toISOString() })
  }

  const now = new Date()

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

  // 2026-07-02: 실패가 조용히 영구 방치되던 문제 — 3회까지 재시도(다음 영업일 크론), 최종 실패는 감사로그.
  // ⚠️ 분할 부분성공은 재시도 금지(성공분 중복 발송 위험) — 호출부에서 finalFail로 직행.
  const MAX_RETRY = 3
  const failOrRetry = async (row: { id: string; retry_count?: number | null; student_name?: string | null; send_type?: string | null }, msg: string, opts?: { noRetry?: boolean }) => {
    const retry = (row.retry_count ?? 0) + 1
    if (!opts?.noRetry && retry < MAX_RETRY) {
      await supabase
        .from('tuition_bill_queue')
        // status를 pending으로 되돌려야 다음 영업일에 다시 집힌다. 선점(processing) 도입(2026-07-19) 후
        // 이걸 빼면 row가 processing에 갇혀 재시도가 영구 중단된다.
        .update({ status: 'pending', retry_count: retry, error_msg: `${msg} (${retry}회 실패, 다음 영업일 재시도)` })
        .eq('id', row.id)
      summary.retrying++
    } else {
      await supabase
        .from('tuition_bill_queue')
        .update({ status: 'failed', retry_count: retry, error_msg: `${msg} (${retry}회 최종 실패)`, sent_at: now.toISOString() })
        .eq('id', row.id)
      await writeAuditLog('payment', null, 'update',
        `⚠️ 예약 발송 최종 실패: ${row.student_name ?? ''} [${row.send_type ?? ''}] ${msg} — 수동 처리 필요`,
        { queueId: row.id, error: msg })
      summary.failed++
    }
  }

  for (const row of pending ?? []) {
    summary.checked++
    try {
      // 원자적 선점 (2026-07-19 코드검수 P1): 읽고→외부발송→나중에 status 기록 구조라,
      // 발송 성공 직후 크래시하면 row가 pending으로 남아 다음 실행이 같은 학생에게 재발송했다.
      // 특히 정산분(isResettle)과 split은 아래 중복가드가 적용되지 않아 무방비였다.
      // 조건부 UPDATE(=락)로 pending일 때만 processing으로 전이 — 못 잡으면 다른 실행이 처리 중이므로 skip.
      const { data: claimed } = await supabase
        .from('tuition_bill_queue')
        .update({ status: 'processing', updated_at: now.toISOString() })
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
      if (row.send_type !== 'destroy' && !isResettle) {
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
        const result = await sendBill({
          studentName: row.student_name,
          phone: row.phone,
          amount,
          productName,
          message,
        })

        if (result.code === '0000') {
          const billId = result.bill_id as string
          const shortUrl = (result as { shortURL?: string }).shortURL ?? null
          await recordSentBill({
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
          })
          await supabase
            .from('tuition_bill_queue')
            .update({ status: 'sent', bill_id: billId, sent_at: now.toISOString() })
            .eq('id', row.id)
          // 퇴원 정산 예약분이 실제 발송됨 → '정산 예약됨' → '정산 처리중(결제대기)'로 승격 (2026-07-18)
          if (supersedesBillId) {
            await supabase.from('tuition_withdrawal_status').upsert(
              { student_id: row.student_id, billing_month: row.billing_month, status: 'resettle_pending', updated_at: now.toISOString() },
              { onConflict: 'student_id,billing_month' },
            )
          }
          summary.sent++
        } else {
          await failOrRetry(row, result.msg || '발송 실패')
        }
      } else if (row.send_type === 'reissue') {
        const { amount, productName, message, oldBillId } = row.payload as { amount: number; productName: string; message: string; oldBillId: string }

        // 기존 청구서 아직 sent면 파기
        const { data: oldBill } = await supabase
          .from('tuition_bill_history')
          .select('status')
          .eq('bill_id', oldBillId)
          .single()

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
                .update({ status: 'destroyed', bill_note: '수동 재발송 (예약)으로 파기', updated_at: now.toISOString() })
                .eq('bill_id', oldBillId)
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

        const sendResult = await sendBill({
          studentName: row.student_name,
          phone: row.phone,
          amount,
          productName,
          message,
        })
        if (sendResult.code === '0000') {
          const newBillId = sendResult.bill_id as string
          const shortUrl = (sendResult as { shortURL?: string }).shortURL ?? null
          await recordSentBill({
            student_id: row.student_id,
            bill_id: newBillId,
            amount,
            billing_month: row.billing_month,
            phone: row.phone,
            short_url: shortUrl,
            sent_at: now.toISOString(),
            is_regular_tuition: row.is_regular_tuition,
            bill_note: '수동 재발송 (예약)',
          })
          await supabase
            .from('tuition_bill_queue')
            .update({ status: 'sent', bill_id: newBillId, sent_at: now.toISOString() })
            .eq('id', row.id)
          summary.sent++
        } else {
          await failOrRetry(row, sendResult.msg || '재발송 실패')
        }
      } else if (row.send_type === 'destroy') {
        const { billId, amount, methodLabel } = row.payload as { billId: string; amount: number; methodLabel?: string }

        const { data: bill } = await supabase
          .from('tuition_bill_history')
          .select('status')
          .eq('bill_id', billId)
          .single()

        if (!bill || bill.status !== 'sent') {
          await supabase
            .from('tuition_bill_queue')
            .update({ status: 'cancelled', error_msg: '대상 청구서 상태 변동', sent_at: now.toISOString() })
            .eq('id', row.id)
          summary.skipped_duplicate++
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
          await supabase
            .from('tuition_bill_queue')
            .update({ status: 'sent', bill_id: billId, sent_at: now.toISOString() })
            .eq('id', row.id)
          summary.sent++
        } else {
          await failOrRetry(row, result.msg || '파기 실패')
        }
      } else if (row.send_type === 'resend') {
        const { billId } = row.payload as { billId: string }

        const { data: bill } = await supabase
          .from('tuition_bill_history')
          .select('status, resend_count')
          .eq('bill_id', billId)
          .single()

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
          await bumpResendCount(billId, bill.resend_count, now.toISOString())
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
          .select('bill_id, amount, is_regular_tuition')
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

        const activeRegular = (existing ?? []).filter(b => b.is_regular_tuition !== false)

        const successResults: { bill_id: string; amount: number }[] = []
        const failResults: { amount: number; error: string }[] = []

        for (let i = 0; i < parts; i++) {
          const amount = amounts[i]
          const label = `분할 ${i + 1}/${parts}`
          const [y, m] = row.billing_month.split('-')
          const productName = `${y}년 ${parseInt(m)}월 수업료 (${label})`
          const message = `${row.student_name} ${productName}`
          try {
            const result = await sendBill({
              studentName: row.student_name,
              phone: row.phone,
              amount,
              productName,
              message,
            })
            if (result.code === '0000') {
              const billId = result.bill_id as string
              const shortUrl = (result as { shortURL?: string }).shortURL ?? null
              await recordSentBill({
                student_id: row.student_id,
                bill_id: billId,
                amount,
                billing_month: row.billing_month,
                phone: row.phone,
                short_url: shortUrl,
                sent_at: now.toISOString(),
                is_regular_tuition: true,
                bill_note: label,
              })
              successResults.push({ bill_id: billId, amount })
            } else {
              failResults.push({ amount, error: result.msg || '발송 실패' })
            }
          } catch (e) {
            console.error('[cron/send-queued] split send error:', e)
            failResults.push({ amount, error: '네트워크 오류' })
          }
        }

        // 분할 전건 성공 후에만 기존 청구서 파기(실패시 원본 보존 = 학생 청구서 유실 방지).
        // 대화형 split-send와 동일 순서 (2026-07-03 순서버그 수정: 기존엔 발송 전 무조건 파기했음)
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
          await supabase
            .from('tuition_students')
            .update({
              split_billing_parts: parts,
              split_billing_amounts: amounts,
            })
            .eq('id', row.student_id)
        }

        if (failResults.length === 0) {
          await supabase
            .from('tuition_bill_queue')
            .update({
              status: 'sent',
              sent_at: now.toISOString(),
              // 발송은 성공했으니 status는 sent. 다만 파기 실패는 큐 행에도 남겨 추적 가능하게. (2026-07-26 감사)
              ...(rowDestroyFailed.length > 0 ? { error_msg: `분할 발송 성공 but 기존 청구서 파기 실패: ${rowDestroyFailed.join(', ')} — 수동 파기 필요` } : {}),
            })
            .eq('id', row.id)
          summary.sent++
        } else {
          // 부분성공 재시도 금지(성공분 중복 발송 위험) — 전건 실패만 재시도
          await failOrRetry(row, `${successResults.length}/${parts}건 성공, ${failResults.length}건 실패`, { noRetry: successResults.length > 0 })
        }
      }
    } catch (e) {
      console.error('[cron/send-queued] row error:', row.id, e)
      await failOrRetry(row, (e as Error).message)
    }
  }

  return NextResponse.json({
    ok: true,
    ...summary,
    ...(destroyFailedBillIds.length > 0 ? { destroyFailed: destroyFailedBillIds } : {}),
    at: now.toISOString(),
  })
}
