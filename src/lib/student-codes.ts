// 서버/클라 공용 순수 함수 — swr 등 클라 전용 의존성 없는 파일 (server route에서 import 안전)

/** 발송용 전화번호 정규화 — 숫자만 남긴다.
 *  하이픈만 지우던 탓에 공백·괄호 같은 게 섞여 오면 그대로 남아 발송 검증(01x 10~11자리)에서 422로 막혔다.
 *  번호는 상담카드(쌤)·엑셀·수기 입력 등 여러 경로로 들어와 눈에 안 보이는 공백이 붙기 쉽다. (2026-07-22) */
export function normalizePhone(phone?: string | null): string {
  return (phone || '').replace(/\D/g, '')
}

/** 학생 번호 → 출결코드 자동 선택. 기본 뒷4자리, 중복이면 가운데4자리, 둘 다 중복이면 뒷4자리+conflict='both'.
 *  taken: 이미 사용 중인 출결코드 집합(본인 제외). */
export function pickAttendanceCode(phone: string, taken: Set<string>): { code: string; conflict: 'none' | 'middle' | 'both' } {
  const d = (phone || '').replace(/\D/g, '')
  const last4 = d.slice(-4)
  if (!last4) return { code: '', conflict: 'none' }
  const mid4 = d.length >= 7 ? d.slice(3, 7) : last4
  if (!taken.has(last4)) return { code: last4, conflict: 'none' }
  if (mid4 !== last4 && !taken.has(mid4)) return { code: mid4, conflict: 'middle' }
  return { code: last4, conflict: 'both' }
}

/** 결제선생 청구서 발송 대상 번호 — payssam_recipient(기본 어머니) 설정대로.
 *  아버지 선택인데 부 번호 없으면 어머니로, 학부모 번호 둘 다 없으면 학생 번호로 fallback. */
export function billingPhone(s: {
  parent_phone?: string | null
  parent_father_phone?: string | null
  phone?: string | null
  payssam_recipient?: 'mother' | 'father' | null
}): string {
  const mother = s.parent_phone || ''
  const father = s.parent_father_phone || ''
  const chosen = s.payssam_recipient === 'father' ? (father || mother) : mother
  return chosen || s.phone || ''
}

/** 학부모 번호만 — 학생 본인 번호로 fallback 하지 않는다.
 *  '학부모에게'와 '학생에게'가 갈리는 경로(공지 일괄발송·미납 안내)는 이걸 쓴다. billingPhone 을 쓰면
 *  학부모 번호가 없을 때 조용히 학생 폰으로 가버린다.
 *  ⚠️ `parent_phone`(어머니)만 보는 코드는 아버님이 수신자인 학생을 놓친다 — 어머니 번호가 비어 있으면
 *  안내가 아예 안 나가고(백종원 2026-08-11 실측), 둘 다 있으면 원장이 고른 수신자를 무시한다. */
export function parentPhone(s: {
  parent_phone?: string | null
  parent_father_phone?: string | null
  payssam_recipient?: 'mother' | 'father' | null
}): string {
  const mother = s.parent_phone || ''
  const father = s.parent_father_phone || ''
  return s.payssam_recipient === 'father' ? (father || mother) : (mother || father)
}
