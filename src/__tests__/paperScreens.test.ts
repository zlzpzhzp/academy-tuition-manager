// @vitest-environment jsdom
import { act, createElement as h, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fixtures from '../../tests/e2e/paper-fixtures.cjs'

let route = '/dashboard'
let empty = false
const router = { push: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }
const cache = new Map<string, unknown>()
const mutations: { url: string; method: string; body: unknown }[] = []
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => route, useSearchParams: () => new URLSearchParams() }))
vi.mock('swr', () => ({ mutate: vi.fn(), default: (key: string | null) => {
  if (!key) return { data: undefined, isLoading: false, mutate: vi.fn() }
  if (!cache.has(key)) cache.set(key, fixtures.fixture(`http://fixture${key}`, empty))
  return { data: cache.get(key), isLoading: false, mutate: vi.fn() }
} }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-13T04:00:00Z'))
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.stubGlobal('scrollTo', vi.fn())
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') {
      mutations.push({ url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : null })
      return new Response(JSON.stringify({ success: true, id: 'synthetic-result' }), { status: 200 })
    }
    return new Response(JSON.stringify(fixtures.fixture(`http://fixture${url}`, empty)), { status: 200 })
  }))
  empty = false
  cache.clear(); mutations.length = 0; localStorage.clear(); router.push.mockClear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  const start = performance.now()
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals()
  console.info(`paperScreens cleanup: ${(performance.now() - start).toFixed(1)}ms`)
})
const modules = [
  ['/dashboard', () => import('@/app/dashboard/page'), '미납'],
  ['/payments', () => import('@/app/payments/page'), '합성학생01'],
  ['/special', () => import('@/app/special/page'), '특강'],
  ['/billing', () => import('@/app/billing/page'), '청구서 발송하기'],
  ['/settings', () => import('@/app/settings/page'), '설정'],
  ['/students', () => import('@/app/students/page'), '재원생 12명'],
  ['/attendance', () => import('@/app/attendance/page'), '합성학생01'],
  ['/notice', () => import('@/app/notice/page'), '공지'],
  ['/stats', () => import('@/app/stats/page'), '매출'],
  ['/login', () => import('@/app/login/page'), '로그인'],
  ['/finance', () => import('@/app/finance/page'), '수입'],
  ['/finance/auth', () => import('@/app/finance/auth/page'), 'PIN'],
  ['/agent', () => import('@/app/agent/page'), '원비관리'],
] as const

// 첫 화면의 cold import가 mount/act보다 지배적이다(주간 리뷰 계측).
// 준비 실패는 beforeAll 실패로 전체 시험에 남기며 재실행·sleep·timeout 상향은 하지 않는다.
beforeAll(async () => {
  for (const [path, load] of modules) {
    const start = performance.now()
    await load()
    console.info(`paperScreens prepare import ${path}: ${(performance.now() - start).toFixed(1)}ms`)
  }
})

async function mount(Component: React.ComponentType) {
  const start = performance.now()
  await act(async () => root.render(h(Component)))
  console.info(`paperScreens mount/act ${route}: ${(performance.now() - start).toFixed(1)}ms`)
}
const button = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!

describe('D3 적용 화면의 합성 데이터 DOM 회귀 (브라우저 배치 검수와 별개)', () => {
  for (const [path, load, text] of modules) it(`${path} 표시·데이터 진입`, async () => {
    route = path
    const importStart = performance.now()
    const C = (await load()).default
    console.info(`paperScreens import ${path}: ${(performance.now() - importStart).toFixed(1)}ms`)
    await mount(C)
    expect(host.textContent).toContain(text)
    expect(mutations).toEqual([])
  })
  it('/students/[id] 데이터·금액 표시', async () => {
    const C = (await import('@/app/students/[id]/page')).default
    await act(async () => root.render(h(Suspense, {}, h(C, { params: Promise.resolve({ id: 'paper-1' }) }))))
    expect(host.textContent).toContain('합성학생01')
    expect(host.textContent).toContain('300,000')
    expect(mutations).toEqual([])
  })
  it('/teachers/[id] 급여 데이터·금액 표시', async () => {
    const C = (await import('@/app/teachers/[id]/page')).default
    await act(async () => root.render(h(Suspense, {}, h(C, { params: Promise.resolve({ id: 'paper-teacher' }) }))))
    expect(host.textContent).toContain('검수강사')
    expect(host.textContent).toContain('338,450') // 700,000 × 50% × (1 - .033)
    expect(mutations).toEqual([])
  })
  it('명단 메모 표식만 제거하고 원문·이름 강조·스와이프 단일/일괄 저장을 보존', async () => {
    route = '/payments'
    const grades = structuredClone(fixtures.grades)
    grades[0].classes[0].students[3].memo = '9월 합성 학생 메모 원문'
    cache.set('/api/grades', grades)
    localStorage.setItem('memo-dismiss:legacy-synthetic', '1')
    const keyReads = vi.spyOn(Storage.prototype, 'key')
    const C = (await import('@/app/payments/page')).default
    await mount(C)
    expect(host.querySelector('[aria-label="메모 펼치기"],[aria-label="메모 닫기"]')).toBeNull()
    const name = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('합성학생04'))!
    expect(name.textContent).not.toContain('합성 학생 메모 원문')
    expect(name.querySelector('[class*="--orange-dim"]')).not.toBeNull()
    expect(keyReads).not.toHaveBeenCalled()
    expect(localStorage.getItem('memo-dismiss:legacy-synthetic')).toBe('1')
    async function swipe(id: string) {
      const row = host.querySelector<HTMLElement>(`[data-swipe-row="${id}"]`)!
      await act(async () => {
        for (const [type, dx] of [['pointerdown', 0], ['pointermove', 70], ['pointermove', 140], ['pointerup', 140]] as const) {
          const event = new MouseEvent(type, { bubbles: true, clientX: 100 + dx, clientY: 100 })
          Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 1 } })
          row.dispatchEvent(event)
        }
      })
    }
    await swipe('paper-4')
    expect([...host.querySelectorAll('textarea')].some(el => el.value === '9월 합성 학생 메모 원문')).toBe(true)
    const save = host.querySelector<HTMLElement>('[data-student-row="paper-4"] [aria-label="저장"]')!
    await act(async () => save.click())
    expect(mutations).toContainEqual({ url:'/api/students/paper-4', method:'PUT', body:{ memo:'9월 합성 학생 메모 원문', memo_color:'yellow' } })
    mutations.length = 0
    await swipe('paper-4'); await swipe('paper-5')
    const bulkSave = host.querySelector<HTMLButtonElement>('[aria-label="일괄 저장"]')
    expect(bulkSave).toBeTruthy()
    await act(async () => bulkSave!.click())
    expect(mutations.filter(m => m.method === 'PUT').map(m => m.url).sort()).toEqual(['/api/students/paper-4','/api/students/paper-5'])
    expect(grades[0].classes[0].students[3].memo).toBe('9월 합성 학생 메모 원문')
    keyReads.mockRestore()
  })
  it('납부 필터는 대상을 축소하며 API 쓰기를 발생시키지 않는다', async () => {
    const C = (await import('@/app/payments/page')).default
    await mount(C)
    const before = host.querySelectorAll('[data-student-row]').length
    await act(async () => button('전체').click())
    expect(host.querySelectorAll('[data-student-row]').length).toBeLessThan(before)
    expect(host.textContent).not.toContain('합성학생01')
    expect(mutations).toEqual([])
  })
  for (const [direction, x, expected] of [['오른쪽', 130, '160px'], ['왼쪽', -130, '-150px']] as const) {
    it(`납부 ${direction} 포인터 스와이프의 기존 패널·요청 계약`, async () => {
      const C = (await import('@/app/payments/page')).default
      await mount(C)
      const row = host.querySelector<HTMLElement>('[data-swipe-row="paper-6"]')!
      function pointer(type: string, dx: number, dy = 0) {
        const e = new MouseEvent(type, { bubbles: true, clientX: 200 + dx, clientY: 200 + dy })
        Object.defineProperties(e, { pointerType: { value: 'touch' }, pointerId: { value: 1 } })
        row.dispatchEvent(e)
      }
      await act(async () => { pointer('pointerdown', 0); pointer('pointermove', x / 2); pointer('pointermove', x); pointer('pointerup', x) })
      expect(row.style.transform).toContain(expected)
      expect(row.style.touchAction).toBe('pan-y')
      expect(mutations).toEqual([])
    })
  }
  it('세로 포인터는 수평 스와이프 패널을 열지 않는다', async () => {
    const C = (await import('@/app/payments/page')).default
    await mount(C)
    const row = host.querySelector<HTMLElement>('[data-swipe-row="paper-6"]')!
    for (const [type, y] of [['pointerdown', 200], ['pointermove', 230], ['pointermove', 310], ['pointerup', 310]] as const) {
      await act(async () => {
        const e = new MouseEvent(type, { bubbles: true, clientX: 200, clientY: y })
        Object.defineProperties(e, { pointerType: { value: 'touch' }, pointerId: { value: 1 } })
        row.dispatchEvent(e)
      })
    }
    expect(row.style.transform).toMatch(/^translateX\(0(?:px)?\)$/)
    expect(mutations).toEqual([])
  })

  for (const [path, load] of modules.filter(([p]) => ['/dashboard','/payments','/stats'].includes(p))) {
    it(`${path} 빈 데이터 상태`, async () => {
      empty = true; route = path
      await mount((await load()).default)
      expect(host.textContent).not.toContain('합성학생')
      expect(host.textContent!.length).toBeGreaterThan(10)
      expect(mutations).toEqual([])
    })
  }
  it('오류 화면 재시도 콜백과 not-found 복귀 경로를 보존', async () => {
    const ErrorPage = (await import('@/app/error')).default
    const reset = vi.fn()
    await act(async () => root.render(h(ErrorPage, { error: new Error('합성 오류'), reset })))
    const retry = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('다시'))!
    await act(async () => retry.click())
    expect(reset).toHaveBeenCalledTimes(1)
    const NotFound = (await import('@/app/not-found')).default
    await mount(NotFound)
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/dashboard')
  })

})
