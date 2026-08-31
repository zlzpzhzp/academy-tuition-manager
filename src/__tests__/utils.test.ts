import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  isPaymentScheduled,
  getPaymentDueDay,
  getPrevMonth,
  formatMonth,
  getCurrentMonth,
  getUnpaidLabelText,
  decodePaymentMemo,
} from '@/lib/utils'
import type { Student } from '@/types'

const mockStudent = (enrollmentDate: string): Student => ({
  id: 'test-1',
  class_id: 'class-1',
  name: 'Test Student',
  enrollment_date: enrollmentDate,
  created_at: '2024-01-01',
})

describe('getPaymentDueDay', () => {
  it('returns the day of enrollment date', () => {
    expect(getPaymentDueDay(mockStudent('2024-01-15'))).toBe(15)
    expect(getPaymentDueDay(mockStudent('2024-03-01'))).toBe(1)
    expect(getPaymentDueDay(mockStudent('2024-12-31'))).toBe(31)
  })
})

describe('getPrevMonth', () => {
  it('returns previous month', () => {
    expect(getPrevMonth('2024-03')).toBe('2024-02')
    expect(getPrevMonth('2024-01')).toBe('2023-12')
    expect(getPrevMonth('2025-07')).toBe('2025-06')
  })
})

describe('formatMonth', () => {
  it('formats month string to Korean', () => {
    expect(formatMonth('2024-03')).toBe('2024년 3월')
    expect(formatMonth('2024-12')).toBe('2024년 12월')
    expect(formatMonth('2025-01')).toBe('2025년 1월')
  })
})

describe('getCurrentMonth', () => {
  it('returns current month in YYYY-MM format', () => {
    const result = getCurrentMonth()
    expect(result).toMatch(/^\d{4}-\d{2}$/)
  })
})

describe('decodePaymentMemo', () => {
  it('returns null for empty input', () => {
    expect(decodePaymentMemo(null)).toEqual({ cleanMemo: null, otherMethod: null })
    expect(decodePaymentMemo(undefined)).toEqual({ cleanMemo: null, otherMethod: null })
    expect(decodePaymentMemo('')).toEqual({ cleanMemo: null, otherMethod: null })
  })

  it('decodes tagged memo', () => {
    expect(decodePaymentMemo('[기타:서울페이]')).toEqual({
      cleanMemo: null,
      otherMethod: '서울페이',
    })
  })

  it('preserves remaining memo after tag', () => {
    expect(decodePaymentMemo('[기타:서울페이]추가 메모')).toEqual({
      cleanMemo: '추가 메모',
      otherMethod: '서울페이',
    })
  })

  it('returns normal memo without tag', () => {
    expect(decodePaymentMemo('일반 메모')).toEqual({
      cleanMemo: '일반 메모',
      otherMethod: null,
    })
  })
})

describe('getUnpaidLabelText', () => {
  it('returns formatted label with scheduled for future month', () => {
    const result = getUnpaidLabelText(mockStudent('2024-01-15'), '2099-03')
    expect(result).toBe('3/15 예정')
  })

  it('respects override due day', () => {
    const result = getUnpaidLabelText(mockStudent('2024-01-15'), '2099-05', 20)
    expect(result).toBe('5/20 예정')
  })
})

// 뮤테이션 드릴 2026-08-14: 예정/미납 경계 3곳이 무보증이었다(M13·M14·M15 생존).
// 경계가 한 칸 밀리면 미납자가 목록에서 빠지거나(조용한 누락) 이번 달 전체가 미납으로 굳는다.
describe('isPaymentScheduled 경계', () => {
  afterEach(() => { vi.useRealTimers() })
  const stu = mockStudent('2024-01-15')

  it('이번 달 + 결제일 전 = 예정(true) — 지난달 판정(<)이 이번 달(<=)까지 삼키면 안 된다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 5)) // 2026-08-05
    expect(isPaymentScheduled(stu, '2026-08', 20)).toBe(true)
  })

  it('결제일 당일 = 미납(false) — 당일까지 예정이면 미납 전환이 하루 늦는다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 20)) // 결제일 당일
    expect(isPaymentScheduled(stu, '2026-08', 20)).toBe(false)
  })

  it('지난달은 항상 미납(false), 다음달은 항상 예정(true)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 5))
    expect(isPaymentScheduled(stu, '2026-07', 20)).toBe(false)
    expect(isPaymentScheduled(stu, '2026-09', 1)).toBe(true)
  })

  it('결제일 29~31은 그 달 말일로 클램프 — 2월 말일에 미납으로 전환돼야 한다(고정 31이면 영원히 예정)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 1, 28)) // 2026-02-28 = 2월 말일(평년)
    expect(isPaymentScheduled(stu, '2026-02', 31)).toBe(false)
  })
})

// ─── todaysSubjectsLabel (2026-08-31 두 과목 출결 구분) ──────────────
import { todaysSubjectsLabel } from '@/lib/format'
import { describe as d2, it as it2, expect as ex2 } from 'vitest'

d2('todaysSubjectsLabel', () => {
  const math = { subject: '수학', classDays: '1,5' }   // 월금
  const eng = { subject: '영어', classDays: '1,6' }    // 월토
  it2('겹치는 요일(월)은 수학 우선 병기', () => {
    ex2(todaysSubjectsLabel([eng, math], 1)).toBe('수학·영어')
  })
  it2('영어만 있는 요일(토)', () => {
    ex2(todaysSubjectsLabel([math, eng], 6)).toBe('영어')
  })
  it2('수학만 있는 요일(금)', () => {
    ex2(todaysSubjectsLabel([math, eng], 5)).toBe('수학')
  })
  it2('둘 다 수업 없는 요일(일)은 null', () => {
    ex2(todaysSubjectsLabel([math, eng], 0)).toBeNull()
  })
  it2('1과목 수강생은 항상 null (구분 표기 대상 아님)', () => {
    ex2(todaysSubjectsLabel([math], 1)).toBeNull()
  })
  it2('class_days 비어 있으면 그 과목은 제외', () => {
    ex2(todaysSubjectsLabel([{ subject: '수학', classDays: null }, eng], 6)).toBe('영어')
  })
})
