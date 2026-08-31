import { describe, it, expect, vi, afterEach } from 'vitest'
import { getTodayString } from '@/lib/date'
import { getPrevMonth, formatMonth, getCurrentMonth, getPaymentDueDay, getActiveStudents, decodePaymentMemo } from '@/lib/utils'
import { countClassDays, parseClassDays } from '@/types'
import type { Student } from '@/types'

describe('getTodayString', () => {
  afterEach(() => { vi.useRealTimers() })

  it('YYYY-MM-DD 형식을 반환한다', () => {
    const result = getTodayString()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('로컬 타임존 기준 날짜를 반환한다 (toISOString 아님)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 15)) // 2026-04-15
    expect(getTodayString()).toBe('2026-04-15')
    vi.useRealTimers()
  })

  it('월/일이 한 자리면 0 패딩', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 5)) // 2026-01-05
    expect(getTodayString()).toBe('2026-01-05')
    vi.useRealTimers()
  })
})

describe('getPrevMonth', () => {
  it('이전 달을 반환한다', () => {
    expect(getPrevMonth('2026-04')).toBe('2026-03')
    expect(getPrevMonth('2026-03')).toBe('2026-02')
  })

  it('1월의 이전은 전년 12월', () => {
    expect(getPrevMonth('2026-01')).toBe('2025-12')
  })
})

describe('formatMonth', () => {
  it('한국어 형식으로 변환', () => {
    expect(formatMonth('2026-04')).toBe('2026년 4월')
    expect(formatMonth('2026-12')).toBe('2026년 12월')
  })
})

describe('getCurrentMonth', () => {
  afterEach(() => { vi.useRealTimers() })

  it('현재 월을 YYYY-MM 형식으로 반환', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 15))
    expect(getCurrentMonth()).toBe('2026-04')
    vi.useRealTimers()
  })
})

describe('getPaymentDueDay', () => {
  it('등록일의 일(day)을 반환한다', () => {
    const student = { enrollment_date: '2026-03-15' } as Student
    expect(getPaymentDueDay(student)).toBe(15)
  })

  it('1일 등록', () => {
    const student = { enrollment_date: '2026-01-01' } as Student
    expect(getPaymentDueDay(student)).toBe(1)
  })

  it('31일 등록', () => {
    const student = { enrollment_date: '2026-01-31' } as Student
    expect(getPaymentDueDay(student)).toBe(31)
  })
})

describe('getActiveStudents', () => {
  const students = [
    { id: '1', withdrawal_date: null },
    { id: '2', withdrawal_date: '2026-03-15' },
    { id: '3', withdrawal_date: '2026-04-20' },
    { id: '4', withdrawal_date: undefined },
  ]

  it('퇴원일 없는 학생만 반환 (month 미지정)', () => {
    const result = getActiveStudents(students)
    expect(result.map(s => s.id)).toEqual(['1', '4'])
  })

  it('해당 월에 퇴원한 학생도 포함', () => {
    const result = getActiveStudents(students, '2026-03')
    expect(result.map(s => s.id)).toEqual(['1', '2', '3', '4'])
  })

  it('이미 퇴원한 학생은 제외', () => {
    const result = getActiveStudents(students, '2026-04')
    expect(result.map(s => s.id)).toEqual(['1', '3', '4'])
  })
})

describe('decodePaymentMemo', () => {
  it('null/빈 메모', () => {
    expect(decodePaymentMemo(null)).toEqual({ cleanMemo: null, otherMethod: null })
    expect(decodePaymentMemo('')).toEqual({ cleanMemo: null, otherMethod: null })
  })

  it('일반 메모', () => {
    expect(decodePaymentMemo('수업료 할인')).toEqual({ cleanMemo: '수업료 할인', otherMethod: null })
  })

  it('기타 결제방법 태그 디코딩', () => {
    expect(decodePaymentMemo('[기타:토스]')).toEqual({ cleanMemo: null, otherMethod: '토스' })
    expect(decodePaymentMemo('[기타:토스] 2회분')).toEqual({ cleanMemo: '2회분', otherMethod: '토스' })
  })
})

describe('countClassDays', () => {
  it('특정 기간 내 수업 횟수를 센다', () => {
    // 2026-04-01(수) ~ 2026-04-30(목), 수요일(3)=4회, 금요일(5)=4회
    const start = new Date(2026, 3, 1)
    const end = new Date(2026, 3, 30)
    const count = countClassDays(start, end, [3, 5]) // 수, 금
    expect(count).toBeGreaterThanOrEqual(7)
    expect(count).toBeLessThanOrEqual(10)
  })

  it('빈 요일 배열이면 0', () => {
    const start = new Date(2026, 3, 1)
    const end = new Date(2026, 3, 30)
    expect(countClassDays(start, end, [])).toBe(0)
  })

  it('같은 날짜면 0', () => {
    const d = new Date(2026, 3, 1)
    expect(countClassDays(d, d, [1, 2, 3, 4, 5])).toBe(0)
  })
})

describe('parseClassDays', () => {
  it('쉼표 구분 문자열을 숫자 배열로', () => {
    expect(parseClassDays('1,3,5')).toEqual([1, 3, 5])
  })

  it('null/빈 문자열이면 null', () => {
    expect(parseClassDays(null)).toBeNull()
    expect(parseClassDays('')).toBeNull()
    expect(parseClassDays(undefined)).toBeNull()
  })

  it('공백 포함해도 파싱', () => {
    expect(parseClassDays(' 2 , 4 ')).toEqual([2, 4])
  })
})
