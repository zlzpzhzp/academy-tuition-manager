// @vitest-environment jsdom
// 2026-09-27 동작품질 배치2 #3(대시보드 로드 직후 스크롤 끊김)·#4(학생 상세 시트가 올라오는 도중 높이 변화) 회귀 시험.
import { readFileSync } from 'node:fs'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixtures from '../../tests/e2e/paper-fixtures.cjs'

const cache = new Map<string, unknown>()
let pendingPrefixes: string[] = []
const dueDayCalls = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }), usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('swr', () => ({ mutate: vi.fn(), default: (key: string | null) => {
  if (!key) return { data: undefined, isLoading: false, mutate: vi.fn() }
  if (pendingPrefixes.some(p => key.startsWith(p))) return { data: undefined, isLoading: true, mutate: vi.fn() }
  if (!cache.has(key)) cache.set(key, fixtures.fixture(`http://fixture${key}`))
  return { data: cache.get(key), isLoading: false, mutate: vi.fn() }
} }))
vi.mock('@/lib/utils', async original => {
  const mod = await original<typeof import('@/lib/utils')>()
  return { ...mod, getPaymentDueDay: (...args: Parameters<typeof mod.getPaymentDueDay>) => { dueDayCalls(); return mod.getPaymentDueDay(...args) } }
})
import DashboardPage from '@/app/dashboard/page'
import StudentDetailModal from '@/components/StudentDetailModal'

let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-13T04:00:00Z'))
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(fixtures.fixture(`http://fixture${url}`)), { status: 200 })))
  cache.clear(); pendingPrefixes = []; dueDayCalls.mockClear(); localStorage.setItem('tuition_dashboard_onboarded_v1', '1')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

describe('#3 대시보드 — 늦게 오는 데이터가 목록 구획을 다시 그리지 않는다', () => {
  it.each([
    ['선생님 목록', '/api/teachers'],
    ['경고 수', '/api/audit-logs'],
    ['지난달 납부', '/api/payments?billing_month=2026-08'],
  ])('%s 도착: 미납·예정 행은 다시 렌더되지 않는다', async (_label, prefix) => {
    pendingPrefixes = [prefix]
    await act(async () => root.render(h(DashboardPage)))
    expect(host.textContent).toContain('미납')
    const firstPass = dueDayCalls.mock.calls.length
    expect(firstPass).toBeGreaterThanOrEqual(10) // 합성 데이터: 미납 9 + 예정 1 + 신규 1 행이 결제일을 읽는다
    pendingPrefixes = []
    dueDayCalls.mockClear()
    await act(async () => root.render(h(DashboardPage)))
    // 페이지 본체에 남은 건 '신규' 1행뿐 — memo 구획(미납·예정)은 입력이 그대로라 건너뛴다
    expect(dueDayCalls.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('선생님 목록이 오면 선생님별 매출은 그려진다(memo 가 갱신을 막지 않음)', async () => {
    pendingPrefixes = ['/api/teachers']
    await act(async () => root.render(h(DashboardPage)))
    expect(host.textContent).not.toContain('선생님별 매출')
    pendingPrefixes = []
    await act(async () => root.render(h(DashboardPage)))
    expect(host.textContent).toContain('선생님별 매출')
    expect(host.textContent).toContain('검수강사')
  })

  it('반별 인원 막대는 width 가 아니라 transform 으로 채운다(레이아웃 없는 애니메이션)', async () => {
    await act(async () => root.render(h(DashboardPage)))
    const heading = Array.from(host.querySelectorAll('h2')).find(el => el.textContent === '반별 인원')!
    const bars = heading.parentElement!.querySelectorAll<HTMLElement>('.rounded-xl.overflow-hidden > div')
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) {
      expect(bar.style.width).toBe('')
      expect(bar.className).toContain('w-full')
    }
    const src = readFileSync('src/app/dashboard/page.tsx', 'utf8')
    expect(src).not.toMatch(/animate=\{\{ width:/)
  })
})

describe('#4 학생 상세 시트 — 로딩 자리가 최종 구획과 같은 높이를 잡는다', () => {
  it('데이터가 오기 전: 최종 화면의 다섯 구획 + 휴대폰에서 시트 상한 높이 확보', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {}))) // 응답 대기 상태 유지
    await act(async () => root.render(h(StudentDetailModal, { studentId: 'paper-1', onClose: () => {} })))
    const skeleton = document.querySelector<HTMLElement>('[data-student-detail-skeleton]')!
    expect(skeleton).toBeTruthy()
    expect(skeleton.className).toContain('max-sm:min-h-[88vh]')
    expect(Array.from(skeleton.querySelectorAll('[data-skeleton-block]')).map(el => el.getAttribute('data-skeleton-block')))
      .toEqual(['info', '360', 'month', 'refund', 'history'])
  })

  it('데이터가 오면 같은 순서의 실제 구획으로 바뀐다(조회·저장 경로는 그대로)', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(`${init?.method ?? 'GET'} ${url}`)
      return new Response(JSON.stringify(fixtures.fixture(`http://fixture${url}`)), { status: 200 })
    }))
    await act(async () => root.render(h(StudentDetailModal, { studentId: 'paper-1', onClose: () => {} })))
    expect(document.querySelector('[data-student-detail-skeleton]')).toBeNull()
    expect(document.body.textContent).toContain('이번달 납부현황')
    expect(document.body.textContent).toContain('납부 내역')
    expect(urls.every(u => u.startsWith('GET '))).toBe(true)
  })
})
