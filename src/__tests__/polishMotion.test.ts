// @vitest-environment jsdom
import { act, createElement as h, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import QuickBillSendModal from '@/components/QuickBillSendModal'
import AnimatedModal from '@/components/ui/AnimatedModal'
import { usePullToRefresh } from '@/lib/usePullToRefresh'
import fixture from '../../tests/e2e/paper-fixtures.cjs'
import type { GradeWithClasses } from '@/types'

let pathname = '/dashboard'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
import PageTransition from '@/components/PageTransition'

let root: Root, host: HTMLDivElement, reduced: boolean
const mediaListeners = new Set<() => void>()
const click = async (button: HTMLButtonElement) => { expect(button).toBeTruthy(); await act(async () => button.click()) }
const button = (text: string) => Array.from(document.querySelectorAll('button')).find(el => el.textContent?.trim() === text)!
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  reduced = true; pathname = '/dashboard'; mediaListeners.clear()
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced }, addEventListener(_e: string, cb: () => void) { mediaListeners.add(cb) }, removeEventListener(_e: string, cb: () => void) { mediaListeners.delete(cb) } }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); document.body.style.overflow = ''
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})

describe('경로 전환과 실제 입력 보존', () => {
  it('같은 DOM에서 SPA 이동마다 페이드를 재생하며 이전 모션을 취소한다', async () => {
    reduced = false
    const cancellations: ReturnType<typeof vi.fn>[] = []
    const animate = vi.fn(() => { const cancel = vi.fn(); cancellations.push(cancel); return { cancel } })
    Object.defineProperty(host, 'animate', { value: animate, configurable: true })
    vi.stubGlobal('Animation', class {})
    const original = HTMLElement.prototype.animate
    HTMLElement.prototype.animate = animate as unknown as typeof original
    try {
      const render = () => root.render(h(PageTransition, { children: h('input', { defaultValue: '입력 보존' }) }))
      await act(async () => render())
      const input = host.querySelector('input')!
      input.value = '사용자가 편집한 값'
      pathname = '/stats'
      await act(async () => render())
      expect(animate).toHaveBeenCalledTimes(2)
      expect(cancellations[0]).toHaveBeenCalledTimes(1)
      expect(host.querySelector('input')).toBe(input)
      expect(input.value).toBe('사용자가 편집한 값')
      await act(async () => { reduced = true; mediaListeners.forEach(fn => fn()) })
      expect(cancellations[1]).toHaveBeenCalledTimes(1)
      expect(animate).toHaveBeenCalledTimes(2)
      pathname = '/kiosk'; await act(async () => render())
      expect(host.firstElementChild?.getAttribute('data-ui-theme')).toBe('kiosk')
      expect(host.querySelector('input')).toBe(input)
    } finally { HTMLElement.prototype.animate = original }
  })
})

describe('중첩 피커 앵커 추적', () => {
  it('내부 스크롤 폭주를 프레임 하나로 합치고 크기 변경·선택·정리를 보존한다', async () => {
    const frames = new Map<number, FrameRequestCallback>(); let id = 0
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++id, cb); return id })
    vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
    let resize = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { resize = cb } observe() {} disconnect = disconnect })
    const fetch = vi.fn(() => { throw new Error('모션·선택 검수 중 API 호출 금지') }); vi.stubGlobal('fetch', fetch)
    const grades = fixture.grades as GradeWithClasses[]
    await act(async () => root.render(h(QuickBillSendModal, {
      students: fixture.students.map(student => ({ ...student, memo_color: null, class: grades[0].classes[0] })), grades, billingMonth: '2026-09', onClose() {},
    })))
    const anchor = button('과목')
    let left = 20, bottom = 100, width = 120
    const measure = vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => ({ left, bottom, width } as DOMRect))
    await click(anchor)
    const card = document.querySelector('[data-picker-portal] [data-paper-card]') as HTMLElement
    expect(card.isConnected).toBe(true)
    const entryTransform = card.style.transform
    const reads = measure.mock.calls.length
    left = 45; bottom = 70; width = 90
    await act(async () => {
      for (let i = 0; i < 12; i++) anchor.dispatchEvent(new Event('scroll', { bubbles: false }))
      resize()
    })
    expect(measure).toHaveBeenCalledTimes(reads)
    expect(frames.size).toBe(1)
    await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(16)) })
    expect(measure).toHaveBeenCalledTimes(reads + 1)
    // 실제 좌표·폭은 CDP에서 검사한다. DOM 대역은 진입 모션을 덮지 않는지만 확인한다.
    expect(card.style.transform).toBe(entryTransform)
    await click(button('수학'))
    expect(button('수학')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
    // exit가 끝나 실제 포털을 제거한 뒤에도 앵커 리스너가 남으면 안 된다.
    await act(async () => root.render(null))
    expect(disconnect).toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })
})

describe('시트·중첩 포커스와 배경 스크롤', () => {
  it('모바일 확장 토글·중첩 닫기 후 부모 조작·최종 배경 복원을 보존한다', async () => {
    vi.useFakeTimers()
    function Stack() {
      const [outer, setOuter] = useState(false), [inner, setInner] = useState(false)
      return h('div', {}, h('button', { onClick: () => setOuter(true) }, '열기'),
        h(AnimatedModal, { open: outer, onClose: () => setOuter(false), variant: 'sheet', children: h('div', {},
          h('button', { onClick: () => setInner(true) }, '중첩 열기'),
          h(AnimatedModal, { open: inner, onClose: () => setInner(false), children: h('button', { onClick: () => setInner(false) }, '중첩 닫기') })) }))
    }
    await act(async () => root.render(h(Stack)))
    button('열기').focus(); await click(button('열기'))
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    await click(document.querySelector('[aria-label="풀스크린으로 펼치기"]')!)
    expect(document.querySelector('[aria-label="시트 축소"]')).not.toBeNull()
    button('중첩 열기').focus(); await click(button('중첩 열기'))
    expect(document.body.style.overflow).toBe('hidden')
    await click(button('중첩 닫기'))
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.activeElement).toBe(button('중첩 열기'))
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(button('열기'))
  })
})

describe('당겨서 새로고침 요구 동작 (DOM 합성 터치, 실기기 관성은 별도)', () => {
  // 2026-09-26 C07: 거리는 React 상태가 아니라 rAF 안의 onPull(거리)로 나온다. 값·흐름 단언은 예전 그대로.
  it('감쇠·임계·상한·취소·실패·재진입·요청 횟수를 보존한다', async () => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    let release: (() => void) | undefined
    const refresh = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    let result: ReturnType<typeof usePullToRefresh>
    let distance = 0
    const onPull = (d: number) => { distance = d }
    function Pull() {
      const value = usePullToRefresh({ onRefresh: refresh, onPull })
      useEffect(() => { result = value })
      return h('div', { ref: value.containerRef })
    }
    await act(async () => root.render(h(Pull)))
    const flushFrames = () => { while (frames.length) frames.shift()!(0) }
    const touch = async (type: string, y = 0) => {
      const event = new Event(type); Object.defineProperty(event, 'touches', { value: [{ clientY: y }] })
      await act(async () => host.firstElementChild!.dispatchEvent(event))
      flushFrames()
    }
    await touch('touchstart', 100); await touch('touchmove', 200)
    expect(distance).toBe(40); expect(result!.isPulling).toBe(true); expect(result!.willTrigger).toBe(false)
    await touch('touchend'); expect(refresh).not.toHaveBeenCalled(); expect(distance).toBe(0); expect(result!.isPulling).toBe(false)
    await touch('touchstart', 100); await touch('touchmove', 500)
    expect(distance).toBe(120); expect(result!.willTrigger).toBe(true)
    await touch('touchcancel'); expect(distance).toBe(0); expect(result!.willTrigger).toBe(false)
    await touch('touchstart', 100); await touch('touchmove', 250); await touch('touchend')
    expect(refresh).toHaveBeenCalledTimes(1); expect(distance).toBe(40); expect(result!.isRefreshing).toBe(true)
    await touch('touchstart', 100); await touch('touchmove', 400); await touch('touchend')
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => { release!(); await vi.advanceTimersByTimeAsync(500) })
    flushFrames()
    expect(result!.isRefreshing).toBe(false); expect(distance).toBe(0)
    refresh.mockRejectedValueOnce(new Error('합성 실패'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await touch('touchstart', 100); await touch('touchmove', 251); await touch('touchend')
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    flushFrames()
    expect(log).toHaveBeenCalledTimes(1); expect(refresh).toHaveBeenCalledTimes(2)
    expect(result!.isRefreshing).toBe(false); expect(distance).toBe(0)
  })

  it('touchmove 마다 다시 그리지 않는다 — 커밋은 경계(당김 시작·임계 넘김)에서만, 표시는 프레임당 1회', async () => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    let renders = 0
    const pulls: number[] = []
    function Pull() {
      renders++
      const value = usePullToRefresh({ onRefresh: async () => {}, onPull: d => { pulls.push(d) } })
      return h('div', { ref: value.containerRef })
    }
    await act(async () => root.render(h(Pull)))
    const base = renders
    const fire = async (type: string, y: number) => {
      const event = new Event(type); Object.defineProperty(event, 'touches', { value: [{ clientY: y }] })
      await act(async () => host.firstElementChild!.dispatchEvent(event))
    }
    await fire('touchstart', 100)
    for (let y = 101; y <= 160; y++) await fire('touchmove', y) // 60번 이동, 임계(60px = 150px 이동) 미만
    expect(renders - base).toBe(1) // 당김 시작 한 번
    expect(frames.length).toBe(1) // 한 프레임에 한 번만 표시 요청
    frames.shift()!(0)
    expect(pulls).toEqual([24]) // 최신 거리만: (160-100)*0.4
    for (let y = 161; y <= 260; y++) await fire('touchmove', y) // 임계 넘김
    expect(renders - base).toBe(2) // + 임계 넘김 한 번
    await fire('touchcancel', 0)
  })
})
