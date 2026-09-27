import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/app/globals.css', 'utf8')
const paper = css.slice(css.indexOf(':root:has([data-ui-theme="paper"]) {')).split('\n}')[0]
const tokens = Object.fromEntries([...paper.matchAll(/(--[\w-]+):\s*(#[\da-f]{6});/g)].map(m => [m[1], m[2]]))
const rgb = (hex: string) => hex.slice(1).match(/../g)!.map(c => parseInt(c, 16))
const luminance = (rgb: number[]) => rgb.reduce((sum, c, i) => sum + (c / 255 <= .04045 ? c / 255 / 12.92 : ((c / 255 + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i], 0)
const grainAlpha = Number(paper.match(/--paper-grain-opacity:\s*([.\d]+)/)![1]) * Number(paper.match(/slope='([.\d]+)'/)![1])
function contrast(fg: string, bg: string, opacity = 1) {
  // normal 회색 grain. 서로 다른 전경/배경 픽셀에 흰색·검정 최대 alpha를 각각
  // 합성한 네 조합 중 최솟값을 검사한다(밝은 글자/어두운 버튼도 같은 계산).
  const background = rgb(tokens[bg])
  const foreground = rgb(tokens[fg]).map((c, i) => c * opacity + background[i] * (1 - opacity))
  const extremes = (color: number[]) => [0, 255].map(grain => luminance(color.map(c => c * (1 - grainAlpha) + grain * grainAlpha)))
  return Math.min(...extremes(foreground).flatMap(a => extremes(background).map(b => (Math.max(a, b) + .05) / (Math.min(a, b) + .05))))
}

describe('D3 표시 대비 요구', () => {
  it('종이 테마의 고정 단일 그레인은 normal·저농도로 합성하며 클릭을 가리지 않는다', () => {
    const grain = css.match(/html:has\(\[data-ui-theme="paper"\]\) body::before\s*\{([^}]+)\}/)![1]
    expect(grain).toMatch(/mix-blend-mode:\s*normal/)
    expect(grain).toMatch(/position:\s*fixed/)
    expect(grain).toMatch(/pointer-events:\s*none/)
    expect(grainAlpha).toBeGreaterThan(0)
    expect(grainAlpha).toBeLessThanOrEqual(.0144)
  })
  it('대비 계산이 저대비 실패 표본을 거부한다', () => {
    expect((luminance(rgb('#ffffff')) + .05) / (luminance(rgb('#9d9789')) + .05)).toBeLessThan(4.5)
  })
  for (const bg of ['--bg', '--bg-card', '--bg-card-hover', '--bg-elevated']) {
    it(`${bg} 위 일반 글자는 질감 합성 후 4.5:1`, () => {
      for (const fg of ['--text-1','--text-2','--text-3','--text-4']) expect(contrast(fg,bg), `${fg}/${bg}`).toBeGreaterThanOrEqual(4.5)
    })
  }
  for (const [fg,bg] of [['--paid-text','--paid-bg'],['--unpaid-text','--unpaid-bg'],['--scheduled-text','--scheduled-bg'],['--blue','--blue-bg'],['--green','--green-dim'],['--scheduled-text','--orange-dim'],['--red','--red-dim'],['--purple','--purple-dim'],['--pink','--pink-dim'],['--cyan','--cyan-dim'],['--yellow','--yellow-dim']]) {
    it(`${fg} 상태·범주 의미색은 4.5:1`, () => expect(contrast(fg,bg)).toBeGreaterThanOrEqual(4.5))
  }
  it('활성 버튼 전경은 4.5:1, 필수 경계·차트색은 3:1', () => {
    for (const bg of ['--blue','--red','--green','--orange']) {
      expect(contrast('--on-action', bg),bg).toBeGreaterThanOrEqual(4.5)
    }
    for (const fg of ['--control-border','--blue','--green','--orange','--red','--color-accent','--text-3']) expect(contrast(fg,'--bg-card')).toBeGreaterThanOrEqual(3)
    for (const fg of ['--blue','--green','--orange','--red','--paid-text','--scheduled-text','--color-accent','--text-3']) expect(contrast(fg,'--bg-card',.85)).toBeGreaterThanOrEqual(3)
  })
  it('달력의 지연일은 선택/범위 배경에서도 4.5:1, 선택 테두리는 3:1', () => {
    expect(contrast('--red', '--blue-dim')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('--red', '--bg-card')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('--blue', '--blue-dim')).toBeGreaterThanOrEqual(3)
    // 이전 파란 채움 + 빨간 숫자는 이 검사를 통과하면 안 된다.
    expect(contrast('--red', '--blue')).toBeLessThan(4.5)
  })
})
