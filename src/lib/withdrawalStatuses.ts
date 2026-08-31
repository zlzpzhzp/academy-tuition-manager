// 퇴원 처리상태 상수 — 서버(api/withdrawal-status)와 화면(attendance 등)이 같은 정본을 본다.
// 사본을 두면 서버에 상태가 추가될 때 화면만 옛 기준으로 갈라진다 (2026-08-16 라인리뷰).
// ⚠️ 클라이언트 컴포넌트에서 import 되므로 서버 전용 의존성(supabase·next/server)을 넣지 말 것.

/**
 * 종결 상태 = 정산/환불이 실제로 끝난 것. 콜백(결제완료)이 자동으로 찍는다.
 * 이걸 진행중 상태로 되돌리면 "실제론 끝났는데 화면엔 처리중"이 되어 관리자가 중복 조작을 하게 된다.
 * (2026-07-19 실제 사고: 지드래곤 정산 완료 27분 뒤 수동으로 resettle_pending을 써넣어 완료 표시가 지워짐)
 */
export const TERMINAL_STATUSES = ['resettled_paid', 'refund_done', 'settle'] as const
export const IN_PROGRESS_STATUSES = ['resettle_pending', 'resettle_scheduled'] as const
