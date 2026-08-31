// 분할 청구 액션 대상 선정 — 서버의 AMOUNT_MISMATCH 가드(건별 청구액 정확일치)와 짝이 되는 클라 규약.
// 분할 학생에게 파기/취소/재발송을 걸 때는 '첫 청구 id + 합계'가 아니라 **건별 (bill_id, amount) 쌍**으로
// 한 건씩 보내야 한다 — 합계를 보내면 가드가 항상 400으로 막는다(2026-08-16 주간 라인리뷰 high,
// 분할 학생 파기·환불 전면 차단 실측). 가드를 푸는 게 아니라 호출부가 규약을 지키는 방향의 수리다.

export interface SplitActionBill {
  billId: string
  amount: number
  status: 'sent' | 'paid' | 'cancelled' | 'destroyed'
}

/** 액션 종류별로 실행 대상 분할 청구서를 고른다 — cancel(환불)은 paid만, 나머지(파기·재발송·재발행)는 sent만. */
export function pickSplitActionTargets(
  kind: 'destroy' | 'cancel' | 'reissue' | 'resend',
  bills: SplitActionBill[],
): SplitActionBill[] {
  const want = kind === 'cancel' ? 'paid' : 'sent'
  return bills.filter(b => b.status === want)
}
