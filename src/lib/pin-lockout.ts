// PIN 연속 실패 락아웃 (2026-07-26, 운영자님 지시 "5회실패시 잠그면 되잖아")
//
// 왜 자릿수 대신 락아웃인가: 4자리(1만 조합)를 6자리로 늘리면 전 기기 재입력 부담이 생기는데,
// 락아웃은 부담 0으로 "시도 자체"를 못 하게 막는다. 시도가 막히면 자릿수 계산이 무의미해진다.
//
// ⚠️ 전역 잠금이 아니라 IP별 잠금인 이유: 전역으로 잠그면 공격자가 일부러 5번 틀려
// 교실 태블릿(/classroom)을 수업 중에 잠글 수 있다 = 브루트포스보다 실피해가 큰 DoS.
// 그래서 잠금은 "실패한 그 IP"에만 건다.
//
// 백오프를 짧게 시작하는 이유: 학원 공용 와이파이라 태블릿·조교폰·운영자님 폰이 같은
// 공인 IP를 공유할 수 있다. 옆에서 누가 오타 냈다고 30분 잠기면 그게 더 나쁘다.
// 1분에서 시작해 반복 공격에만 길어진다.

const MAX_FAILURES = 5
// 5회째 실패부터 적용되는 잠금 시간(분). 이후는 마지막 값(30분) 유지.
// 2026-07-26 운영자님 지시 계단: 1 → 3 → 5 → 15 → 30분.
const BACKOFF_MINUTES = [1, 3, 5, 15, 30]
// 이 시간 동안 추가 실패가 없으면 카운터를 잊는다(사람의 산발적 오타가 누적되지 않게).
const FAILURE_TTL_MS = 60 * 60_000

interface FailRecord {
  count: number
  lockedUntil: number
  lastFailAt: number
}

const failures = new Map<string, FailRecord>()

function prune(now: number) {
  for (const [ip, r] of failures) {
    // 잠금이 살아있으면 유지, 아니면 마지막 실패 이후 TTL 경과 시 제거
    if (r.lockedUntil > now) continue
    if (now - r.lastFailAt >= FAILURE_TTL_MS) failures.delete(ip)
  }
}

/** 잠긴 상태면 남은 초, 아니면 0. 부작용 없음(검사 전용). */
export function pinLockRemainingSec(ip: string, now: number = Date.now()): number {
  const r = failures.get(ip)
  if (!r) return 0
  if (r.lockedUntil <= now) return 0
  return Math.ceil((r.lockedUntil - now) / 1000)
}

/** 첫 잠금(1분)까지 남은 시도 횟수. 화면 "앞으로 N번" 표시용. 부작용 없음.
 *  이미 임계 도달(잠긴 뒤 계속 실패)면 0. */
export function pinAttemptsRemaining(ip: string, now: number = Date.now()): number {
  const r = failures.get(ip)
  if (!r) return MAX_FAILURES
  // TTL 지난 카운터는 곧 리셋되므로 최대치로 취급
  if (r.lockedUntil <= now && now - r.lastFailAt >= FAILURE_TTL_MS) return MAX_FAILURES
  return Math.max(0, MAX_FAILURES - r.count)
}

/** 실패 1회 기록. 임계 도달 시 잠근다. 잠금 남은 초 반환(안 잠겼으면 0). */
export function recordPinFailure(ip: string, now: number = Date.now()): number {
  const prev = failures.get(ip)
  // 마지막 실패가 TTL 넘게 오래됐으면 새로 시작 (산발적 오타 누적 방지)
  const stale = prev && prev.lockedUntil <= now && now - prev.lastFailAt >= FAILURE_TTL_MS
  const count = (stale || !prev ? 0 : prev.count) + 1

  let lockedUntil = prev && prev.lockedUntil > now ? prev.lockedUntil : 0
  if (count >= MAX_FAILURES) {
    const step = Math.min(count - MAX_FAILURES, BACKOFF_MINUTES.length - 1)
    lockedUntil = now + BACKOFF_MINUTES[step] * 60_000
  }

  failures.set(ip, { count, lockedUntil, lastFailAt: now })
  if (failures.size > 10_000) prune(now)
  return lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0
}

/** 성공 시 즉시 초기화 — 정상 사용자는 다음에 오타 내도 처음부터 5회를 다시 받는다. */
export function clearPinFailures(ip: string): void {
  failures.delete(ip)
}

/** 테스트 전용 */
export function __resetPinLockout(): void {
  failures.clear()
}
