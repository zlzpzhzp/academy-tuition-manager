import { supabase } from '@/lib/supabase'
import { destroyBill } from '@/lib/payssam'
import { writeAuditLog } from '@/lib/auditLog'

const MAX_DESTROY_RETRY = 3

// 예약된 파기(send_type='destroy') 중 scheduled_at이 지난 것들을 처리.
// /api/billing/queue GET 같은 자주 호출되는 엔드포인트에서 lazy하게 불러
// Vercel Hobby 플랜의 일 1회 cron 제약을 실질적으로 보완한다.
// (앱을 자주 열면 곧 처리되고, 안 열면 다음 cron까지 대기)
export async function processOverdueDestroys(): Promise<number> {
  const nowIso = new Date().toISOString()
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
    row: { id: string; retry_count?: number | null; student_name?: string | null },
    billId: string,
    msg: string,
  ) => {
    const retry = (row.retry_count ?? 0) + 1
    if (retry < MAX_DESTROY_RETRY) {
      await supabase
        .from('tuition_bill_queue')
        .update({ retry_count: retry, error_msg: `파기 실패 ${retry}회: ${msg} — 재시도 예정` })
        .eq('id', row.id)
    } else {
      await supabase
        .from('tuition_bill_queue')
        .update({ status: 'failed', retry_count: retry, error_msg: `파기 ${retry}회 실패: ${msg}`, sent_at: new Date().toISOString() })
        .eq('id', row.id)
      await writeAuditLog('payment', null, 'update',
        `⚠️ 청구서 자동파기 ${retry}회 최종 실패: ${row.student_name ?? ''} bill ${billId} — 라이브 링크 방치 위험, 수동 파기 필요`,
        { billId, queueId: row.id, error: msg })
    }
  }

  let processed = 0
  for (const row of overdue) {
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

      const { data: bill } = await supabase
        .from('tuition_bill_history')
        .select('status')
        .eq('bill_id', billId)
        .single()

      if (!bill || bill.status !== 'sent') {
        await supabase
          .from('tuition_bill_queue')
          .update({ status: 'cancelled', error_msg: '대상 청구서 상태 변동', sent_at: new Date().toISOString() })
          .eq('id', row.id)
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
          await supabase
            .from('tuition_bill_queue')
            .update({ status: 'sent', bill_id: billId, sent_at: new Date().toISOString() })
            .eq('id', row.id)
          processed++
        } else {
          failMsg = result.msg || '알 수 없음'
        }
      } catch (e) {
        console.error('[deferredDestroy] 파기 호출 실패:', row.id, e)
        failMsg = (e as Error).message
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
