// @vitest-environment jsdom
// 2026-09-27 동작품질 배치2 #1 — 납부 명단 청구·결제 아이콘의 터치 영역 확장(hit-slop).
// jsdom 은 레이아웃이 없어 실제 박스를 잴 수 없다 → ① 행의 Tailwind 클래스에서 나온 기하로 '확장 영역끼리 안 겹침'을
// 계산으로 검사하고 ② 그 클래스가 page.tsx 에 그대로 있는지 대조하고 ③ 실제 렌더된 버튼이 올바른 확장 값을 달고 있는지 본다.
import { readFileSync } from 'node:fs'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixtures from '../../tests/e2e/paper-fixtures.cjs'
import {
  PAY_FAN, PAY_ROW, PAY_SPLIT_GAP, hitSize, type HitSlop,
  SLOP_FAN_LAST, SLOP_FAN_MIDDLE, SLOP_FAN_PILL, SLOP_ROW_SPLIT_FIRST, SLOP_ROW_SPLIT_LAST, SLOP_ROW_TRAILING,
} from '@/lib/hitSlop'

type Box = { x0: number; x1: number; y0: number; y1: number }
const extend = (b: Box, s: HitSlop): Box => ({ x0: b.x0 - s.l, x1: b.x1 + s.r, y0: b.y0 - s.t, y1: b.y1 + s.b })
const overlapX = (a: Box, b: Box) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)

describe('기하 — 확장 영역은 이웃과 겹치지 않고 행 밖으로 안 나간다', () => {
  // 오른쪽 정렬 줄: 행 오른쪽 끝(x=W) ← padX ← 아이콘들 ← gap ← 상태 배지(이웃, 확장 없음)
  const W = 390
  const rowH = PAY_ROW.padY * 2 + PAY_ROW.icon // 이름 줄 높이(콘텐츠 = 아이콘 22px)

  it('단일 아이콘(청구·결제수단·퇴원 상태·분할): 왼쪽 배지와 간격 반, 오른쪽은 행 끝, 위아래는 줄 끝', () => {
    const icon: Box = { x0: W - PAY_ROW.padX - PAY_ROW.icon, x1: W - PAY_ROW.padX, y0: PAY_ROW.padY, y1: PAY_ROW.padY + PAY_ROW.icon }
    const badge: Box = { x0: icon.x0 - PAY_ROW.gap - 50, x1: icon.x0 - PAY_ROW.gap, y0: 7, y1: 27 }
    const hit = extend(icon, SLOP_ROW_TRAILING)
    expect(overlapX(hit, badge)).toBeLessThan(0) // 배지 쪽으로 간격의 절반만 → 4px 남는다
    expect(badge.x1 + PAY_ROW.gap / 2).toBe(hit.x0)
    expect(hit.x1).toBe(W)
    expect([hit.y0, hit.y1]).toEqual([0, rowH]) // 윗줄·아랫줄(펼친 납부 폼)로 넘치지 않음
  })

  it('분할 두 아이콘: 서로의 확장이 맞닿기만 하고 겹치지 않는다', () => {
    const last: Box = { x0: W - PAY_ROW.padX - PAY_ROW.icon, x1: W - PAY_ROW.padX, y0: 6, y1: 28 }
    const first: Box = { x0: last.x0 - PAY_SPLIT_GAP - PAY_ROW.icon, x1: last.x0 - PAY_SPLIT_GAP, y0: 6, y1: 28 }
    const a = extend(first, SLOP_ROW_SPLIT_FIRST), b = extend(last, SLOP_ROW_SPLIT_LAST)
    expect(overlapX(a, b)).toBe(0)
    expect(b.x1).toBe(W)
  })

  it('납부 폼(팬): 납부 알약·청구서 발송·상세 기록이 서로·비고칸과 안 겹치고, 위로 이름 줄을 침범하지 않는다', () => {
    const y = (hgt: number) => ({ y0: (PAY_FAN.content - hgt) / 2, y1: (PAY_FAN.content + hgt) / 2 })
    const last: Box = { x0: W - PAY_FAN.padX - PAY_FAN.icon, x1: W - PAY_FAN.padX, ...y(PAY_FAN.icon) }
    const mid: Box = { x0: last.x0 - PAY_FAN.gap - PAY_FAN.icon, x1: last.x0 - PAY_FAN.gap, ...y(PAY_FAN.icon) }
    const pill: Box = { x0: mid.x0 - PAY_FAN.gap - 44, x1: mid.x0 - PAY_FAN.gap, ...y(PAY_FAN.pill) }
    const input: Box = { x0: 100, x1: pill.x0 - PAY_FAN.gap, y0: 0, y1: PAY_FAN.content }
    const [hp, hm, hl] = [extend(pill, SLOP_FAN_PILL), extend(mid, SLOP_FAN_MIDDLE), extend(last, SLOP_FAN_LAST)]
    expect(overlapX(input, hp)).toBe(-PAY_FAN.gap / 2) // 비고칸은 확장 없음 — 간격의 절반은 비워 둔다(겹침 0)
    expect(overlapX(hp, hm)).toBe(0)
    expect(overlapX(hm, hl)).toBe(0)
    expect(hl.x1).toBe(W)
    for (const b of [hp, hm, hl]) {
      expect(b.y0).toBe(0) // 팬 윗변 = 이름 줄 아랫변
      expect(b.y1).toBe(PAY_FAN.content + PAY_FAN.padBottom) // 팬 아랫변(= 행 아랫변)
    }
  })

  it('실제로 눌리는 크기 표(보고용) — 22px 아이콘 기준', () => {
    const v = { w: 22, h: 22 }
    expect(hitSize(v, SLOP_ROW_TRAILING)).toEqual({ w: 42, h: 22 }) // 2026-09-27 줄 세로 여백 0
    expect(hitSize(v, SLOP_ROW_SPLIT_FIRST)).toEqual({ w: 28, h: 22 })
    expect(hitSize(v, SLOP_ROW_SPLIT_LAST)).toEqual({ w: 40, h: 22 })
    expect(hitSize(v, SLOP_FAN_MIDDLE)).toEqual({ w: 28, h: 34 })
    expect(hitSize(v, SLOP_FAN_LAST)).toEqual({ w: 41, h: 34 })
    expect(hitSize({ w: 44, h: 24 }, SLOP_FAN_PILL)).toEqual({ w: 50, h: 34 })
  })

  it('기하의 근거인 행 클래스가 page.tsx 에 그대로 있다(바뀌면 hitSlop.ts 를 같이 고쳐라)', () => {
    const src = readFileSync('src/app/payments/page.tsx', 'utf8')
    expect(src).toContain("className={`flex items-center gap-2 px-4 py-0 ${")
    expect(src).toContain('<div className="flex items-center gap-1 shrink-0">')
    expect(src).toContain('className="flex items-center gap-1.5 px-4 pb-2 ')
    expect(src).toContain("fan-item px-2 py-1 rounded-full text-xs") // 결제일 알약 = 24px
    expect(src).toContain('w-full py-1 rounded-lg text-xs border') // 비고칸 = 26px(줄 높이)
  })
})

// ─── 렌더된 버튼 ──────────────────────────────────────────────
const cache = new Map<string, unknown>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }), usePathname: () => '/payments', useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('swr', () => ({ mutate: vi.fn(), default: (key: string | null) => {
  if (!key) return { data: undefined, isLoading: false, mutate: vi.fn() }
  if (!cache.has(key)) cache.set(key, fixtures.fixture(`http://fixture${key}`))
  return { data: cache.get(key), isLoading: false, mutate: vi.fn() }
} }))
import PaymentsPage from '@/app/payments/page'

let host: HTMLDivElement, root: Root
let mutations: string[]
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-13T04:00:00Z'))
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.stubGlobal('scrollTo', vi.fn()); vi.stubGlobal('scrollBy', vi.fn())
  HTMLElement.prototype.scrollIntoView = vi.fn()
  mutations = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') mutations.push(`${init.method} ${url}`)
    return new Response(JSON.stringify(fixtures.fixture(`http://fixture${url}`)), { status: 200 })
  }))
  cache.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const vars = (el: HTMLElement) => ['t', 'r', 'b', 'l'].map(k => el.style.getPropertyValue(`--hit-${k}`))
const rowButton = (id: string) => host.querySelector<HTMLElement>(`[data-student-row="${id}"] [data-swipe-row] > div > button:last-child`)!

describe('렌더된 명단 아이콘이 확장 영역·누름 반응을 단다', () => {
  it('청구 아이콘(미발송/발송됨)과 결제수단 아이콘: hit-slop + 행 끝 기하 + 모션 버튼(누름 반응)', async () => {
    await act(async () => root.render(h(PaymentsPage)))
    const labels: string[] = []
    for (const id of ['paper-1', 'paper-3', 'paper-4', 'paper-6']) {
      const b = rowButton(id)
      expect(b, id).toBeTruthy()
      labels.push(b.getAttribute('aria-label') ?? '')
      expect(b.classList.contains('hit-slop')).toBe(true)
      expect(vars(b)).toEqual(['0px', '16px', '0px', '4px'])
      expect(b.hasAttribute('data-paper-motion')).toBe(true) // paperMotion 버튼 = whileTap 누름(동작 줄이기면 꺼짐)
      expect(b.className).not.toContain('active:scale') // 누름은 한 가지 방식으로만
    }
    expect(labels).toEqual(['현금결제 — 탭하여 편집', '발송됨 — 탭하여 파기', '발송됨 — 탭하여 파기', '카톡 청구서 발송'])
    expect(mutations).toEqual([])
  })

  it('행을 펼친 납부 폼: 납부·청구서 발송·상세 납부 기록이 이웃과 간격을 나눈 확장을 단다', async () => {
    await act(async () => root.render(h(PaymentsPage)))
    const line = host.querySelector<HTMLElement>('[data-student-row="paper-6"] [data-swipe-row] > div')!
    await act(async () => line.click())
    const fan = (label: string) => host.querySelector<HTMLElement>(`[data-student-row="paper-6"] [aria-label="${label}"]`)!
    expect(vars(fan('납부 처리'))).toEqual(['1px', '3px', '9px', '3px'])
    expect(vars(fan('청구서 발송'))).toEqual(['2px', '3px', '10px', '3px'])
    expect(vars(fan('상세 납부 기록'))).toEqual(['2px', '16px', '10px', '3px'])
    for (const l of ['납부 처리', '청구서 발송', '상세 납부 기록']) expect(fan(l).classList.contains('hit-slop')).toBe(true)
    expect(mutations).toEqual([]) // 펼치기만 — 발송·납부 없음
  })

  it('납부 폼 등장 애니메이션은 끝난 뒤 transform 을 붙잡지 않는다(누름 배율이 보이게)', () => {
    const css = readFileSync('src/app/globals.css', 'utf8')
    expect(css).toContain('.fan-item { animation: fanOut 0.3s ease-out backwards; }')
    expect(css).toMatch(/\.hit-slop::before \{[^}]*position: absolute;[^}]*var\(--hit-t, 0px\)/)
  })
})
