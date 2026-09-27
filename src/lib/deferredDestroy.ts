import { supabase } from '@/lib/supabase'
import { destroyBill, fetchPaySsamStatus } from '@/lib/payssam'
import { writeAuditLog, resolveAuditWarnings } from '@/lib/auditLog'

const MAX_DESTROY_RETRY = 3

// 발송 processing은 회수하지 않는다. 파기만 30분 지난 실제 선점을 원자적으로 회수한다.
export async function recoverStaleDestroys(now = new Date()): Promise<void> {
  try {
    const { data, error } = await supabase.from('tuition_bill_queue')
      .update({ status: 'pending' })
      .eq('send_type', 'destroy')
      .eq('status', 'processing')
      .lte('updated_at', new Date(now.getTime() - 30 * 60 * 1000).toISOString())
      .select('id')
    if (error) throw error
    for (const row of data ?? []) {
      await writeAuditLog('payment', null, 'update', '지연 파기 처리중 고착 복구 — 파기 전용 재선점 대기', { queueId: row.id })
    }
  } catch (error) {
    console.error('[deferredDestroy] 파기 복구 실패:', error)
    await writeAuditLog('payment', null, 'update', '⚠️ 지연 파기 고착 복구 실패 — 다음 실행에서 재확인 필요')
  }
}

// 복구·재선점된 행을 옛 작업이 종결하거나 pending으로 되돌리지 못하게 한다.
export async function finishDestroyQueue(id: string, claimedAt: string, values: Record<string, unknown>): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('tuition_bill_queue').update(values)
      .eq('id', id).eq('send_type', 'destroy').eq('status', 'processing').eq('updated_at', claimedAt)
      .select('id')
    if (error) throw error
    return !!data?.length
  } catch (error) {
    console.error('[deferredDestroy] 파기 큐 종료 저장 실패:', error)
    await writeAuditLog('payment', null, 'update',
      '⚠️ 지연 파기 큐 종료 저장 실패 — 처리중 상태 수동 확인 필요', { queueId: id, claimedAt, status: values.status })
    return false
  }
}

// 예약된 파기(send_type='destroy') 중 scheduled_at이 지난 것들을 처리.
// /api/billing/queue GET 같은 자주 호출되는 엔드포인트에서 lazy하게 불러
// Vercel Hobby 플랜의 일 1회 cron 제약을 실질적으로 보완한다.
// (앱을 자주 열면 곧 처리되고, 안 열면 다음 cron까지 대기)
export async function processOverdueDestroys(): Promise<number> {
  const nowIso = new Date().toISOString()
  await recoverStaleDestroys(new Date(nowIso))
  const { data: overdue, error: queryError } = await supabase
    .from('tuition_bill_queue')
    .select('id, payload, retry_count, student_name')
    .eq('send_type', 'destroy')
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso)
    .limit(20)

  // 조회 실패 ≠ 처리할 것 없음 — 최소한 서버 로그로 구분한다 (2026-08-13 라인리뷰).
  // 감사로그는 안 쓴다: 이 함수는 lazy로 자주 불리고, DB가 죽어 조회가 실패하는 상황이면
  // 감사로그 insert도 같이 실패한다. 다음 호출(10분 크론 + 앱 열람)이 자연 재시도.
  if (queryError) {
    console.error('[deferredDestroy] 파기 대기 큐 조회 실패:', queryError.message)
    return 0
  }
  if (!overdue || overdue.length === 0) return 0

  // 2026-07-02: 조용한 영구 실패 방지 — 3회까지 재시도(10분 주기), 최종 실패는 감사로그.
  // 2026-07-26 감사: 이 처리를 else 분기에만 두고 catch는 console.error만 하던 탓에,
  //   throw로 오는 실패(게이트웨이 502 등, payssam.ts:52)는 재시도 카운터·최종실패 감사로그를
  //   통째로 우회해 10분마다 영원히 무음 재시도했다. 함수로 빼서 양쪽에서 같이 호출한다.
  const handleDestroyFailure = async (
    row: { id: string; claimedAt: string; retry_count?: number | null; student_name?: string | null },
    billId: string,
    msg: string,
  ) => {
    const retry = (row.retry_count ?? 0) + 1
    if (retry < MAX_DESTROY_RETRY) {
      await finishDestroyQueue(row.id, row.claimedAt, { status: 'pending', retry_count: retry, error_msg: `파기 실패 ${retry}회: ${msg} — 재시도 예정` })
    } else {
      const finished = await finishDestroyQueue(row.id, row.claimedAt, { status: 'failed', retry_count: retry, error_msg: `파기 ${retry}회 실패: ${msg}`, sent_at: new Date().toISOString() })
      if (!finished) return
      await writeAuditLog('payment', null, 'update',
        `⚠️ 청구서 자동파기 ${retry}회 최종 실패: ${row.student_name ?? ''} bill ${billId} — 라이브 링크 방치 위험, 수동 파기 필요`,
        { billId, queueId: row.id, error: msg })
    }
  }

  let processed = 0
  for (const pendingRow of overdue) {
    const row = { ...pendingRow, claimedAt: new Date().toISOString() }
    // 크론과 queue GET의 lazy 처리가 같은 pending 행을 읽어도 한 실행만 파기한다.
    const { data: claimed, error: claimError } = await supabase
      .from('tuition_bill_queue')
      .update({ status: 'processing', updated_at: row.claimedAt })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
    if (claimError) console.error('[deferredDestroy] 파기 선점 실패:', claimError.message)
    if (!claimed?.length || claimError) continue
    try {
      // 구조분해가 try 밖에 있으면 payload가 null/파손일 때 TypeError로 루프와 함수 전체가 죽어,
      // 바깥 catch(handleDestroyFailure)에 도달 못 하고 같은 배치 뒤쪽 행들이 통째로 미처리된다
      // (2026-08-16 라인리뷰). 무효 payload는 실패 처리로 넘기고 다음 행을 계속한다.
      const { billId, amount, methodLabel } = (row.payload ?? {}) as
        { billId?: string; amount: number; methodLabel?: string }
      if (!billId) {
        await handleDestroyFailure(row, '?', 'payload 파손 — billId 없음')
        continue
      }

      const { data: bill, error: billErr } = await supabase
        .from('tuition_bill_history')
        .select('status')
        .eq('bill_id', billId)
        .single()

      if (billErr && billErr.code !== 'PGRST116') {
        await handleDestroyFailure(row, billId, `청구서 조회 실패(${billErr.message})`)
        continue
      }

      if (!bill || bill.status !== 'sent') {
        await finishDestroyQueue(row.id, row.claimedAt, { status: 'cancelled', error_msg: '대상 청구서 상태 변동', sent_at: new Date().toISOString() })
        continue
      }

      // 응답 code!=='0000'과 throw(HTTP non-2xx, payssam.ts:52)를 동일한 파기 실패로 정규화한다.
      let failMsg: string | null = null
      try {
        const result = await destroyBill(billId, amount)
        if (result.code === '0000') {
          await supabase
            .from('tuition_bill_history')
            .update({
              status: 'destroyed',
              bill_note: `${methodLabel ?? '타 결제수단'} 결제로 자동 파기`,
              updated_at: new Date().toISOString(),
            })
            .eq('bill_id', billId)
          if (await finishDestroyQueue(row.id, row.claimedAt, { status: 'sent', bill_id: billId, sent_at: new Date().toISOString() })) processed++
        } else {
          failMsg = result.msg || '알 수 없음'
        }
      } catch (e) {
        console.error('[deferredDestroy] 파기 호출 실패:', row.id, e)
        failMsg = (e as Error).message
      }
      // 자가치유(2026-09-01, 운영자님 "감지해서 니가 고쳐"): "청구서를 찾을 수 없습니다"는
      // 대부분 사용자가 결제선생 앱에서 이미 직접 파기한 청구서다(8/29 김연아·박지성, 9/1 류현진 실사고
      // 3건 전부). 실상태를 대조해 기파기면 실패가 아니라 '동기화 완료'로 처리 — 가짜 경고를 안 만든다.
      if (failMsg && failMsg.includes('찾을 수 없')) {
        try {
          const real = await fetchPaySsamStatus(billId)
          if (real === 'destroyed') {
            await supabase
              .from('tuition_bill_history')
              .update({ status: 'destroyed', bill_note: '결제선생 측 기파기 — 자동 동기화', updated_at: new Date().toISOString() })
              .eq('bill_id', billId)
            if (await finishDestroyQueue(row.id, row.claimedAt, { status: 'cancelled', error_msg: '결제선생 측 기파기 — 상태 동기화로 종결(자가치유)', sent_at: new Date().toISOString() })) {
              await resolveAuditWarnings(billId, '기파기 자동 동기화(deferredDestroy 자가치유)')
              processed++
            }
            failMsg = null
          }
        } catch (e) {
          console.error('[deferredDestroy] 기파기 동기화 시도 실패(원래 실패 처리로 진행):', billId, e)
        }
      }
      if (failMsg) await handleDestroyFailure(row, billId, failMsg)
    } catch (e) {
      // 바깥 catch도 재시도 카운터를 올린다 — console.error만 하면 2026-07-26에 고친
      // '무음 무한 재시도'가 이 경로(payload 파손 등)에만 그대로 남는다 (2026-08-13 라인리뷰).
      console.error('[deferredDestroy] 처리 실패:', row.id, e)
      const billId = (row.payload as { billId?: string } | null)?.billId ?? '?'
      await handleDestroyFailure(row, billId, (e as Error).message)
    }
  }
  return processed
}
