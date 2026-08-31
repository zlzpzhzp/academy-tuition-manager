import { describe, it, expect } from 'vitest'
import { isBusinessHourKst, nextBusinessSlot, formatKst } from '@/lib/schedule'

// KST(UTC+9) 시각을 UTC Date로 만드는 헬퍼
function kst(year: number, month1: number, day: number, hour: number, min = 0): Date {
  // KST → UTC = -9시간
  return new Date(Date.UTC(year, month1 - 1, day, hour - 9, min, 0))
}

describe('isBusinessHourKst', () => {
  it('월~금 11~22시는 영업시간', () => {
    expect(isBusinessHourKst(kst(2026, 5, 4, 11, 0))).toBe(true)  // 월 11:00
    expect(isBusinessHourKst(kst(2026, 5, 4, 14, 30))).toBe(true) // 월 14:30
    expect(isBusinessHourKst(kst(2026, 5, 4, 21, 59))).toBe(true) // 월 21:59
  })

  it('월~금 11시 전/22시 이후는 영업시간 외', () => {
    expect(isBusinessHourKst(kst(2026, 5, 4, 10, 59))).toBe(false) // 월 10:59
    expect(isBusinessHourKst(kst(2026, 5, 4, 22, 0))).toBe(false)  // 월 22:00 (포함 안 됨)
    expect(isBusinessHourKst(kst(2026, 5, 4, 23, 0))).toBe(false)  // 월 23:00
  })

  it('토요일 11~20시는 영업시간', () => {
    expect(isBusinessHourKst(kst(2026, 5, 9, 11, 0))).toBe(true)  // 토 11:00
    expect(isBusinessHourKst(kst(2026, 5, 9, 19, 59))).toBe(true) // 토 19:59
  })

  it('토요일 20시 이후는 영업시간 외', () => {
    expect(isBusinessHourKst(kst(2026, 5, 9, 20, 0))).toBe(false) // 토 20:00 (포함 안 됨)
    expect(isBusinessHourKst(kst(2026, 5, 9, 21, 0))).toBe(false) // 토 21:00
  })

  it('일요일은 항상 영업시간 외', () => {
    expect(isBusinessHourKst(kst(2026, 5, 10, 11, 0))).toBe(false) // 일 11:00
    expect(isBusinessHourKst(kst(2026, 5, 10, 15, 0))).toBe(false) // 일 15:00
  })
})

describe('nextBusinessSlot', () => {
  it('월요일 새벽 → 같은 날 11시', () => {
    const slot = nextBusinessSlot(kst(2026, 5, 4, 8, 0)) // 월 8:00
    expect(formatKst(slot)).toBe('2026-05-04 11:00')
  })

  it('월요일 23시 → 화요일 11시', () => {
    const slot = nextBusinessSlot(kst(2026, 5, 4, 23, 0)) // 월 23:00
    expect(formatKst(slot)).toBe('2026-05-05 11:00')
  })

  it('금요일 23시 → 토요일 11시', () => {
    const slot = nextBusinessSlot(kst(2026, 5, 8, 23, 0)) // 금 23:00
    expect(formatKst(slot)).toBe('2026-05-09 11:00')
  })

  it('토요일 21시 → 월요일 11시 (일요일 건너뜀)', () => {
    const slot = nextBusinessSlot(kst(2026, 5, 9, 21, 0)) // 토 21:00
    expect(formatKst(slot)).toBe('2026-05-11 11:00')
  })

  it('일요일 13시 → 월요일 11시', () => {
    const slot = nextBusinessSlot(kst(2026, 5, 10, 13, 0)) // 일 13:00
    expect(formatKst(slot)).toBe('2026-05-11 11:00')
  })

  it('토요일 9시 → 같은 토요일 11시', () => {
    const slot = nextBusinessSlot(kst(2026, 5, 9, 9, 0)) // 토 9:00
    expect(formatKst(slot)).toBe('2026-05-09 11:00')
  })
})

describe('formatKst', () => {
  it('UTC Date를 KST 표기로 변환', () => {
    expect(formatKst(kst(2026, 5, 4, 14, 30))).toBe('2026-05-04 14:30')
    expect(formatKst(kst(2026, 1, 1, 0, 0))).toBe('2026-01-01 00:00')
    expect(formatKst(kst(2026, 12, 31, 23, 59))).toBe('2026-12-31 23:59')
  })

  it('한 자리 시각도 zero-pad', () => {
    expect(formatKst(kst(2026, 3, 5, 9, 7))).toBe('2026-03-05 09:07')
  })
})
