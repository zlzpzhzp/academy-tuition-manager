// @vitest-environment jsdom
// 2026-09-27 동작품질 배치2 #2 — 납부 화면이 로딩 중에 스스로 재렌더 루프를 돌지 않는지.
// 검수자 실측(배포본): 로딩 500ms 동안 커밋 59회 + React 'Maximum update depth' 경고.
// 원인: SWR 결과를 `data: x = []` 로 구조분해하면 로딩 중엔 렌더마다 새 [] → 파생 memo(Map·Set)가 매번 새로
// 생기고 → 기본 펼침 effect 가 매 커밋 새 Set 으로 setState → 다시 렌더.
import { act, createElement as h, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixtures from '../../tests/e2e/paper-fixtures.cjs'

const cache = new Map<string, unknown>()
/** 로딩 중으로 둘 SWR 키의 접두어. 비어 있으면 전부 도착. */
let loadingPrefixes: string[] = []
let commits = 0
/** 무한 루프 차단기 — 커밋이 이 수를 넘으면 로딩을 끝내 테스트가 멈추지 않게 한다(넘었다는 것 자체가 실패). */
const BREAKER = 150
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }), usePathname: () => '/payments', useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('swr', () => ({ mutate: vi.fn(), default: (key: string | null) => {
  if (!key) return { data: undefined, isLoading: false, mutate: vi.fn() }
  if (commits < BREAKER && loadingPrefixes.some(p => key.startsWith(p))) return { data: undefined, isLoading: true, mutate: vi.fn() }
  if (!cache.has(key)) cache.set(key, fixtures.fixture(`http://fixture${key}`))
  return { data: cache.get(key), isLoading: false, mutate: vi.fn() }
} }))
import PaymentsPage from '@/app/payments/page'

let host: HTMLDivElement, root: Root
let errors: string[]
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-13T04:00:00Z'))
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.stubGlobal('scrollTo', vi.fn())
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(fixtures.fixture(`http://fixture${url}`)), { status: 200 })))
  errors = []
  const original = console.error
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(' ')); void original })
  cache.clear(); commits = 0
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

const onRender = () => { commits++ }
async function mount() {
  await act(async () => root.render(h(Profiler, { id: 'payments', onRender }, h(PaymentsPage))))
}
const depthWarnings = () => errors.filter(e => e.includes('Maximum update depth'))

describe('납부 화면 로딩 중 커밋 수 상한 (#2)', () => {
  // 반 명단(grades)은 먼저 오고 나머지가 늦게 오는 실제 순서 — 기본 펼침 effect 가 반 id 를 가진 채 로딩이 이어지는 구간.
  it.each([
    ['납부·청구·스냅샷·퇴원·큐 전부 로딩', ['/api/payments', '/api/billing', '/api/fee-snapshots', '/api/withdrawal-status']],
    ['이번 달 납부만 로딩', ['/api/payments?billing_month=2026-09']],
    ['청구서만 로딩', ['/api/billing?month=2026-09', '/api/billing/queue']],
  ])('%s: 루프 없이 몇 번의 커밋으로 끝난다', async (_label, prefixes) => {
    loadingPrefixes = prefixes
    await mount()
    const loadingCommits = commits; console.info(`loading commits ${_label}: ${commits} depthWarnings=${depthWarnings().length}`)
    expect(depthWarnings()).toEqual([])
    // 첫 커밋 + (드물게) 렌더 중 상태 조정 한두 번. 루프면 차단기(150)까지 간다.
    expect(loadingCommits).toBeLessThanOrEqual(4)
    // 로딩 중 재렌더(부모 리렌더·폴링 틱과 같은 외부 재렌더)가 들어와도 스스로 커밋을 더 만들지 않는다.
    const before = commits
    await mount()
    expect(commits - before).toBeLessThanOrEqual(1)
    expect(depthWarnings()).toEqual([])
  })

  it('데이터가 다 오면 명단이 뜨고, 도착 후에도 커밋이 안정된다', async () => {
    loadingPrefixes = ['/api/payments', '/api/billing']
    await mount()
    loadingPrefixes = []
    await mount()
    const settled = commits
    expect(host.textContent).toContain('합성학생01')
    await mount()
    expect(commits - settled).toBeLessThanOrEqual(1)
    expect(depthWarnings()).toEqual([])
  })

  it('기본 펼침 동작은 그대로 — 데이터가 바뀌면(완납 반) 다시 접힌다', async () => {
    loadingPrefixes = []
    await mount()
    const section = () => host.querySelector('[data-student-row="paper-1"]')
    expect(section()).not.toBeNull() // 미납 학생이 있는 반은 펼쳐져 있다
  })
})
