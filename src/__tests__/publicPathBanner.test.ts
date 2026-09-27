import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 트립와이어: **인증 없이 열리는 페이지가 늘면 설치배너 판단을 강제한다.**
 *
 * 2026-07-31 사고: /kiosk 를 미들웨어 공개경로에 넣었는데 InstallPrompt 의 HIDDEN_PATHS 에는
 * 안 넣어서, 배너가 키패드와 등원/하원 버튼을 덮어 **출결이 아예 안 됐다**(운영자님 신고).
 * 2026-08-02 에는 /login 이 같은 이유로 부분가림이었다(그 화면은 `fixed inset-0` 이라
 * 본문 하단여백으로도 못 푼다 — 배너를 빼는 것 말고 방법이 없었다).
 *
 * 두 목록이 서로 다른 파일에 있고 "같이 고쳐라"는 주석으로는 또 어긋난다(2026-08-02 운영 점검 결론:
 * **구조 문제를 주석으로 덮지 마라**). 그래서 기계가 잡게 한다.
 *
 * 이 테스트가 깨지면 = 공개 페이지를 새로 열었다는 뜻이다. 배너를 띄울지 **의식적으로 정하고**
 * HIDDEN_PATHS 에 넣거나 아래 BANNER_OK 에 사유와 함께 추가해라. 그냥 지우지 마라.
 */

// 배너가 떠도 괜찮다고 **의식적으로 판단한** 공개 페이지(사유 필수)
const BANNER_OK: Record<string, string> = {}

function read(rel: string) {
  return readFileSync(join(process.cwd(), rel), 'utf-8')
}

/**
 * 미들웨어의 **인증 우회 블록에서만** '페이지' 경로를 추린다(API·정적자산 제외).
 * ⚠️ 파일 전체를 긁으면 안 된다 — 뒤쪽 재무 PIN 게이트 블록에도 `pathname === '/finance'` 가 있고
 *   그건 **인증 우회가 아니라 반대(추가 관문)** 다. 2026-08-02 이 테스트 첫 판에서 실제로 오검출했고,
 *   음성 대조(현 상태는 통과해야 한다)가 커밋 전에 잡았다.
 */
function publicPagePaths(): string[] {
  const src = read('src/middleware.ts')
  const start = src.indexOf('정적 파일은 통과')
  if (start < 0) throw new Error('인증 우회 블록 주석을 못 찾았다 — 미들웨어가 바뀌었으면 이 테스트도 같이 고쳐라')
  const open = src.indexOf('if (', start)
  const close = src.indexOf(') {', open)
  if (open < 0 || close < 0) throw new Error('인증 우회 블록 범위를 못 잡았다')
  const block = src.slice(open, close)
  const eq = [...block.matchAll(/pathname === '([^']+)'/g)].map(m => m[1])
  return eq.filter(
    p =>
      !p.startsWith('/api') &&
      !p.startsWith('/_next') &&
      !p.startsWith('/icons') &&
      !/\.(json|jpg|png|ico|js|txt|webmanifest)$/.test(p),
  )
}

function hiddenPaths(): string[] {
  const src = read('src/components/InstallPrompt.tsx')
  const m = src.match(/const HIDDEN_PATHS = \[([^\]]*)\]/)
  if (!m) throw new Error('HIDDEN_PATHS 를 못 찾았다 — 이름이 바뀌었으면 이 테스트도 같이 고쳐라')
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
}

describe('공개 페이지 ↔ 설치배너 억제 목록', () => {
  it('검사 자체가 도는지 먼저 — 양쪽 목록을 실제로 읽어낸다', () => {
    // 0건이면 정규식이 깨진 것이지 "해당 없음"이 아니다(2026-08-02 운영 규칙: 0의 이유를 대라)
    expect(publicPagePaths().length).toBeGreaterThan(0)
    expect(hiddenPaths().length).toBeGreaterThan(0)
  })

  it('인증 없이 열리는 페이지는 배너를 숨기거나 명시적으로 허용돼 있어야 한다', () => {
    const missing = publicPagePaths().filter(
      p => !hiddenPaths().includes(p) && !(p in BANNER_OK),
    )
    expect(
      missing,
      `공개 페이지 ${missing.join(', ')} 에 대한 배너 판단이 없다.\n` +
        `→ InstallPrompt.tsx 의 HIDDEN_PATHS 에 넣거나, 띄워도 괜찮다면 이 테스트의 BANNER_OK 에 사유와 함께 넣어라.\n` +
        `  (2026-07-31 에 /kiosk 가 이 자리에서 빠져 출결이 아예 안 됐다)`,
    ).toEqual([])
  })
})
