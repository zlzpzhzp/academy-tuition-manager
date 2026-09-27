// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PaymentsHeader from '@/components/payments/PaymentsHeader'

vi.mock('@/components/motion', () => ({ TButton: 'button' }))
let host: HTMLDivElement, root: Root
let frames: Map<number, FrameRequestCallback>, sequence: number
let reduced: boolean
let supported: Set<string>
let mediaListener: (() => void) | undefined
let measure = vi.fn(() => 82)
let resize: (() => void) | undefined
const props = { month: '2026-10', navigateMonth: vi.fn(), memo: '합성 메모', memoStatus: 'loaded' as const, onMemoChange: vi.fn(), loading: false, filters: h('button', null, '필터'), progress: null, pullIndicator: null }
const frame = async () => { await act(async () => {
  const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0))
}) }
const y = (value: number) => { Object.defineProperty(window, 'scrollY', { value, configurable: true }) }
const progress = () => Number(host.querySelector<HTMLElement>('[data-payments-header]')!.style.getPropertyValue('--payments-scroll-progress'))
const header = () => host.querySelector<HTMLElement>('[data-payments-header]')!
// 독립 기대 표: 위치를 시간으로 추종하거나 직선/96으로 되돌리면 실패한다.
const samples = [[0, 0], [15, .04296875], [30, .15625], [45, .31640625], [60, .5], [75, .68359375], [90, .84375], [105, .95703125], [120, 1], [150, 1]]
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  reduced = false; frames = new Map(); sequence = 0; mediaListener = undefined; y(0)
  supported = new Set()
  vi.stubGlobal('CSS', { supports: (property: string) => supported.has(property) })
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced }, addEventListener: (_: string, fn: () => void) => { mediaListener = fn }, removeEventListener: () => { mediaListener = undefined } }))
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect() {} })
  measure = vi.fn(() => 82)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(measure)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('월 제목 rAF 수명·진행률 계약 (픽셀 검수는 브라우저 러너)', () => {
  it('0~120/150/음수 같은 왕복 곡선, 정지 후 추가 갱신·측정 없음', async () => {
    await act(async () => root.render(h(PaymentsHeader, props))); await frame()
    const reads = measure.mock.calls.length
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    for (const [value, expected] of [...samples, ...samples.toReversed(), [-10, 0]]) {
      y(value); window.dispatchEvent(new Event('scroll')); await frame()
      expect(progress()).toBe(expected)
      expect(frames.size).toBe(0)
    }
    expect(measure).toHaveBeenCalledTimes(reads)
    expect(geometry).not.toHaveBeenCalled()
    expect(host.querySelector('h1')!.textContent).toBe('2026년 10월')
    expect(document.documentElement.style.getPropertyValue('--payments-scroll-progress')).toBe('')
  })
  it('복원 마운트와 pageshow는 현재 위치, 연속 입력은 콜백 하나, 해제 후 예약/리스너 0', async () => {
    y(60); await act(async () => root.render(h(PaymentsHeader, props)))
    expect(progress()).toBe(.5) // 첫 프레임 전에도 복원 위치 적용
    expect(frames.size).toBe(1); await frame(); expect(progress()).toBe(.5)
    y(30); window.dispatchEvent(new Event('pageshow'))
    for (let i = 0; i < 20; i++) window.dispatchEvent(new Event('scroll'))
    expect(frames.size).toBe(1); await frame(); expect(progress()).toBe(.15625)
    window.dispatchEvent(new Event('scroll')); expect(frames.size).toBe(1)
    await act(async () => root.render(null))
    expect(frames.size).toBe(0); expect(mediaListener).toBeUndefined()
    window.dispatchEvent(new Event('pageshow')); window.dispatchEvent(new Event('scroll'))
    expect(frames.size).toBe(0)
  })
  it('reduced-motion은 첫 프레임 전 고정 모드를 선택, 설정 변경 시 실제 위치 반영', async () => {
    reduced = true; await act(async () => root.render(h(PaymentsHeader, props)))
    for (const value of [0, 60, 150, 0]) {
      y(value); window.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('pageshow'))
      expect(header().dataset.paymentsMotion).toBe('reduced')
      expect(frames.size).toBe(0)
      expect(header().style.getPropertyValue('--payments-scroll-progress')).toBe('')
    }
    reduced = false; y(60); mediaListener!(); expect(progress()).toBe(.5)
    expect(frames.size).toBe(1)
    reduced = true; mediaListener!()
    expect(frames.size).toBe(0) // 이미 예약한 폴백이 작은 크기를 덮어쓰지 않는다.
    expect(header().dataset.paymentsMotion).toBe('reduced')
  })
  it('설정 조회 미지원도 처음부터 작은 크기 정책·예약 0', async () => {
    vi.stubGlobal('matchMedia', undefined)
    await act(async () => root.render(h(PaymentsHeader, props)))
    expect(header().dataset.paymentsMotion).toBe('reduced')
    expect(frames.size).toBe(0)
  })
  for (const missing of ['animation-timeline', 'animation-range', 'animation-duration', null]) {
    it(`문법 탐지 ${missing ?? '모두 지원'}: 한 구동 경로만 소유`, async () => {
      supported = new Set(['animation-timeline', 'animation-range', 'animation-duration'].filter(p => p !== missing))
      y(90); await act(async () => root.render(h(PaymentsHeader, props)))
      expect(header().dataset.paymentsMotion).toBe(missing ? 'fallback' : 'css')
      await frame()
      const writes = vi.spyOn(header().style, 'setProperty')
      for (const value of [0, 60, 120]) {
        y(value); window.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('pageshow'))
        expect(frames.size).toBe(missing ? 1 : 0); await frame()
      }
      expect(writes).toHaveBeenCalledTimes(missing ? 3 : 0)
      reduced = true; mediaListener!()
      expect(header().dataset.paymentsMotion).toBe('reduced')
      expect(frames.size).toBe(0)
      reduced = false; y(30); mediaListener!()
      expect(header().dataset.paymentsMotion).toBe(missing ? 'fallback' : 'css')
      if (missing) expect(progress()).toBe(.15625)
      else expect(header().style.getPropertyValue('--payments-scroll-progress')).toBe('')
    })
  }
  it('작은 왕복·임의 정지에 불연속/시간 추종 없고 월 변경도 같은 위치를 유지', async () => {
    await act(async () => root.render(h(PaymentsHeader, props))); await frame()
    let last = 0
    for (let value = 0; value <= 120; value++) {
      y(value); window.dispatchEvent(new Event('scroll')); await frame()
      expect(progress()).toBeGreaterThanOrEqual(last)
      expect(progress() - last).toBeLessThanOrEqual(.0125)
      last = progress()
    }
    for (const value of [37.3, 60.1, 59.9, 60.1, 37.3]) {
      y(value); window.dispatchEvent(new Event('scroll')); await frame()
      const stopped = progress()
      await act(async () => root.render(h(PaymentsHeader, { ...props, month: '2026-11' })))
      await frame(); expect(progress()).toBe(stopped); expect(frames.size).toBe(0)
    }
  })
  it('메모 내용/크기 변경은 82~400 자연 높이를 유지하며 textarea를 교체하지 않는다', async () => {
    await act(async () => root.render(h(PaymentsHeader, props)))
    const textarea = host.querySelector('textarea')!
    for (const [natural, expected] of [[10, 82], [180, 180], [800, 400]]) {
      measure.mockReturnValue(natural)
      await act(async () => resize!())
      expect(textarea.parentElement!.style.height).toBe(`${expected}px`)
      expect(host.querySelector('textarea')).toBe(textarea)
    }
  })
  it('조회 실패도 발송 없이 sticky에 안내하고 기존 textarea에 접근할 수 있다', async () => {
    await act(async () => root.render(h(PaymentsHeader, { ...props, memoStatus: 'failed' })))
    const textarea = host.querySelector('textarea')!
    textarea.scrollIntoView = vi.fn()
    const status = host.querySelector('[data-payments-sticky-status]')!
    // 돌아오는 동안 네비가 52→84로 커질 수 있다. 전체 예약 높이 아래에 여백을 둔다.
    const header = host.querySelector<HTMLElement>('[data-payments-header]')!
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ bottom: 220 } as DOMRect)
    expect(status.textContent).toContain('메모 로드 실패')
    expect(textarea.readOnly).toBe(true)
    textarea.setSelectionRange(1, 3); textarea.scrollTop = 20
    await act(async () => status.querySelector('button')!.click())
    expect(document.activeElement).toBe(textarea)
    expect([textarea.selectionStart, textarea.selectionEnd, textarea.scrollTop]).toEqual([1, 3, 20])
    expect(textarea.style.scrollMarginTop).toBe('228px')
    expect(status.textContent).toContain('메모 로드 실패')
  })
})
