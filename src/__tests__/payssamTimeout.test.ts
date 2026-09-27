import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sendBill } from '@/lib/payssam'

// 공개판은 가맹점 식별값을 환경변수로만 받는다(하드코딩 없음) — 시험용 합성값을 넣는다.
beforeEach(() => {
  vi.stubEnv('PAYSSAM_MEMBER', 'fixture-member')
  vi.stubEnv('PAYSSAM_MERCHANT', 'fixture-merchant')
  vi.stubEnv('PAYSSAM_CALLBACK_URL', 'https://callback.invalid/api/payssam/callback')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
it('perf #3 응답 없는 fetch는 지정 시간 내 식별 가능한 timeout으로 실패', async () => {
  vi.stubEnv('PAYSSAM_API_URL', 'https://payssam.invalid')
  vi.stubEnv('PAYSSAM_TIMEOUT_MS', '20')
  let signal: AbortSignal | undefined
  let rejectFetch!: (e: unknown) => void
  vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
    rejectFetch = reject
    signal = init.signal
    signal?.addEventListener('abort', () => reject(signal?.reason), { once: true })
  })))
  const start = performance.now()
  const result = sendBill({ studentName: 'fixture', phone: 'fixture-phone', amount: 100, productName: 'fixture' }).catch(e => e)
  // 수리 전 무한 대기가 테스트를 붙잡지 않도록 관찰 상한을 둔다.
  const outcome = await Promise.race([result, new Promise(r => setTimeout(() => r('still pending after 150ms'), 150))])
  if (!signal) rejectFetch(new Error('test cleanup'))
  console.info(`perf #3 elapsed: ${Math.round(performance.now() - start)}ms`)
  expect(outcome).toBeInstanceOf(Error)
  expect((outcome as Error).message).toBe('PaySsam API timeout 20ms /if/bill/send')
})
it('perf #3 기본 제한은 30000ms, 정상 응답·HTTP 오류 의미 보존', async () => {
  vi.stubEnv('PAYSSAM_API_URL', 'https://payssam.invalid')
  vi.stubEnv('PAYSSAM_TIMEOUT_MS', undefined)
  const timeout = vi.spyOn(AbortSignal, 'timeout')
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: '0000' })))
  vi.stubGlobal('fetch', fetchMock)
  const params = { studentName: 'fixture', phone: 'fixture-phone', amount: 100, productName: 'fixture' }
  expect(await sendBill(params)).toMatchObject({ code: '0000', bill_id: expect.any(String) })
  expect(timeout).toHaveBeenCalledWith(30000)
  fetchMock.mockResolvedValue(new Response('gateway error', { status: 502 }))
  await expect(sendBill(params)).rejects.toThrow('PaySsam API HTTP 502 /if/bill/send: gateway error')
})

const params = { studentName: 'fixture', phone: 'fixture-phone', amount: 100, productName: 'fixture' }
it.each([undefined, '', 'NaN', 'oops', '0', '-1', 'Infinity', '-Infinity', '125'])('env %s는 유효한 제한으로 정상 요청하고 응답을 보존', async value => {
  vi.stubEnv('PAYSSAM_API_URL', 'https://payssam.invalid')
  vi.stubEnv('PAYSSAM_TIMEOUT_MS', value)
  const timeout = vi.spyOn(AbortSignal, 'timeout') // 원본 호출: NaN/음수/Infinity면 실제로 throw
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: '0000' })))
  vi.stubGlobal('fetch', fetchMock)
  await expect(sendBill(params)).resolves.toMatchObject({ code: '0000' })
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(timeout).toHaveBeenCalledWith(value === '125' ? 125 : 30000)
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false)
})
it.each(['AbortError', 'TimeoutError', 'reason'])('요청 신호의 %s만 timeout으로 정규화', async name => {
  vi.stubEnv('PAYSSAM_API_URL', 'https://payssam.invalid')
  vi.stubEnv('PAYSSAM_TIMEOUT_MS', '20')
  const controller = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
  vi.stubGlobal('fetch', vi.fn(async () => {
    const reason = name === 'reason' ? new Error('synthetic signal reason') : new DOMException('request cancelled', name)
    controller.abort(reason)
    throw reason
  }))
  await expect(sendBill(params)).rejects.toThrow('PaySsam API timeout 20ms /if/bill/send')
})
it('HTTP 500 본문 처리 중 abort가 나도 500 원문 상태를 보존', async () => {
  vi.stubEnv('PAYSSAM_API_URL', 'https://payssam.invalid')
  const controller = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => {
    controller.abort(new DOMException('expired', 'TimeoutError'))
    throw controller.signal.reason
  } })))
  await expect(sendBill(params)).rejects.toThrow('PaySsam API HTTP 500 /if/bill/send: ')
})
it('HTTP 500 본문 뒤 신호가 만료돼도 상태코드와 본문을 보존', async () => {
  vi.stubEnv('PAYSSAM_API_URL', 'https://payssam.invalid')
  const controller = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => {
    controller.abort(new DOMException('expired', 'TimeoutError'))
    return 'synthetic gateway'
  } })))
  await expect(sendBill(params)).rejects.toThrow('PaySsam API HTTP 500 /if/bill/send: synthetic gateway')
})
it.each([false, true])('다른 오류는 신호 aborted=%s여도 그대로 보존', async aborted => {
  vi.stubEnv('PAYSSAM_API_URL', 'https://payssam.invalid')
  const controller = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
  const failure = new SyntaxError('synthetic parse failure')
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (aborted) controller.abort(new DOMException('expired', 'TimeoutError'))
    throw failure
  }))
  await expect(sendBill(params)).rejects.toBe(failure)
})
it('다른 요청의 TimeoutError는 이 신호가 유효하면 보존', async () => {
  vi.stubEnv('PAYSSAM_API_URL', 'https://payssam.invalid')
  const error = new DOMException('unrelated timeout', 'TimeoutError')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
  await expect(sendBill(params)).rejects.toBe(error)
})
it.each(['AbortError', 'TimeoutError'])('다른 출처의 %s는 이 요청 신호가 뒤늦게 만료돼도 보존', async name => {
  vi.stubEnv('PAYSSAM_API_URL', 'https://payssam.invalid')
  const controller = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
  const unrelated = new DOMException('synthetic unrelated failure', name)
  vi.stubGlobal('fetch', vi.fn(async () => {
    controller.abort(new DOMException('request expired', 'TimeoutError'))
    throw unrelated
  }))
  await expect(sendBill(params)).rejects.toBe(unrelated)
})
it('성공 HTTP 응답의 본문 읽기가 요청 abort로 중단되면 timeout', async () => {
  vi.stubEnv('PAYSSAM_API_URL', 'https://payssam.invalid')
  vi.stubEnv('PAYSSAM_TIMEOUT_MS', '20')
  const controller = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => {
    controller.abort(new DOMException('request expired', 'TimeoutError'))
    // fetch 본문 소비는 signal.reason과 다른 DOMException AbortError를 만들 수 있다.
    throw new DOMException('The operation was aborted.', 'AbortError')
  } })))
  await expect(sendBill(params)).rejects.toThrow('PaySsam API timeout 20ms /if/bill/send')
})
