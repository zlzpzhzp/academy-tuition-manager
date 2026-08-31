/**
 * 통화 포맷 헬퍼
 *
 * - formatWon: "33,870,000원" — 정확한 숫자가 필요한 입력/명세/audit 로그용
 * - formatWonShort: "3,387만원" / "1.2억원" — dashboard hero / 작은 카드처럼 빠른 인지가 필요할 때
 *
 * dashboard 통계 카드는 이미 만원 단위로 표시 중 — 일관성 위해 short 권장.
 * BillActionModal 등 청구서 본문은 정확한 금액 필요 → formatWon.
 */

export const formatWon = (n: number | null | undefined): string => {
  const v = n ?? 0
  return `${v.toLocaleString('ko-KR')}원`
}

export const formatWonShort = (n: number | null | undefined): string => {
  const v = n ?? 0
  if (v === 0) return '0원'
  const abs = Math.abs(v)
  if (abs >= 1e8) {
    const eok = v / 1e8
    return `${eok.toFixed(eok % 1 === 0 ? 0 : 1)}억원`
  }
  if (abs >= 1e4) {
    const man = Math.round(v / 1e4)
    return `${man.toLocaleString('ko-KR')}만원`
  }
  return `${v.toLocaleString('ko-KR')}원`
}

/** 차감액 표시(원천징수·비용 등): 0이면 '0원', 아니면 '-33,000원'. "-0원" 방지. */
export const formatWonNeg = (n: number | null | undefined): string => {
  const v = n ?? 0
  return v === 0 ? '0원' : `-${Math.abs(v).toLocaleString('ko-KR')}원`
}

/** 숫자만 필요한 곳 (단위 없이) */
export const formatNumber = (n: number | null | undefined): string => {
  return (n ?? 0).toLocaleString('ko-KR')
}

/**
 * 반 표시 이름: DB name 은 'H' 같은 알파벳 한 글자라 과목 없이는 수학H/영어A 가 구분 안 됨 → '수학H' 형태로 합성.
 * subject 없으면 name 만, name 이 이미 과목으로 시작하면 중복 안 붙임. 표시 전용 — DB 값·학부모 발송 문구와 무관.
 */
export const formatClassName = (cls?: { name?: string | null; subject?: string | null } | null): string => {
  const name = cls?.name ?? ''
  const subject = cls?.subject ?? ''
  if (!name) return ''
  if (!subject || name.startsWith(subject)) return name
  return `${subject}${name}`
}

// ─── 두 과목 수강생 출결 과목 구분 (2026-08-31 지시) ────────────────
/**
 * 두 과목(2행+) 수강생의 그날 출결이 어느 과목 수업인지 — 각 수강 반의 class_days 와
 * 그날 요일을 대조해 과목 라벨을 합성한다("수학" / "영어" / 겹치는 날 "수학·영어", 수학 우선).
 * 키오스크·키패드는 건드리지 않는 표시 전용 판정. 1과목 수강생·수업 없는 날은 null.
 */
export function todaysSubjectsLabel(
  entries: { subject?: string | null; classDays?: string | null }[],
  weekday: number,
): string | null {
  if (entries.length < 2) return null
  const subjects: string[] = []
  for (const e of entries) {
    const days = (e.classDays ?? '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    if (days.includes(weekday) && e.subject && !subjects.includes(e.subject)) subjects.push(e.subject)
  }
  if (subjects.length === 0) return null
  subjects.sort((a, b) => (a === '수학' ? -1 : b === '수학' ? 1 : 0))
  return subjects.join('·')
}
