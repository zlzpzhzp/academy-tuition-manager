// @vitest-environment jsdom
import { act, createElement as h, type PropsWithChildren } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// 애니메이션만 제거한다. 실제 페이지의 입력·요청·토큰·리셋 효과를 실행한다.
vi.mock('framer-motion', () => {
  const component = (tag: string) => ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => {
    for (const key of ['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover']) delete props[key]
    return h(tag, props, children)
  }
  return { motion: { div: component('div'), button: component('button'), p: component('p'), h1: component('h1'), polyline: component('polyline'), svg: component('svg') }, AnimatePresence: ({ children }: PropsWithChildren) => children }
})
import KioskPage from '@/app/kiosk/page'

let root: Root, host: HTMLDivElement
const attendance = vi.fn()
const timeout = vi.fn()
const notice = { needsConfirm: true, message: '합성 안내: 오늘 수업일이 아닙니다' }
const button = (label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes(label))!
const click = async (label: string) => {
  await act(async () => {
    if (/^[0-9]$/.test(label) || label === '←') window.dispatchEvent(new KeyboardEvent('keydown', { key: label === '←' ? 'Backspace' : label, bubbles: true }))
    else button(label).click()
  })
}
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const enter = async () => { for (const digit of ['1', '2', '3', '4']) await click(digit) }
const bodies = () => attendance.mock.calls.map(([init]) => JSON.parse(String(init.body)))
beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-14T03:00:00Z'))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  timeout.mockReset().mockImplementation(() => new AbortController().signal)
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(timeout)
  attendance.mockReset().mockResolvedValue(new Response(JSON.stringify(notice)))
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/attendance/check-in') return attendance(init)
    if (url === '/api/kiosk-version') return new Response(JSON.stringify({ version: 'fixture' }))
    throw new Error(`Unexpected synthetic request: ${url}`)
  }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(h(KioskPage)))
  await enter()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('안내 표시 7999ms까지 같은 코드·버튼은 confirm=true, fetch 제한은 8초', async () => {
  await click('등원')
  expect(host.textContent).toContain(notice.message)
  await advance(7999)
  attendance.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, student: { name: 'fixture' } })))
  await click('등원')
  expect(bodies()).toEqual([{ code: '1234', action: 'check_in', confirm: false }, { code: '1234', action: 'check_in', confirm: true }])
  expect(timeout.mock.calls).toEqual([[8000], [8000]])
})
it('안내 표시 8000ms에 코드·안내·토큰을 함께 초기화', async () => {
  await click('등원')
  await advance(8000)
  expect(host.textContent).not.toContain(notice.message)
  expect(button('등원').disabled).toBe(true)
  await enter()
  attendance.mockResolvedValueOnce(new Response(JSON.stringify(notice)))
  await click('등원')
  expect(bodies().at(-1)).toEqual({ code: '1234', action: 'check_in', confirm: false })
})
it('타이머 콜백이 안 돌아도 만료 후 제출은 요청 없이 모두 초기화', async () => {
  await click('등원')
  vi.setSystemTime(new Date(Date.now() + 8000)) // 시간만 이동, 타이머 실행하지 않음
  await click('등원')
  expect(attendance).toHaveBeenCalledOnce()
  expect(host.textContent).not.toContain(notice.message)
  expect(button('등원').disabled).toBe(true)
})
it('느린 첫 응답의 요청 시작 시각이 아닌 안내 시점부터 8초', async () => {
  let reply!: (value: Response) => void
  attendance.mockImplementationOnce(() => new Promise(r => { reply = r }))
  await click('등원')
  await advance(7000)
  await act(async () => { reply(new Response(JSON.stringify(notice))) })
  await advance(7999)
  expect(host.textContent).toContain(notice.message)
  await advance(1)
  expect(host.textContent).not.toContain(notice.message)
  expect(button('등원').disabled).toBe(true)
})
it.each(['다른 버튼', '코드 변경'])('%s은 확인으로 전송하지 않는다', async change => {
  await click('등원')
  await advance(600)
  if (change === '코드 변경') { await click('←'); await click('5') }
  attendance.mockResolvedValueOnce(new Response(JSON.stringify(notice)))
  await click(change === '다른 버튼' ? '하원' : '등원')
  expect(bodies().at(-1)).toMatchObject({ code: change === '코드 변경' ? '1235' : '1234', confirm: false })
})
it('같은 프레임 더블탭·안내 직후 600ms 내 연타는 요청 하나', async () => {
  const submit = button('등원')
  await act(async () => { submit.click(); submit.click() })
  expect(attendance).toHaveBeenCalledOnce()
  await click('등원')
  expect(attendance).toHaveBeenCalledOnce()
})
it.each(['success', 'error', 'waiting'])('%s 결과 타이머 1.1/2.5/9초 보존', async mode => {
  if (mode === 'waiting') attendance.mockImplementationOnce(() => new Promise(() => {}))
  else attendance.mockResolvedValueOnce(new Response(JSON.stringify(mode === 'success' ? { ok: true, student: { name: 'fixture' } } : { error: '합성 오류' }), { status: mode === 'error' ? 500 : 200 }))
  await click('등원')
  const ms = mode === 'success' ? 1100 : mode === 'error' ? 2500 : 9000
  await advance(ms - 1)
  expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent?.includes('등원'))).toBe(false)
  await advance(1)
  expect(button('등원').disabled).toBe(true)
})
