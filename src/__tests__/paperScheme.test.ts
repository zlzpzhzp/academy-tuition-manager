// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { installPaperScheme, normalizePaperPreference, PAPER_COLORS, PAPER_INITIAL_STYLE, PAPER_SCHEME_SCRIPT } from '@/lib/paperScheme'
import PaperSchemeControl from '@/components/PaperSchemeControl'

let os: MediaQueryList, reduced: MediaQueryList
const boot = () => installPaperScheme(PAPER_COLORS, normalizePaperPreference)
function media(matches: boolean) {
  return Object.assign(new EventTarget(), { matches, media: '', onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList
}
function change(m: MediaQueryList, matches: boolean) {
  Object.defineProperty(m, 'matches', { value: matches, configurable: true })
  m.dispatchEvent(new Event('change'))
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  delete window.__paperScheme; localStorage.clear()
  document.documentElement.removeAttribute('data-paper-scheme')
  document.documentElement.removeAttribute('data-paper-kiosk')
  document.body.innerHTML = ''
  document.head.innerHTML = '<meta name="theme-color" data-paper-meta="light"><meta name="theme-color" data-paper-meta="dark">'
  os = media(false); reduced = media(false)
  vi.stubGlobal('matchMedia', (q: string) => q.includes('reduced-motion') ? reduced : os)
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('스킴 선택은 API를 호출하지 않는다') }))
})
afterEach(() => { vi.runAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.__paperScheme })

describe('첫 스크립트와 런타임의 저장/OS 행렬', () => {
  for (const stored of [null, 'auto', '', 'invalid', 'LIGHT', 'light', 'dark']) for (const dark of [false, true]) {
    it(`${stored} / OS ${dark ? 'dark' : 'light'}`, () => {
      if (stored !== null) localStorage.setItem('paper-scheme', stored)
      change(os, dark)
      // 실제 head에 넣는 문자열을 실행: 함수만 직접 시험해 직렬화 결함을 놓치지 않는다.
      window.eval(PAPER_SCHEME_SCRIPT)
      const controller = boot()
      expect(controller.preference).toBe(normalizePaperPreference(stored))
      expect(controller.scheme).toBe(stored === 'light' || stored === 'dark' ? stored : dark ? 'dark' : 'light')
      expect(document.documentElement.dataset.paperScheme).toBe(controller.scheme)
      expect(document.querySelector<HTMLMetaElement>('meta[media="all"]')?.content).toBe(PAPER_COLORS[controller.scheme])
      expect(document.documentElement.classList.contains('paper-scheme-changing')).toBe(false)
      change(os, !dark)
      expect(controller.scheme).toBe(stored === 'light' || stored === 'dark' ? stored : dark ? 'light' : 'dark')
    })
  }
  it('읽기 실패=auto, 쓰기 실패에도 수동 선택 적용·OS 변경에 고정', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota') })
    change(os, true); window.eval(PAPER_SCHEME_SCRIPT)
    expect(boot().preference).toBe('auto'); expect(boot().scheme).toBe('dark')
    boot().set('light'); change(os, false); change(os, true)
    expect(boot().preference).toBe('light'); expect(boot().scheme).toBe('light')
    expect(document.querySelector<HTMLMetaElement>('meta[media="all"]')?.content).toBe(PAPER_COLORS.light)
  })
  it('표식 파싱 전 스킴 적용, kiosk 표식 우선·SPA 복귀', () => {
    const c = boot(); c.set('dark')
    expect(document.querySelector('[data-ui-theme]')).toBeNull()
    expect(document.documentElement.dataset.paperScheme).toBe('dark')
    document.body.innerHTML = '<div data-ui-theme="kiosk"></div>'
    c.route('/kiosk'); c.set('light')
    expect(document.documentElement.hasAttribute('data-paper-kiosk')).toBe(true)
    expect(document.querySelector<HTMLMetaElement>('meta[media="all"]')?.content).toBe('#070b14')
    document.body.innerHTML = '<div data-ui-theme="paper"></div>'; c.route('/settings')
    expect(document.documentElement.hasAttribute('data-paper-kiosk')).toBe(false)
    expect(c.scheme).toBe('light')
  })
  it('색만 220ms 추가, 기존 transform/그림자 시간 보존, reduced 즉시', () => {
    document.body.innerHTML = '<button style="transition-property:transform,box-shadow;transition-duration:.15s,.3s;transition-timing-function:ease,ease;transition-delay:0s,0s">대조</button><div id="untargeted"></div>'
    boot().set('dark')
    const button = document.querySelector('button')!
    const transition = button.style.getPropertyValue('--paper-color-transition')
    expect(transition).toContain('transform .15s'); expect(transition).toContain('box-shadow .3s')
    expect(transition).toContain('background-color 220ms'); expect(transition).toContain('color 220ms')
    expect(document.querySelector('#untargeted')?.hasAttribute('data-paper-color-transition')).toBe(false)
    change(reduced, true)
    expect(document.querySelector('[data-paper-color-transition]')).toBeNull()
    boot().set('light'); expect(document.documentElement.dataset.paperScheme).toBe('light')
    expect(document.documentElement.classList.contains('paper-scheme-changing')).toBe(false)
  })
  it('선택 버튼은 네이티브 키보드 버튼·선택 상태, 노드/초안 보존 및 API 0', async () => {
    boot(); const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(h('div', {}, h('input', { defaultValue: '편집중' }), h(PaperSchemeControl))))
    const input = host.querySelector('input')!, buttons = host.querySelectorAll('button')
    expect([...buttons].map(b => b.textContent)).toEqual(['자동', '밝게', '어둡게'])
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
    await act(async () => buttons[2].click())
    expect(buttons[2].type).toBe('button'); expect(buttons[2].getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('paper-scheme')).toBe('dark')
    expect(host.querySelector('input')).toBe(input); expect(input.value).toBe('편집중')
    expect(fetch).not.toHaveBeenCalled()
    await act(async () => root.unmount()); host.remove()
  })
  it('선도색/manifest와 hydration 소유권 계약', () => {
    for (const value of Object.values(PAPER_COLORS)) expect(PAPER_INITIAL_STYLE).toContain(value)
    const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'))
    expect(manifest.background_color).toBe(PAPER_COLORS.dark); expect(manifest.theme_color).toBe(PAPER_COLORS.dark)
    const layout = readFileSync('src/app/layout.tsx', 'utf8')
    expect(layout).toContain('<html lang="ko" suppressHydrationWarning>')
    expect(layout).toMatch(/PAPER_INITIAL_STYLE[^]*?<script dangerouslySetInnerHTML=\{\{ __html: PAPER_SCHEME_SCRIPT/)
  })
})
