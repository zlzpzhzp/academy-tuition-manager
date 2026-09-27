/** 오늘 날짜를 YYYY-MM-DD 형식으로 반환 (KST 기준 — 서버 TZ가 UTC여도 정확).
 *  구버전은 서버 로컬TZ(Vercel=UTC) 기준이라 KST 00:00~08:59 사이 호출 시 '전날'을 반환하는
 *  버그가 있었음 (2026-06-17 9app-review P0 fix, feedback_kst_only). UTC+9 shift로 KST 날짜 직접 계산. */
export function getTodayString(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

/** 이번 달을 YYYY-MM 으로 (KST 기준). 서버(API 라우트)에서도 안전 —
 *  @/lib/utils 의 동명 헬퍼는 swr 을 최상단 import 하는 파일에 있어 라우트가 가져가면 빌드가 깨진다. */
export function getCurrentMonthString(): string {
  return getTodayString().slice(0, 7)
}
