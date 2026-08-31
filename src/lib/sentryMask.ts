import type { ErrorEvent as SentryErrorEvent } from '@sentry/nextjs'

const MASK = '<masked>'
// 소문자 비교용. 'name' 전체를 막으면 반 이름·필드명 같은 비민감 값까지 통째로 가려 디버깅이 불가능해지므로
// 학생 이름 키만 정확히 잡는다. 전화번호는 키 표기가 갈려(parentPhone/phone_number) 부분일치로 본다.
const MASK_KEYS = ['phone', 'parent_phone', 'parent_father_phone', 'student_name', 'studentname', 'pin', 'admin_pin', 'amount']
// 순환 참조·거대 트리 방어 — 이 깊이를 넘으면 값 자체를 가린다.
const MAX_DEPTH = 6

function shouldMask(key: string): boolean {
  const lower = key.toLowerCase()
  return lower.includes('phone') || MASK_KEYS.includes(lower)
}

function maskValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return MASK
  if (Array.isArray(value)) return value.map(v => maskValue(v, depth + 1))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shouldMask(k) ? MASK : maskValue(v, depth + 1)
    }
    return out
  }
  return value
}

// Sentry PII 마스킹 — 클라이언트에만 있고 서버·엣지엔 없던 비대칭을 공용화 (2026-08-13 라인리뷰).
// 쿠키(세션 토큰)와 요청 body의 학생 PII·시크릿 필드를 외부 서비스로 내보내지 않는다.
// 2026-08-16 라인리뷰: 최상위 키만 보던 탓에 문자열 body와 중첩 객체·배열({ entries: [...] } 등)의
// 전화번호·학생명이 그대로 나갔다 — 재귀 순회로 바꾼다.
export function maskSentryEvent(event: SentryErrorEvent): SentryErrorEvent {
  if (event.request?.cookies) {
    event.request.cookies = Object.fromEntries(
      Object.keys(event.request.cookies).map(k => [k, MASK])
    )
  }
  if (event.request?.data !== undefined && event.request.data !== null) {
    // 문자열 body는 형식을 알 수 없다(JSON·form-urlencoded·평문) → 통째로 가린다
    event.request.data = typeof event.request.data === 'string'
      ? MASK
      : maskValue(event.request.data, 0)
  }
  return event
}
