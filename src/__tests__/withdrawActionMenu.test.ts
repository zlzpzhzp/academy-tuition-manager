// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import WithdrawActionMenu, { type WithdrawActionTarget } from '@/components/WithdrawActionMenu'

let host: HTMLDivElement, root: Root
const onClose = vi.fn()
const onMarked = vi.fn()
const fetchMock = vi.fn()
const target: WithdrawActionTarget = {
  studentId: 'synthetic-withdrawal', studentName: '합성학생',
  fee: 300000, enrollmentDate: '2026-09-01', withdrawalDate: '2026-09-16',
  classDays: '1,3,5', paymentDueDay: 1,
}
const render = async (value = target) => {
  await act(async () => root.render(h(WithdrawActionMenu, {
    target: value, billingMonth: '2026-09', onClose, onMarked,
  })))
}
const panel = () => document.querySelector<HTMLElement>('[data-paper-card]')!
const closeButton = () => panel().querySelector<HTMLButtonElement>('[aria-label="닫기"]')!
const click = async (element: HTMLElement) => { await act(async () => element.click()) }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduced-motion'), addEventListener() {}, removeEventListener() {},
  }))
  // 실제 컴포넌트·계산·피커를 렌더하되 자동 미리보기 요청만 대역으로 허용한다.
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url !== '/api/payssam/resettle' || init?.method !== 'POST' ||
        JSON.parse(String(init.body)).dryRun !== true) throw new Error('실네트워크·처리 요청 금지')
    return new Response(JSON.stringify({ mode: 'paid' }))
  })
  vi.stubGlobal('fetch', fetchMock)
  onClose.mockReset(); onMarked.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it.each([
  ['계산 결과와 전체 안내가 있는 긴 본문', target, true, true],
  ['수업일 선택 전 본문', { ...target, withdrawalDate: null }, true, false],
  ['계산기가 없는 본문', { ...target, fee: undefined }, false, false],
] as const)('%s에서도 헤더는 스크롤 밖에 있고 모바일·데스크톱 본문 높이를 제한한다', async (_, value, calculator, refund) => {
  await render(value)
  const card = panel()
  for (const token of ['max-h-[88vh]', 'sm:max-h-[88vh]', 'flex', 'flex-col', 'min-h-0', 'overflow-hidden', 'rounded-t-3xl', 'sm:rounded-3xl']) {
    expect(card.classList.contains(token), token).toBe(true)
  }
  const scrollers = card.querySelectorAll<HTMLElement>('.overflow-y-auto')
  expect(scrollers).toHaveLength(1)
  const body = scrollers[0]
  for (const token of ['flex-1', 'min-h-0', 'overscroll-contain', 'pb-[max(1.25rem,env(safe-area-inset-bottom))]']) {
    expect(body.classList.contains(token), token).toBe(true)
  }
  const heading = card.querySelector('h2')!
  const close = closeButton()
  const header = Array.from(card.children).find(child => child.contains(heading))!
  expect(header.contains(close)).toBe(true)
  expect(header.classList.contains('shrink-0')).toBe(true)
  expect(body.contains(header)).toBe(false)
  expect(body.contains(heading)).toBe(false)
  expect(body.contains(close)).toBe(false)
  expect(close.disabled).toBe(false)
  expect(body.textContent?.includes('환불 계산기')).toBe(calculator)
  expect(Array.from(body.querySelectorAll('p')).some(p => p.textContent === '환불 예상액')).toBe(refund)
  for (const label of ['계좌환불 완료', '이번달까지 정리', '퇴원 취소 (번복)', '퇴원 학생의 결제 처리 상태를 표시합니다.']) {
    expect(body.textContent).toContain(label)
  }
  expect(body.textContent?.includes('정산분 재청구')).toBe(refund)
  expect(fetchMock).toHaveBeenCalledTimes(refund ? 1 : 0)
  if (refund) {
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      studentId: target.studentId, billingMonth: '2026-09', dryRun: true,
    })
  }
  expect(onMarked).not.toHaveBeenCalled()
})

it('본문 클릭은 전파하지 않고 헤더 닫기·오버레이 클릭은 각각 한 번 닫는다', async () => {
  await render()
  await click(Array.from(panel().querySelectorAll('p')).find(p => p.textContent === '환불 계산기')!)
  expect(onClose).not.toHaveBeenCalled()
  await click(closeButton())
  expect(onClose).toHaveBeenCalledTimes(1)
  onClose.mockClear()
  await click(panel().parentElement!)
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('날짜 피커는 클립되는 패널 밖 포털에서 열리고 선택 후 닫히며 계산을 갱신한다', async () => {
  await render()
  const card = panel()
  const dateButton = Array.from(card.querySelectorAll('button')).find(button => button.textContent === '2026-09-14')!
  await click(dateButton)
  const picker = document.querySelector<HTMLElement>('[role="dialog"][aria-label="날짜 선택"]')!
  expect(picker).toBeTruthy()
  expect(card.contains(picker)).toBe(false)
  await click(picker.querySelector<HTMLButtonElement>('[aria-label="9월 10일"]')!)
  expect(document.querySelector('[data-picker-portal]')).toBeNull()
  expect(dateButton.textContent).toBe('2026-09-10')
  expect(onClose).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
