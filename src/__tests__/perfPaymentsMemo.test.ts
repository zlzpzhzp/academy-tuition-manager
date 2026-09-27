// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const empty: never[] = []
const errorToast = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => errorToast(...a), success: vi.fn() } }))
vi.mock('swr', () => ({ default: () => ({ data: empty, mutate: vi.fn(), isLoading: false }), mutate: vi.fn() }))
vi.mock('@/lib/utils', async original => ({
  ...await original<typeof import('@/lib/utils')>(),
  useGrades: () => ({ data: empty, isLoading: false }),
  usePayments: () => ({ data: empty, isLoading: false }),
}))
vi.mock('@/lib/usePullToRefresh', () => ({ usePullToRefresh: () => ({}) }))
import PaymentsPage from '@/app/payments/page'

let root: Root
let container: HTMLDivElement
let stored: string
let version: string
let writes: { content: string; baseUpdatedAt?: string | null; month: string }[]
let respond: (body: typeof writes[number], index: number) => Promise<Response>
let readMemo: () => Response
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const textarea = () => container.querySelector('textarea')!
async function edit(content: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea(), content)
    textarea().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  errorToast.mockClear()
  writes = []
  stored = '서버 초기 메모'
  version = 'v0'
  readMemo = () => json({ content: stored, updated_at: version })
  respond = async (body, i) => { stored = body.content; version = `v${i + 1}`; return json({ ok: true, updated_at: version }) }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!url.startsWith('/api/monthly-memo')) throw new Error(`모의에 없는 요청: ${url}`)
    if (init?.method !== 'PUT') return readMemo()
    const body = JSON.parse(String(init.body))
    writes.push(body)
    return respond(body, writes.length - 1)
  }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(createElement(PaymentsPage)) })
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('perf #4 월별 메모 클라이언트', () => {
  it.each([{ debounce: 5, latency: 60 }, { debounce: 500, latency: 600 }])('저장 $latency ms/5ms 역전 상황에서도 최종 내용은 최신, 중간 대기는 1개', async ({ debounce, latency }) => {
    if (debounce === 5) {
      // 요구한 60/5ms 응답 역전을 관찰할 때만 디바운스 시간을 압축한다.
      // 600/5ms 대조에서는 실제 500ms 디바운스를 그대로 실행한다.
      const setTimer = globalThis.setTimeout
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, ms?: number) => setTimer(callback, ms === 500 ? debounce : ms)) as typeof setTimeout)
    }
    respond = (body, i) => new Promise(resolve => setTimeout(() => {
      stored = body.content
      version = `v${i + 1}`
      resolve(json({ ok: true, updated_at: version }))
    }, i === 0 ? latency : 5))
    await edit('옛 내용')
    await tick(debounce)
    await edit('중간 내용')
    await tick(1)
    await edit('최신 내용')
    await tick(debounce)
    await tick(latency)
    expect(stored).toBe('최신 내용')
    expect(writes.map(w => w.content)).toEqual(['옛 내용', '최신 내용'])
    expect(writes.map(w => w.baseUpdatedAt)).toEqual(['v0', 'v1'])
    expect(textarea().value).toBe('최신 내용')
  })
  it('월 이동 중 진행·대기 저장은 원래 월에 완료되고 새 월 내용은 보존', async () => {
    let release!: () => void
    respond = (body, i) => i === 0 ? new Promise(resolve => {
      release = () => { stored = body.content; resolve(json({ ok: true, updated_at: 'v1' })) }
    }) : Promise.resolve(json({ ok: true, updated_at: 'v2' }))
    await edit('이전 월 첫 편집')
    await tick(500)
    await edit('이전 월 최신 편집')
    const originalMonth = writes[0].month
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="다음 달"]')!.click() })
    expect(textarea().readOnly).toBe(true)
    readMemo = () => json({ content: '새 월 서버 내용', updated_at: 'other-month-v1' })
    await act(async () => { release() })
    expect(writes.map(w => w.month)).toEqual([originalMonth, originalMonth])
    expect(writes[1]).toMatchObject({ content: '이전 월 최신 편집', baseUpdatedAt: 'v1' })
    expect(textarea().readOnly).toBe(false)
    expect(textarea().value).toBe('새 월 서버 내용')
    await edit('새 월 편집')
    await tick(500)
    expect(writes[2].month).not.toBe(originalMonth)
    expect(writes[2].baseUpdatedAt).toBe('other-month-v1')
  })
  it('GET 실패는 기존대로 편집 잠금·PUT 없음', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: 'GET failed' }, 500))
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="다음 달"]')!.click() })
    expect(textarea().readOnly).toBe(true)
    expect(textarea().placeholder).toContain('메모 로드 실패')
    expect(writes).toHaveLength(0)
  })
  it('PUT 500은 저장 실패를 표시하고 편집은 계속 허용', async () => {
    respond = async () => json({ error: 'DB down' }, 500)
    await edit('보존할 편집')
    await tick(500)
    expect(errorToast).toHaveBeenCalled()
    expect(container.textContent).toContain('저장 실패')
    expect(textarea().readOnly).toBe(false)
    expect(textarea().value).toBe('보존할 편집')
    await edit('재편집')
    expect(textarea().value).toBe('재편집')
  })
  it('409는 로컬 최신 편집을 보존하고 다른 기기 수정 경고, 자동 덮어쓰기 없음', async () => {
    respond = async () => json({ code: 'MEMO_CONFLICT', content: '다른 기기 내용', updated_at: 'other-v1' }, 409)
    await edit('로컬 내용')
    await tick(500)
    expect(textarea().value).toBe('로컬 내용')
    expect(errorToast).toHaveBeenCalledWith(expect.stringContaining('다른 기기에서 수정됨'))
    expect(container.textContent).toContain('다른 기기에서 수정됨')
    // 충돌 뒤엔 자동저장이 영구 중단되므로 편집을 잠가 '쓰는 줄 알았는데 새로고침에 날아가는' 무음 유실을 막는다(로컬 내용은 그대로 보여 복사 가능)
    expect(textarea().readOnly).toBe(true)
    expect(textarea().value).toBe('로컬 내용')
    expect(writes).toHaveLength(1)
  })
})
