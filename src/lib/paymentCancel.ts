import { supabase } from './supabase'
import { writeAuditLog } from './auditLog'

/**
 * 청구서 취소 시 자동수납된 tuition_payments 반영 해제 — cancel/resettle/callback(C) 공용.
 *
 * 2026-07-02 정합성 전수검사에서 발견된 분할결제 매칭 버그 수정:
 * - 기존: 앵커 매칭(`[bill:ID]%`)이라 분할 누적 row의 2번째+ 태그는 못 찾고(과소 삭제),
 *   1번째 태그 취소 시 누적 전액이 통째로 사라짐(과대 삭제).
 * - 변경: contains 매칭 + 분할 누적 row(태그 2개 이상)면 해당 청구분 금액만 차감하고
 *   태그를 제거, 단독 row면 soft-delete.
 * - 레거시 무태그 row는 태그 매칭 0건일 때만 fallback soft-delete (기존 동작 유지).
 *
 * @param paidAmount 취소된 청구서의 결제 금액 (appr_price 또는 bill amount)
 * @returns 반영 해제된 row 수
 */
export async function clearPaymentForBill(
  studentId: string,
  billingMonth: string,
  billId: string,
  paidAmount: number,
): Promise<number> {
  const billTag = `[bill:${billId}]`
  const nowIso = new Date().toISOString()

  const { data: rows } = await supabase
    .from('tuition_payments')
    .select('id, amount, memo')
    .eq('student_id', studentId)
    .eq('billing_month', billingMonth)
    .eq('method', 'payssam')
    .ilike('memo', `%${billTag}%`)
    .is('deleted_at', null)

  if (rows && rows.length > 0) {
    let cleared = 0
    for (const row of rows) {
      const tagCount = ((row.memo || '').match(/\[bill:/g) || []).length
      // 분할 누적 row(태그 2개+)는 금액 대소와 무관하게 '차감+태그 제거'만 한다 —
      // 취소액이 row 금액 이상이라고 soft-delete 하면 다른 청구분 납부까지 통째로 사라진다
      // (2026-08-13 라인리뷰: 기존엔 row.amount <= paidAmount 면 else로 빠져 전체 삭제됐다).
      // 차감 하한 0 — 이상 데이터라도 다른 태그의 기록을 지우는 것보다 0원 row가 안전.
      if (tagCount > 1 && paidAmount > 0) {
        const remaining = Math.max(0, row.amount - paidAmount)
        const { error } = await supabase
          .from('tuition_payments')
          .update({
            amount: remaining,
            memo: (row.memo || '').replace(billTag, ''),
          })
          .eq('id', row.id)
        if (!error) {
          cleared++
          await writeAuditLog('payment', row.id, 'update',
            `청구 취소 반영: ${billId} ${paidAmount.toLocaleString()}원 차감 (분할 부분취소)`,
            { billId, paidAmount, remaining })
        } else {
          // 해제 실패를 버리면 호출부가 'N건 해제 성공'으로 읽는다 — 납부기록이 남아 이중결제 착시.
          await writeAuditLog('payment', row.id, 'update',
            `⚠️ 청구 취소 반영 실패(차감): ${billId} — 납부 기록이 남아 있음, 수동 확인 필요 (${error.message})`,
            { billId, paidAmount, error: error.message })
        }
      } else {
        const { error } = await supabase
          .from('tuition_payments')
          .update({ deleted_at: nowIso })
          .eq('id', row.id)
        if (!error) {
          cleared++
          await writeAuditLog('payment', row.id, 'delete',
            `청구 취소 반영: ${billId} 납부 기록 해제`,
            { billId, paidAmount })
        } else {
          await writeAuditLog('payment', row.id, 'update',
            `⚠️ 청구 취소 반영 실패(해제): ${billId} — 납부 기록이 남아 있음, 수동 확인 필요 (${error.message})`,
            { billId, paidAmount, error: error.message })
        }
      }
    }
    return cleared
  }

  // 레거시 (memo 태그 없는 옛 row) — 태그 매칭이 하나도 없을 때만 무태그 row soft-delete
  const { data: legacy } = await supabase
    .from('tuition_payments')
    .update({ deleted_at: nowIso })
    .eq('student_id', studentId)
    .eq('billing_month', billingMonth)
    .eq('method', 'payssam')
    .is('deleted_at', null)
    .or('memo.is.null,memo.eq.')
    .select('id')
  return legacy?.length ?? 0
}
