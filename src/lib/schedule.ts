/**
 * 결제선생 청구서 발송 시간대 제한 유틸.
 * 업무 시간:
 *   - 평일(월~금): 11:00 ~ 22:00 KST
 *   - 토요일: 11:00 ~ 20:00 KST
 *   - 일요일: 발송 불가
 * 그 외 시간 요청은 다음 영업시간(= 다음 영업일 11:00 KST)에 발송하도록 예약.
 *
 * 서버 TZ가 KST가 아닐 수 있으므로 UTC+9 shift 산술로 KST 시각을 직접 계산한다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const BUSINESS_START_HOUR = 11
const BUSINESS_WEEKDAY_END_HOUR = 22
const BUSINESS_SATURDAY_END_HOUR = 20

/** UTC Date → KST Date (shifted). getUTC* 계열로 KST 필드를 읽음. */
function toKst(d: Date): Date {
  return new Date(d.getTime() + KST_OFFSET_MS)
}

/** KST shifted Date → UTC Date (복원). */
function fromKst(kst: Date): Date {
  return new Date(kst.getTime() - KST_OFFSET_MS)
}

export function isBusinessHourKst(d: Date = new Date()): boolean {
  const kst = toKst(d)
  const day = kst.getUTCDay() // 0=일, 1=월, ..., 6=토
  if (day === 0) return false // 일요일 발송 불가
  const hour = kst.getUTCHours()
  if (hour < BUSINESS_START_HOUR) return false
  const endHour = day === 6 ? BUSINESS_SATURDAY_END_HOUR : BUSINESS_WEEKDAY_END_HOUR
  return hour < endHour
}

/**
 * 다음 업무 시작 시각(KST 11:00)을 UTC Date로 반환.
 * 예: 토요일 21:00 KST → 월요일 11:00 KST
 *     일요일 13:00 KST → 월요일 11:00 KST
 *     금요일 23:00 KST → 토요일 11:00 KST
 *     토요일 09:00 KST → 토요일 11:00 KST
 */
export function nextBusinessSlot(d: Date = new Date()): Date {
  const kst = toKst(d)
  const day = kst.getUTCDay()
  const hour = kst.getUTCHours()

  const target = new Date(kst)
  const canStartToday = (day >= 1 && day <= 6) && hour < BUSINESS_START_HOUR

  if (canStartToday) {
    // 같은 날 11시로 당김 (월~토, 11시 이전)
    target.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0)
  } else {
    // 다음 날 11시, 일요일 건너뛰기
    target.setUTCDate(target.getUTCDate() + 1)
    target.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0)
    while (target.getUTCDay() === 0) {
      target.setUTCDate(target.getUTCDate() + 1)
    }
  }

  return fromKst(target)
}

/** "YYYY-MM-DD HH:mm" KST 표기 */
export function formatKst(d: Date): string {
  const kst = toKst(d)
  const y = kst.getUTCFullYear()
  const mo = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const da = String(kst.getUTCDate()).padStart(2, '0')
  const h = String(kst.getUTCHours()).padStart(2, '0')
  const mi = String(kst.getUTCMinutes()).padStart(2, '0')
  return `${y}-${mo}-${da} ${h}:${mi}`
}
