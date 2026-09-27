// @vitest-environment jsdom
// 2026-09-26 동작품질 배치1 (C03·C04·C05) 회귀 시험 — 렌더링 전용 변경의 구조 보장.
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { motion, usePaperReducedMotion } from '@/components/paperMotion'
import AiFilterButton from '@/components/payments/AiFilterButton'
import { applyDefaultExpansion } from '@/lib/defaultExpansion'

let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('C03 동작 줄이기 공유 저장소', () => {
  it('요소가 많아도 matchMedia 는 한 번, change 리스너도 하나만 단다', async () => {
    const reduced = false
    const listeners = new Set<() => void>()
    const matchMedia = vi.fn(() => ({
      get matches() { return reduced },
      addEventListener: vi.fn((_: string, fn: () => void) => { listeners.add(fn) }),
      removeEventListener: vi.fn((_: string, fn: () => void) => { listeners.delete(fn) }),
    }))
    vi.stubGlobal('matchMedia', matchMedia)
    const items = Array.from({ length: 200 }, (_, i) => h(motion.span, { key: i, animate: { opacity: 1 } }, String(i)))
    await act(async () => root.render(h('div', null, items)))
    await act(async () => root.render(h('div', null, items))) // 재렌더에도 새로 만들지 않는다
    expect(matchMedia).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(1)
    await act(async () => root.unmount())
    expect(listeners.size).toBe(0) // 마지막 구독이 풀리면 리스너도 뗀다
    root = createRoot(host)
  })

  it('설정 변경은 하나의 리스너로 모든 구독자에게 퍼진다', async () => {
    let reduced = false
    const listeners = new Set<() => void>()
    vi.stubGlobal('matchMedia', () => ({
      get matches() { return reduced },
      addEventListener(_: string, fn: () => void) { listeners.add(fn) },
      removeEventListener(_: string, fn: () => void) { listeners.delete(fn) },
    }))
    const seen: boolean[][] = []
    function Probe({ i }: { i: number }) {
      const r = usePaperReducedMotion()
      ;(seen[i] ??= []).push(r)
      return null
    }
    await act(async () => root.render(h('div', null, h(Probe, { i: 0 }), h(Probe, { i: 1 }), h(Probe, { i: 2 }))))
    expect(seen.map(s => s.at(-1))).toEqual([false, false, false])
    await act(async () => { reduced = true; listeners.forEach(fn => fn()) })
    expect(seen.map(s => s.at(-1))).toEqual([true, true, true])
    expect(listeners.size).toBe(1)
  })

  it('matchMedia 가 없으면 동작 줄이기(true)로 본다 — 예전 폴백과 같다', async () => {
    vi.stubGlobal('matchMedia', undefined)
    function Probe() { return h('span', null, String(usePaperReducedMotion())) }
    await act(async () => root.render(h(Probe)))
    expect(host.textContent).toBe('true')
  })
})

describe('C05 기본 펼침 규칙', () => {
  it('미납은 펼치고 전원납부는 접고, 목록 밖 키는 건드리지 않는다', () => {
    const prev = new Set(['a', 'x'])
    const next = applyDefaultExpansion(prev, [['a', true], ['b', false], ['c', true]])
    expect([...next].sort()).toEqual(['b', 'x'])
    expect(prev).toEqual(new Set(['a', 'x'])) // 입력은 바꾸지 않는다
  })
  it('바뀐 게 없으면 같은 참조를 돌려준다(불필요한 재렌더 방지)', () => {
    const prev = new Set(['b'])
    expect(applyDefaultExpansion(prev, [['b', false], ['c', true]])).toBe(prev)
  })
})

describe('C04 AI 필터 버튼', () => {
  const props = { aiFilterIds: null, aiFilterDesc: '', onFilter: async () => {}, onClear() {}, loading: false }
  function stubFrames() {
    const frames = new Map<number, FrameRequestCallback>()
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++id, cb); return id })
    vi.stubGlobal('cancelAnimationFrame', (key: number) => { frames.delete(key) })
    const run = (n: number) => { for (let i = 0; i < n; i++) { const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(i * 16)) } }
    return { frames, run }
  }

  it('입자 프레임은 React 커밋 없이 SVG 를 직접 갱신하고, 열리면 루프를 끊고 입자를 비운다', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    const { frames, run } = stubFrames()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    await act(async () => root.render(h(AiFilterButton, props)))
    const svg = document.querySelector('svg.fixed')!
    run(30) // act 밖에서 프레임을 돌린다 — React 상태를 건드리면 act 경고가 난다
    expect(svg.querySelectorAll('polygon').length).toBeGreaterThan(0)
    expect(frames.size).toBe(1) // 방출 중에는 다음 프레임 하나만 대기
    await act(async () => (document.querySelector('[aria-label="AI 필터 열기"]') as HTMLButtonElement).click())
    expect(frames.size).toBe(0) // 그릴 게 없으면 프레임을 요청하지 않는다
    expect(document.querySelectorAll('svg.fixed polygon')).toHaveLength(0)
  })

  it('입자는 최대 25개를 넘지 않는다(예전 slice(-25))', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    const { run } = stubFrames()
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // 6프레임마다 생성, 수명 95/0.6≈158프레임 → 26개가 살아 있을 흐름을 25개로 자른다
    await act(async () => root.render(h(AiFilterButton, props)))
    run(400)
    expect(document.querySelectorAll('svg.fixed polygon').length).toBe(25)
  })

  it('창 touchmove(비수동) 리스너는 드래그 동안만 붙는다', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const touchmoves = () => add.mock.calls.filter(([type]) => type === 'touchmove').length - remove.mock.calls.filter(([type]) => type === 'touchmove').length
    await act(async () => root.render(h(AiFilterButton, props)))
    expect(touchmoves()).toBe(0) // 대기 중엔 문서 스크롤이 비수동 리스너를 거치지 않는다
    const fairy = document.querySelector('.touch-none') as HTMLElement
    await act(async () => fairy.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 50, clientY: 50 })))
    expect(touchmoves()).toBe(1)
    const passiveOpt = add.mock.calls.find(([type]) => type === 'touchmove')?.[2]
    expect(passiveOpt).toEqual({ passive: false })
    await act(async () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 140 })))
    await act(async () => window.dispatchEvent(new MouseEvent('mouseup')))
    expect(touchmoves()).toBe(0)
    expect(fairy.style.left).toBe('96px') // 드래그 위치 반영(x-24)은 그대로
  })

  it('드래그 중 언마운트하면 창 리스너를 남기지 않는다', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    await act(async () => root.render(h(AiFilterButton, props)))
    const fairy = document.querySelector('.touch-none') as HTMLElement
    await act(async () => fairy.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 50, clientY: 50 })))
    await act(async () => root.unmount())
    root = createRoot(host)
    for (const type of ['mousemove', 'mouseup', 'touchmove', 'touchend', 'touchcancel']) {
      const added = add.mock.calls.filter(([t]) => t === type).length
      const removed = remove.mock.calls.filter(([t]) => t === type).length
      expect(added - removed, type).toBe(0)
    }
  })
})
