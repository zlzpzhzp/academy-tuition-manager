import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import audit from '../../tests/e2e/dark-tokens.cjs'
import { PAPER_COLORS } from '@/lib/paperScheme'
const css = readFileSync('src/app/globals.css', 'utf8')
const sets = audit.tokenSets(css)

describe('종이 다크/라이트 상속·파생값 대비 계약', () => {
  for (const scheme of ['light','dark'] as const) {
    const tokens = sets[scheme]
    for (const [fg, bg] of audit.pairs as [string, string][]) it(`${scheme} ${fg}/${bg} 질감 극단 4.5:1`, () => {
      expect(audit.contrast(tokens, fg, bg)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${scheme} 필수 경계 3:1, 그레인 normal 상한, 초기색 일치`, () => {
      expect(audit.contrast(tokens, '--control-border', '--bg-elevated')).toBeGreaterThanOrEqual(3)
      expect(Number(tokens['--paper-grain-opacity'])).toBeLessThanOrEqual(.12)
      expect(tokens['--bg']).toBe(PAPER_COLORS[scheme])
      for (const key of Object.keys(tokens)) expect(audit.resolve(tokens, key)).not.toContain('var(')
    })
    it(`${scheme} 어두운 미디어의 전경은 밝으며 액션과 용도를 분리`, () => {
      expect(audit.luminance(audit.rgb(tokens['--on-media']))).toBeGreaterThan(.7)
      // 불투명 검정 위 overlay→hover control→grain 극단을 합성한 최악 배경.
      const overlay = audit.resolve(tokens, '--media-overlay').match(/[\d.]+/g)!.map(Number)
      const control = audit.resolve(tokens, '--media-control-hover').match(/[\d.]+/g)!.map(Number)
      const bg = overlay.slice(0,3).map((v: number,i: number) => (v * overlay[3] + 255 * (1-overlay[3])) * (1-control[3]) + control[i]*control[3])
      const fg = audit.rgb(tokens['--on-media']).map((v: number) => v * .9856)
      expect(audit.ratio(fg, bg.map((v: number) => v * .9856 + 255 * .0144))).toBeGreaterThanOrEqual(4.5)
    })
  }
  it('미정의 파생값·순환 별칭과 저대비 양성대조를 검출', () => {
    expect(() => audit.resolve(sets.dark, '--missing')).toThrow()
    expect(() => audit.resolve({ '--a':'var(--a)' }, '--a')).toThrow()
    expect(audit.contrast({ ...sets.dark, '--text-4':'#313a46' }, '--text-4','--bg-card')).toBeLessThan(4.5)
    expect(audit.contrast(sets.dark,'--on-media','--blue')).toBeLessThan(4.5)
  })
})
