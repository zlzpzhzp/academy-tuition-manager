/**
 * 반·섹션 기본 펼침 규칙 — 미납이 남은 곳은 펼치고, 전원납부한 곳은 접는다.
 * 납부탭(반)과 특강탭(반·명단그룹)이 같은 규칙을 쓴다.
 *
 * 바뀐 게 없으면 **같은 Set 참조**를 돌려준다 — 렌더 도중 상태를 맞출 때(2026-09-26 C05)
 * 새 Set 을 매번 만들면 불필요한 재렌더가 생긴다.
 *
 * @param entries [키, 접을지(전원납부)] 목록
 */
export function applyDefaultExpansion(prev: Set<string>, entries: Iterable<readonly [string, boolean]>): Set<string> {
  let next: Set<string> | null = null
  for (const [key, collapse] of entries) {
    const has = (next ?? prev).has(key)
    if (collapse === has) {
      next ??= new Set(prev)
      if (collapse) next.delete(key)
      else next.add(key)
    }
  }
  return next ?? prev
}
