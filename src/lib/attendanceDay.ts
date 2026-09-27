/** 출결 키오스크 '수업일 아님' 가드용 순수 함수 (2026-09-09 운영자님 지시 — 오태그 알림톡 방지).
 *
 * 계기: 예비중1 학생이 하원 태그에서 자기 코드(1596) 대신 1599 를 눌러, 그날 오지도 않은
 * 다른 학생(월·토 수업)의 하원 알림톡이 수요일마다 학부모에게 나갔다(9/2·9/9 실측).
 * 코드가 한 자리만 달라 '유효한 코드'라 서버는 정상 처리했다 — 막을 지점은 '오늘 그 학생 수업일인가'다.
 */

/** tuition_classes.class_days('1,6' 형식, 0=일 … 6=토) → 요일 숫자 배열. 잘못된 값은 버린다. */
export function parseClassDays(value?: string | null): number[] {
  if (!value) return []
  return String(value)
    .split(',')
    .map(s => s.trim())
    // 빈 조각을 Number() 에 넣으면 0(=일요일)이 된다 — '1,6,' 같은 값이 일요일 수업으로 둔갑한다
    .filter(s => /^\d+$/.test(s))
    .map(Number)
    .filter(n => n >= 0 && n <= 6)
}

/**
 * 그 사람의 반들(class_days 목록) 기준으로 오늘이 수업일인지 판정.
 * - true  = 수업일 (그대로 통과)
 * - false = 수업일 아님 (키오스크에서 한 번 더 확인받는다)
 * - null  = 판정 불가(요일 정보가 하나도 없음) → **통과시킨다**. 정보 없는 학생의 출결을 막으면
 *           보강·자습 학생이 키오스크 앞에서 못 찍는다. 가드는 알림 오발송만 막으면 된다.
 */
export function isScheduledDay(classDaysValues: (string | null | undefined)[], weekday: number): boolean | null {
  const days = classDaysValues.flatMap(parseClassDays)
  if (days.length === 0) return null
  return days.includes(weekday)
}
