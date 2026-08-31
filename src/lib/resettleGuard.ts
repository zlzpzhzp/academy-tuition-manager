/**
 * 퇴원 정산 예약분이 크론의 중복발송 가드에서 면제되는지 판정.
 *
 * 면제 대상은 **환불형(supersedesBillId 보유)뿐이다.** 그 학생은 이미 완납분이 있어
 * 납부기록·정규청구가 존재하고, 정산분은 그것과 '의도적으로 공존'하는 청구서라 면제가 필요하다.
 *
 * ⚠️ 미납형(resettleUnpaid)은 면제하지 않는다 — 낸 돈이 없으니 면제 근거가 없다.
 *   2026-07-22에 미납형까지 면제했다가 야간 검수에서 구멍으로 지적됨: 밤에 정산분을 예약한 뒤
 *   영업 개시 전에 학부모가 현장 수납하면 납부기록 가드가 꺼져 청구서가 나가 이중청구가 된다.
 *   미납형은 정상 흐름이면 두 가드를 그냥 통과한다 — 납부기록은 안 냈으니 없고, 정규청구는
 *   발송 직전 미납분을 파기(status=destroyed)했으니 없다. 비정상일 때만 걸려서 막힌다.
 */
export function isGuardExemptResettle(
  payload: { supersedesBillId?: string; resettleUnpaid?: boolean } | null | undefined,
): boolean {
  return payload?.supersedesBillId != null
}
