import { expect, it } from 'vitest'
import { withKeyedLock } from '@/lib/keyedLock'

it('키별 순서 보장, fn 예외 후 대기자·다음 호출도 락 획득', async () => {
  const events: string[] = []
  const failed = withKeyedLock('fixture-key', async () => {
    events.push('first')
    await Promise.resolve()
    throw new Error('fixture failure')
  })
  const next = withKeyedLock('fixture-key', async waited => { events.push('second'); expect(waited).toBe(true); return 2 })
  await expect(failed).rejects.toThrow('fixture failure')
  expect(await next).toBe(2)
  await withKeyedLock('fixture-key', async waited => { expect(waited).toBe(false); events.push('third') })
  expect(events).toEqual(['first', 'second', 'third'])
})
