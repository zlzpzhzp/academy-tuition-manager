import { afterEach, describe, it, expect, vi } from 'vitest'
import { GEMINI_MODELS, GEMINI_PRIMARY_MODEL, isRetryableWithAnotherModel, withGeminiModel } from '@/lib/geminiModel'

describe('GEMINI_MODELS', () => {
  it('고정 핀된 3.x → Flash 별칭 → Lite 별칭 순서로 시도한다', () => {
    expect(GEMINI_PRIMARY_MODEL).toBe('gemini-3-flash-preview')
    expect(GEMINI_MODELS).toEqual([
      'gemini-3-flash-preview',
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
    ])
  })
  it('별칭은 폴백에만 쓰고 10/20 종료되는 2.5 고정 핀은 제거한다', () => {
    expect(GEMINI_PRIMARY_MODEL).not.toMatch(/-latest$/)
    expect(GEMINI_MODELS).not.toContain('gemini-2.5-flash')
  })
})

describe('GEMINI_MODEL override', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it.each([
    [undefined, ['gemini-3-flash-preview', 'gemini-flash-latest', 'gemini-flash-lite-latest']],
    ['', ['gemini-3-flash-preview', 'gemini-flash-latest', 'gemini-flash-lite-latest']],
    ['   ', ['gemini-3-flash-preview', 'gemini-flash-latest', 'gemini-flash-lite-latest']],
    ['gemini-3-flash-preview', ['gemini-3-flash-preview', 'gemini-flash-latest', 'gemini-flash-lite-latest']],
    ['  custom-primary  ', ['custom-primary', 'gemini-flash-latest', 'gemini-flash-lite-latest']],
    ['gemini-flash-latest', ['gemini-flash-latest', 'gemini-flash-lite-latest']],
    ['  gemini-flash-lite-latest  ', ['gemini-flash-lite-latest', 'gemini-flash-latest']],
  ])('설정 %s: primary 우선·나머지 순서 유지·중복 없이 한 번씩 호출', async (override, expected) => {
    vi.stubEnv('GEMINI_MODEL', override)
    vi.resetModules()
    const configured = await import('@/lib/geminiModel')
    expect(configured.GEMINI_PRIMARY_MODEL).toBe(expected[0])
    expect(configured.GEMINI_MODELS).toEqual(expected)

    const error = new Error('[503] UNAVAILABLE')
    const run = vi.fn().mockRejectedValue(error)
    await expect(configured.withGeminiModel(run)).rejects.toBe(error)
    expect(run.mock.calls.map(([model]) => model)).toEqual(expected)
  })
})

describe('isRetryableWithAnotherModel — 다음 후보가 다른 실패 도메인일 때만 넘어간다', () => {
  it('모델 없음은 넘긴다', () => {
    expect(isRetryableWithAnotherModel(new Error('[404] models/gemini-3-pro is not found'))).toBe(true)
    expect(isRetryableWithAnotherModel(new Error('NOT_FOUND: unsupported model'))).toBe(true)
  })
  it('429 용량 소진은 모델 단위라 넘긴다 (2026-09-12 정정)', () => {
    expect(isRetryableWithAnotherModel(new Error(
      '[429] No capacity available for model gemini-2.5-flash on the server (MODEL_CAPACITY_EXHAUSTED)'))).toBe(true)
    expect(isRetryableWithAnotherModel(new Error('RESOURCE_EXHAUSTED: quota exceeded'))).toBe(true)
  })
  it('5xx·타임아웃은 백엔드 경로가 갈릴 수 있어 넘긴다', () => {
    expect(isRetryableWithAnotherModel(new Error('[503] UNAVAILABLE'))).toBe(true)
    expect(isRetryableWithAnotherModel(new Error('fetch failed'))).toBe(true)
    expect(isRetryableWithAnotherModel(new Error('deadline exceeded'))).toBe(true)
  })
  it('인증은 모델과 무관하게 공유되므로 넘기지 않는다', () => {
    expect(isRetryableWithAnotherModel(new Error('API key not valid'))).toBe(false)
    expect(isRetryableWithAnotherModel(new Error('[403] PERMISSION_DENIED'))).toBe(false)
  })
  it('프롬프트·스키마 오류(400)는 모델을 바꿔도 같다', () => {
    expect(isRetryableWithAnotherModel(new Error('[400] Invalid JSON payload'))).toBe(false)
  })
})

describe('withGeminiModel', () => {
  it('1순위가 되면 폴백을 부르지 않는다', async () => {
    const run = vi.fn().mockResolvedValue('ok')
    await expect(withGeminiModel(run)).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('gemini-3-flash-preview')
  })
  it('모델 없음이면 다음 후보로 넘어간다', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('[404] model not found'))
      .mockResolvedValue('fallback')
    await expect(withGeminiModel(run)).resolves.toBe('fallback')
    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenNthCalledWith(2, 'gemini-flash-latest')
  })
  it('preview·Flash 별칭이 실패하면 마지막 Lite 별칭의 결과를 반환한다', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('[429] MODEL_CAPACITY_EXHAUSTED'))
      .mockRejectedValueOnce(new Error('[503] UNAVAILABLE'))
      .mockResolvedValue('lite fallback')
    await expect(withGeminiModel(run)).resolves.toBe('lite fallback')
    expect(run.mock.calls.map(([model]) => model)).toEqual([
      'gemini-3-flash-preview',
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
    ])
  })
  it('용량 소진(429)도 다음 후보로 넘어간다', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('[429] No capacity available for model gemini-3-flash-preview'))
      .mockResolvedValue('fallback')
    await expect(withGeminiModel(run)).resolves.toBe('fallback')
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('인증 오류는 그대로 던진다(같은 키로 두 번 부르지 않는다)', async () => {
    const run = vi.fn().mockRejectedValue(new Error('[403] PERMISSION_DENIED'))
    await expect(withGeminiModel(run)).rejects.toThrow('403')
    expect(run).toHaveBeenCalledTimes(1)
  })
  it.each(['[401] UNAUTHENTICATED', '[400] Invalid JSON payload'])('%s 오류는 폴백 없이 그대로 던진다', async message => {
    const error = new Error(message)
    const run = vi.fn().mockRejectedValue(error)
    await expect(withGeminiModel(run)).rejects.toBe(error)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('주간 리뷰 5xx 상태 문맥·숫자 경계', () => {
  const cases: [unknown, boolean][] = [
    ...[500, 501, 502, 503, 504, 599].map(status => [Object.assign(new Error('SDK error'), { status }), true] as [unknown, boolean]),
    ...['[500]', '[503 Service Unavailable]', '[502 Bad Gateway]', '[599 Synthetic]', 'HTTP 503', 'status:500', 'status=502'].map(msg => [new Error(msg), true] as [unknown, boolean]),
    ...['prompt has 503 tokens', 'identifier 500 in body', 'HTTP 5030', 'status:5001', '[5030 Bad Gateway]', '[5001]', '[400] validation failed, input=503'].map(msg => [new Error(msg), false] as [unknown, boolean]),
    [Object.assign(new Error('SDK invalid'), { status: 5001 }), false],
    [Object.assign(new Error('API key invalid'), { status: 503 }), false],
  ]
  it.each(cases)('%s 폴백=%s, 실제 호출 수와 오류 정체성 보존', async (error, retry) => {
    const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('fallback')
    expect(isRetryableWithAnotherModel(error)).toBe(retry)
    if (retry) await expect(withGeminiModel(run)).resolves.toBe('fallback')
    else await expect(withGeminiModel(run)).rejects.toBe(error)
    expect(run).toHaveBeenCalledTimes(retry ? 2 : 1)
  })
})
