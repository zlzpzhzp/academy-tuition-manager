import { describe, it, expect } from 'vitest'
import { getTodayString } from '@/lib/date'

describe('getTodayString', () => {
  it('YYYY-MM-DD 형식 반환', () => {
    const s = getTodayString()
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('현재 날짜와 일치 (KST 기준, 서버 TZ 무관)', () => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const expected = kst.toISOString().slice(0, 10)
    expect(getTodayString()).toBe(expected)
  })

  it('월/일 한 자리도 zero-pad', () => {
    // getTodayString의 padStart(2, '0') 검증
    const s = getTodayString()
    const [, mo, da] = s.split('-')
    expect(mo).toHaveLength(2)
    expect(da).toHaveLength(2)
  })
})
