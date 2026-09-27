// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../tests/e2e/payments-header-fixtures.cjs'

let data = fixture.scenario()
const cache = new Map<string, unknown>()
const pending = new Set<string>()
let pageReads = 0
const info = vi.fn()
vi.mock('sonner', () => ({ toast: { info: (...args: unknown[]) => info(...args), error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('swr', () => ({ mutate: vi.fn(), default: (key: string) => {
  if (key === '/api/grades') pageReads++
  if (!cache.has(key)) cache.set(key, fixture.fixture(data, `http://fixture${key}`))
  return { data: cache.get(key), isLoading: pending.has(key), mutate: vi.fn() }
} }))
vi.mock('@/components/payments/AiFilterButton', () => ({ default: ({ onFilter }: { onFilter: (query: string) => void }) => h('button', { onClick: () => onFilter('합성 AI 교집합') }, '합성 AI') }))
import PaymentsPage from '@/app/payments/page'

let host: HTMLDivElement, root: Root
let memo = '', memoStatus = 200
let memoVersion = 0
let writes: { url: string; body: Record<string, unknown> }[]
const render = async () => { await act(async () => root.render(h(PaymentsPage))) }
const button = (text: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!
const click = async (el: HTMLElement) => { expect(el).toBeTruthy(); await act(async () => el.click()) }
const open = async () => click(host.querySelector('[aria-label="결제일 선택"]')!)
const dialog = () => document.querySelector('[role="dialog"]')!
const day = (n: number) => dialog().querySelector<HTMLButtonElement>(`[data-day="${n}"]`)!
const close = async () => { await click(dialog().querySelector('[aria-label="닫기"]')!); await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }) }
const toggle = async () => click(Array.from(dialog().querySelectorAll('button')).find(b => b.textContent?.startsWith('청구지연 '))!)
const apply = async () => { await click(button('적용', dialog())); await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }) }
const lateDays = () => Array.from(dialog().querySelectorAll('[data-overdue="true"]')).map(el => Number(el.getAttribute('data-day')))
const normalIds = () => Array.from(host.querySelectorAll('[data-section-key] [data-student-row]')).map(el => el.getAttribute('data-student-row')).sort()
const scroll = async (y: number) => { await act(async () => { Object.defineProperty(window, 'scrollY', { value: y, configurable: true }); window.dispatchEvent(new Event('scroll')); await new Promise(resolve => requestAnimationFrame(resolve)) }) }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-13T04:00:00Z'))
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.stubGlobal('scrollTo', vi.fn((options: ScrollToOptions) => Object.defineProperty(window, 'scrollY', { value: options.top ?? 0, configurable: true })))
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  data = fixture.scenario(); cache.clear(); pending.clear(); info.mockClear(); pageReads = 0
  memo = '검수 월 메모'; memoStatus = 200; memoVersion = 0; writes = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/agent/filter') return new Response(JSON.stringify({ student_ids: ['header-2', 'header-4', 'header-8'], description: '합성 교집합' }))
    if (!url.startsWith('/api/monthly-memo')) throw new Error(`미정의 API: ${url}`)
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)); writes.push({url, body})
      if (memoStatus === 200) memo = body.content
      return new Response(JSON.stringify({ content: memo, updated_at: `v${++memoVersion}`, code: memoStatus === 409 ? 'MEMO_CONFLICT' : undefined }), { status: memoStatus })
    }
    return new Response(JSON.stringify({ content: memo, updated_at: `v${memoVersion}` }))
  }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('결제일 달력 — 표시 범위·유형별 집계·갱신', () => {
  it('같은 학생의 두 지연 날짜를 표시하되 학생 수는 한 명, 퇴원·예약·납부·0원은 제외', async () => {
    await render(); await open()
    expect(lateDays()).toEqual([3,4,5,10,11])
    expect(dialog().textContent).toContain('청구지연 4명')
    expect(day(5).getAttribute('aria-label')).toContain('청구지연')
    expect(day(5).querySelector('[aria-hidden]')).not.toBeNull()
    expect(day(20).getAttribute('data-overdue')).toBe('false')
  })
  it('범위·전체/미납 선택은 달력 집계를 축소하지 않는다', async () => {
    await render(); await click(button('전체',host)); await open(); await click(day(25)); await apply()
    expect(normalIds()).toEqual(['header-12'])
    await open(); expect(lateDays()).toEqual([3,4,5,10,11]); expect(dialog().textContent).toContain('청구지연 4명')
  })
  it('AI 교집합도 일반 명단과 같고 퇴원 학생은 달력에서 제외', async () => {
    await render(); await click(button('합성 AI')); await open()
    expect(lateDays()).toEqual([10]); expect(dialog().textContent).toContain('청구지연 1명')
    await toggle(); await apply(); expect(normalIds()).toEqual(['header-2'])
    expect(host.querySelector('[data-student-row="header-8"]')).not.toBeNull() // 기존 퇴원 섹션 필터는 보존
  })
  it('예약 큐만 바뀌어도 빨간 날짜와 학생 수를 갱신', async () => {
    await render(); await open(); expect(day(7).getAttribute('data-overdue')).toBe('false')
    cache.set('/api/billing/queue?month=2026-09', []); await render()
    expect(day(7).getAttribute('data-overdue')).toBe('true'); expect(dialog().textContent).toContain('청구지연 5명')
  })
  it('스냅샷만 바뀌어도 일반 학생 0원 제외를 다시 판정', async () => {
    await render(); await open()
    cache.set('/api/fee-snapshots?months=2026-09,2026-08', data.snapshots.map(s => ({ ...s, fee: 300000 }))); await render()
    expect(day(8).getAttribute('data-overdue')).toBe('true'); expect(dialog().textContent).toContain('청구지연 5명')
  })
  it('청구 유형·납부 인덱스만 바뀌어도 해당 날짜를 갱신', async () => {
    await render(); await open()
    cache.set('/api/billing?month=2026-09', [...data.bills, {...data.bills[0], id:'electives-paid', bill_type:'electives',status:'paid'}]); await render()
    expect(day(10).getAttribute('data-overdue')).toBe('false')
    cache.set('/api/payments?billing_month=2026-09', []); await render()
    expect(day(9).getAttribute('data-overdue')).toBe('true')
  })
  it('날짜만 경과한 뒤 재진입해도 새 지연일을 계산', async () => {
    await render(); await open(); expect(day(20).getAttribute('data-overdue')).toBe('false'); await toggle(); await apply()
    expect(normalIds()).not.toContain('header-4')
    vi.setSystemTime(new Date('2026-09-20T04:00:00Z')); await open()
    expect(day(20).getAttribute('data-overdue')).toBe('true'); expect(dialog().textContent).toContain('2026-09-20 기준')
    await close(); expect(normalIds()).toContain('header-4')
  })
  it('없는 29~31일은 월말 표시만 보정하며 범위 비교는 원래 날짜를 유지', async () => {
    vi.setSystemTime(new Date('2027-02-28T04:00:00Z'))
    const sample = {...data.students[0],payment_due_day:31,enrollment_date:'2026-09-01'}
    data.grades[0].classes[0].students = [sample]
    await render(); await open()
    expect(dialog().querySelector('[data-day="29"]')).toBeNull()
    expect(lateDays()).toEqual([28]); expect(dialog().textContent).toContain('31일 결제일')
    expect(day(28).getAttribute('aria-label')).toContain('보정된 결제일 포함')
    await click(day(28)); await apply(); expect(normalIds()).toEqual([])
    await open(); await toggle(); await apply(); expect(normalIds()).toEqual(['header-1'])
  })
})

describe('달력 초안/적용 전환표와 키보드', () => {
  it('날짜 없이 청구지연 켜기·끄기 적용, 지연 해제 후 all', async () => {
    await render(); await open(); await toggle(); await apply()
    expect(normalIds()).toEqual(['header-1','header-2','header-3','header-9'])
    expect(host.querySelector('[aria-label="결제일 선택"]')!.textContent).toBe('청구지연 4')
    await open(); await toggle(); await apply(); expect(button('전체',host)).toBeTruthy()
    expect(host.querySelector('[aria-label="직접 입력 해제"]')).toBeNull()
  })
  it('지연 상태에서 날짜 선택은 초안 토글을 끄며 범위 적용 후 all로 정리', async () => {
    await render(); await open(); await toggle(); await apply(); await open(); await click(day(25))
    expect(Array.from(dialog().querySelectorAll('button')).find(b => b.textContent?.startsWith('청구지연 '))!.getAttribute('aria-pressed')).toBe('false')
    await apply(); expect(normalIds()).toEqual(['header-12']); await click(host.querySelector('[aria-label="직접 입력 해제"]')!)
    expect(button('전체',host)).toBeTruthy(); expect(normalIds()).toContain('header-4')
  })
  for (const clear of ['chip','picker']) it(`미납 기반 범위 적용·${clear} 해제는 미납 상태를 보존`, async () => {
    await render(); await click(button('전체',host)); const unpaidIds = normalIds()
    await open(); await click(day(25)); await apply(); expect(normalIds()).toEqual(['header-12'])
    if (clear === 'chip') await click(host.querySelector('[aria-label="직접 입력 해제"]')!)
    else { await open(); await click(button('해제',dialog())) }
    expect(button('미납',host)?.getAttribute('aria-pressed')).toBe('true'); expect(normalIds()).toEqual(unpaidIds)
  })
  for (const clear of ['chip','picker']) it(`청구지연 ${clear} 해제는 all로 복귀`, async () => {
    await render(); const all = normalIds(); await open(); await toggle(); await apply()
    if (clear === 'chip') await click(host.querySelector('[aria-label="직접 입력 해제"]')!)
    else { await open(); await click(button('해제',dialog())) }
    expect(normalIds()).toEqual(all); expect(button('전체',host)).toBeTruthy()
  })
  for (const cancel of ['close','backdrop','Escape']) it(`${cancel}는 초안 폐기·기존 범위와 미납 보존·진입 버튼 포커스 복원`, async () => {
    await render(); await click(button('전체',host)); await open(); await click(day(3)); await click(day(11)); await apply()
    const ids = normalIds(); await open(); await toggle()
    if (cancel === 'close') await close()
    if (cancel === 'backdrop') await click(dialog().parentElement!)
    if (cancel === 'Escape') await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true})) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(normalIds()).toEqual(ids); expect(host.querySelector('[aria-label="결제일 선택"]')!.textContent).toBe('3일~11일')
    expect(document.activeElement).toBe(host.querySelector('[aria-label="결제일 선택"]'))
  })
  it('초기 포커스·방향키·Home/End·Tab 순환으로 모든 피커 조작에 접근', async () => {
    await render(); await open(); expect(document.activeElement).toBe(day(1))
    for (const [key,target] of [['ArrowDown',8],['ArrowRight',9],['Home',1],['End',30]] as const) {
      await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', {key,bubbles:true})) }); expect(document.activeElement).toBe(day(target))
    }
    const applyButton = button('적용',dialog()), closeButton = dialog().querySelector<HTMLElement>('[aria-label="닫기"]')!
    applyButton.focus(); await act(async () => { applyButton.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})) }); expect(document.activeElement).toBe(closeButton)
    await act(async () => { closeButton.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})) }); expect(document.activeElement).toBe(applyButton)
    await click(day(5)); expect(day(5).className).toContain('bg-[var(--blue-dim)]'); expect(day(5).className).toContain('text-[var(--red)]')
  })
})

describe('납부 헤더 v2 — 자연 스크롤과 기존 데이터 가드', () => {
  it.each([true, false])('원문 스크롤 왕복 동안 메모/필터/목록·초안 유지, 페이지 재렌더와 스크롤 보정 없음 reduced=%s', async reduced => {
    vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }))
    await render(); await click(button('전체', host))
    if (!reduced) {
      // Framer의 최초 auto 크기 측정은 스크롤 복원을 수행한다. 일반 스크롤 검사는
      // 그 진입 프레임이 끝난 뒤 시작한다. 기존 reduced=true 검사는 초기 호출까지 유지한다.
      await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) })
      vi.mocked(window.scrollTo).mockClear()
    }
    const reads = pageReads, ids = normalIds()
    const details = host.querySelector<HTMLElement>('[data-payments-details]')!
    const content = host.querySelector<HTMLElement>('[data-payments-content]')!
    const textarea = host.querySelector('textarea')!
    const row = host.querySelector<HTMLElement>('[data-swipe-row]')!
    const rowTransform = row.style.transform
    const animate = vi.fn()
    Object.defineProperty(content, 'animate', { value: animate, configurable: true })
    textarea.focus(); textarea.setSelectionRange(1, 4); textarea.scrollTop = 23
    for (const y of [120, 180, 150, 120, 320, 280, 400, 96, 24, 0]) {
      await scroll(y)
      expect(window.scrollY).toBe(y)
      expect(host.querySelector('[data-payments-details]')).toBe(details)
      expect(host.querySelector('textarea')).toBe(textarea)
      expect(details.hasAttribute('inert')).toBe(false)
      expect(details.getAttribute('aria-hidden')).not.toBe('true')
      expect(details.style.height).toBe('')
      expect(document.activeElement).toBe(textarea)
      expect([textarea.selectionStart, textarea.selectionEnd, textarea.scrollTop]).toEqual([1, 4, 23])
      expect(textarea.value).toBe('검수 월 메모')
      expect(normalIds()).toEqual(ids)
      expect(button('미납', host)?.getAttribute('aria-pressed')).toBe('true')
    }
    expect(pageReads).toBe(reads); expect(window.scrollTo).not.toHaveBeenCalled()
    expect(animate).not.toHaveBeenCalled(); expect(row.style.transform).toBe(rowTransform)
    // sticky가 짧은 래퍼에서 풀리지 않도록 일반 헤더/목록과 부모가 같다.
    expect(details.parentElement).toBe(content.parentElement)
    expect(host.querySelector('[data-payments-header]')!.parentElement).toBe(content.parentElement)
  })
  it('메모 포커스와 달력 닫힘 복원은 후속 스크롤에도 유지', async () => {
    await render(); host.querySelector('textarea')!.focus(); await scroll(300)
    expect(document.activeElement).toBe(host.querySelector('textarea'))
    await open(); await scroll(24); await close(); await scroll(301)
    expect(document.activeElement).toBe(host.querySelector('[aria-label="결제일 선택"]'))
    expect(window.scrollTo).not.toHaveBeenCalled()
  })
  it('월 로딩에도 헤더·메모 인스턴스와 월 네비 하나를 유지하고 목록/금액/발송은 숨김', async () => {
    await render(); const header=host.querySelector('[data-payments-header]'), textarea=host.querySelector('textarea')
    pending.add('/api/payments?billing_month=2026-10')
    await click(host.querySelector('[aria-label="다음 달"]')!)
    expect(host.querySelector('[data-payments-header]')).toBe(header); expect(host.querySelector('textarea')).toBe(textarea)
    expect(host.querySelectorAll('[aria-label="다음 달"]')).toHaveLength(1)
    expect(host.querySelector('[data-student-row]')).toBeNull(); expect(host.querySelector('[aria-label="결제일 선택"]')).toBeNull()
    expect(host.textContent).toContain('납부 내역 로딩 중')
    pending.clear(); await render(); expect(host.querySelector('[data-payments-header]')).toBe(header)
  })
  it('빈 명단에도 결제일 진입·해제·전체/미납 전환 가능', async () => {
    data.grades=[]; await render(); await open(); await click(day(1)); await apply()
    await click(host.querySelector('[aria-label="직접 입력 해제"]')!); await click(button('전체',host)); expect(button('미납',host)).toBeTruthy()
    expect(host.querySelectorAll('[aria-label="결제일 선택"]')).toHaveLength(1)
  })
  it.each([500,409])('메모 %s 저장 실패 안내는 발송 없이도 sticky에 지속, 초안 복사 접근 유지', async status => {
    await render(); memoStatus=status
    await act(async () => {
      const textarea=host.querySelector('textarea')!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'보존할 초안')
      textarea.dispatchEvent(new Event('input',{bubbles:true}))
      await new Promise(resolve=>setTimeout(resolve,550))
    })
    await scroll(300)
    const warning=Array.from(host.querySelectorAll('[role="status"]')).find(el=>el.textContent?.includes(status===409?'다른 기기':'저장 실패'))!
    expect(warning.closest('[data-payments-sticky-status]')).not.toBeNull(); expect(host.querySelector('textarea')!.value).toBe('보존할 초안')
    expect(writes).toHaveLength(1); await click(button('메모 확인',host))
    expect(document.activeElement).toBe(host.querySelector('textarea')); expect(host.querySelector('textarea')!.value).toBe('보존할 초안')
    expect(host.querySelector('textarea')!.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' })
    expect(warning.isConnected).toBe(true)
  })
})
