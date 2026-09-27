// @vitest-environment jsdom
import { act, createElement as h, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnimatedNumber, StaggerContainer, StaggerItem, TButton } from '@/components/motion'
import { motion } from '@/components/paperMotion'
import { DashboardSkeleton, PaymentsSkeleton } from '@/components/Skeleton'
import AiFilterButton from '@/components/payments/AiFilterButton'
import MethodPickerPopup from '@/components/payments/MethodPickerPopup'

let pathname = '/payments'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
import PageTransition from '@/components/PageTransition'
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  pathname = '/payments'
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('종이 모션 표시·기능 회귀', () => {
  it('reduced-motion 숫자는 mount·갱신 시 최종값과 기존 반올림·단위를 즉시 표시', async () => {
    await act(async () => root.render(h(AnimatedNumber, { value: 1234.6, suffix: '만원' })))
    expect(host.textContent).toBe('1,235만원')
    await act(async () => root.render(h(AnimatedNumber, { value: 9.2, suffix: '만원' })))
    expect(host.textContent).toBe('9만원')
  })
  it('SSR 숫자는 0 폴백 없이 최종값을 표시', () => {
    expect(renderToString(h(AnimatedNumber, { value: 1200, suffix: '원' }))).toContain('1,200')
  })
  it('스켈레톤 SSR은 글자·도형을 초기 opacity 0으로 숨기지 않는다', () => {
    for (const C of [DashboardSkeleton, PaymentsSkeleton]) expect(renderToString(h(C))).not.toMatch(/style="[^"]*opacity:0(?:;|")/)
  })
  it('이동·스태거·반복이 있어도 reduced-motion은 최종 표시 상태', async () => {
    await act(async () => root.render(h(motion.div, { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { delay: 3, duration: 2, repeat: Infinity } }, '완료')))
    expect(host.firstElementChild?.getAttribute('style')).toContain('opacity: 1')
    expect(host.firstElementChild?.getAttribute('style')).not.toContain('translateY(10px)')
  })
  it('버튼 DOM·disabled·입력 이벤트를 보존한다', async () => {
    const click = vi.fn()
    await act(async () => root.render(h(TButton, { disabled: true, onClick: click }, '동작')))
    expect(host.childElementCount).toBe(1)
    expect(host.firstElementChild?.tagName).toBe('BUTTON')
    await act(async () => host.querySelector('button')!.click()); expect(click).not.toHaveBeenCalled()
    await act(async () => root.render(h(TButton, { disabled: false, onClick: click }, '동작')))
    await act(async () => host.querySelector('button')!.click()); expect(click).toHaveBeenCalledTimes(1)
  })
  it('페이지 경로만 바뀔 때 자식 입력을 재마운트하지 않는다', async () => {
    let mounts = 0
    function Form() { const [value, setValue] = useState('보존'); useEffect(() => { mounts++ }, []); return h('input', { value, onChange: e => setValue(e.currentTarget.value) }) }
    await act(async () => root.render(h(PageTransition, { children: h(Form) })))
    const input = host.querySelector('input')
    pathname = '/stats'
    await act(async () => root.render(h(PageTransition, { children: h(Form) })))
    expect(host.querySelector('input')).toBe(input); expect(mounts).toBe(1)
    expect(host.querySelector('input')?.value).toBe('보존')
  })
  it('키오스크 SSR 경계는 종이 표식 없이 기존 단일 div', () => {
    pathname = '/kiosk'
    const markup = renderToString(h(PageTransition, { children: h('button', {}, '키오스크') }))
    expect(markup).toContain('data-ui-theme="kiosk"'); expect(markup).not.toContain('data-ui-theme="paper"')
    expect(markup.match(/<div/g)).toHaveLength(1)
  })
  it('reduced-motion에서는 입자 RAF를 시작하지 않으며 필터 입력·실행을 보존', async () => {
    const raf = vi.fn(() => 1), filter = vi.fn(async () => {})
    vi.stubGlobal('requestAnimationFrame', raf)
    await act(async () => root.render(h(AiFilterButton, { aiFilterIds: null, aiFilterDesc: '', onFilter: filter, onClear() {}, loading: false })))
    expect(raf).not.toHaveBeenCalled()
    await act(async () => (document.querySelector('[aria-label="AI 필터 열기"]') as HTMLButtonElement).click())
    expect(document.querySelector('[aria-label="AI 필터 실행"]')).not.toBeNull()
    expect(filter).not.toHaveBeenCalled()
    expect(document.querySelectorAll('svg.fixed polygon')).toHaveLength(0)
  })
  it('일반 숫자 보간 중 동작 줄이기로 전환하면 즉시 최종값으로 끝낸다', async () => {
    let reduced = false
    const listeners = new Set<() => void>()
    vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced }, addEventListener(_name: string, fn: () => void) { listeners.add(fn) }, removeEventListener(_name: string, fn: () => void) { listeners.delete(fn) } }))
    await act(async () => root.render(h(AnimatedNumber, { value: 1000 })))
    await act(async () => { await new Promise(r => setTimeout(r, 150)) })
    const mid = Number(host.textContent?.replaceAll(',', ''))
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(1000)
    await act(async () => { reduced = true; listeners.forEach(fn => fn()) })
    expect(host.textContent).toBe('1,000')
  })
  it('일반 모션에서 9번째 이후 항목은 첫 8개 스태거를 기다리지 않는다', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    await act(async () => root.render(h(StaggerContainer, { children: Array.from({ length: 10 }, (_, i) => h(StaggerItem, { key: i, children: String(i) })) })))
    await act(async () => { await new Promise(r => setTimeout(r, 285)) })
    const items = host.firstElementChild!.children
    expect(Number((items[0] as HTMLElement).style.opacity)).toBeGreaterThan(.95)
    expect(Number((items[7] as HTMLElement).style.opacity)).toBeLessThan(.1)
    expect(Number((items[8] as HTMLElement).style.opacity)).toBeGreaterThan(.95)
    expect(Number((items[9] as HTMLElement).style.opacity)).toBeGreaterThan(.95)
  })

  it('reduced-motion 수단 피커는 다음 프레임을 기다려 숨지 않는다', async () => {
    const raf = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', raf)
    await act(async () => root.render(h(MethodPickerPopup, { currentMethod: 'card', onMethodChange() {}, onClose() {}, anchorRef: { current: host } })))
    const options = document.querySelectorAll<HTMLElement>('[role="option"]')
    expect(options.length).toBeGreaterThan(0)
    expect(Array.from(options).every(option => option.style.opacity === '1')).toBe(true)
    expect(raf).not.toHaveBeenCalled()
  })

})

it('입자 표시의 색·투명도 값은 유지하고 CSS style fill로 전달한다 (호환성 정리)', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  const frames = new Map<number, FrameRequestCallback>()
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++id, cb); return id })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
  try {
    await act(async () => root.render(h(AiFilterButton, { aiFilterIds: null, aiFilterDesc: '', onFilter: async () => {}, onClear() {}, loading: false })))
    for (let frame = 0; frame < 20; frame++) {
      await act(async () => {
        const pending = [...frames.values()]; frames.clear()
        pending.forEach(cb => cb(frame * 16))
      })
    }
    const particles = document.querySelectorAll<SVGElement>('svg.fixed polygon')
    expect(particles.length).toBeGreaterThan(0)
    for (const particle of particles) {
      expect(particle.style.fill).toMatch(/^rgba\(var\(--particle\),0\./)
      expect(particle.hasAttribute('fill')).toBe(false)
      expect(particle.getAttribute('points')?.split(' ')).toHaveLength(8)
    }
    expect(document.querySelector('[aria-label="AI 필터 열기"] svg')?.getAttribute('fill')).toBe('var(--paid-text)')
  } finally { random.mockRestore() }
})
