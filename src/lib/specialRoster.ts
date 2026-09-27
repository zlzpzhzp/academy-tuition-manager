const SPECIAL_START = '2026-07-23' // 특강 시작일 — 이 이전 퇴원생은 특강 대상 아님

// 특강 대상 학생 필터 (2026-07-09 사용자 지시: 퇴원생 반영 버그 수정).
// getActiveStudents('2026-07')은 7월 중 퇴원생도 포함해 특강탭에 남던 버그 →
// 특강 시작(7/23) 이후에도 재원인 학생만. 반별·명단그룹 통일.
// 경계: 퇴원일 '당일'은 미수강으로 본다 — calcRefund/getLastClassDate와 같은 규칙.
// >= 였을 때 퇴원일이 특강 첫날(7/23)과 같은 학생이 대상으로 남아 특강비가 청구됐다.
// (2026-07-22 마동석 — 7/23 퇴원인데 7/23 개강 특강 30만이 청구돼 있었음)
// 등록일도 특강 행의 시작일 기준: 시작 후 등록자는 기본 제외한다 (2026-09-15 확정).
export function isSpecialTarget(
  student: { withdrawal_date?: string | null; enrollment_date?: string | null },
  periodStart?: string | null,
): boolean {
  const start = periodStart || SPECIAL_START
  return (!student.withdrawal_date || student.withdrawal_date > start)
    && (!student.enrollment_date || student.enrollment_date <= start)
}
