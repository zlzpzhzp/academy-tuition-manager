import { describe, it, expect } from 'vitest'
import { getStudentFee, getPaymentStatus, countClassDays, parseClassDays } from '@/types'
import type { Student, Class } from '@/types'

describe('getStudentFee', () => {
  it('returns custom fee when set', () => {
    const student = { custom_fee: 50000 } as Student
    const cls = { monthly_fee: 100000 } as Class
    expect(getStudentFee(student, cls)).toBe(50000)
  })

  it('returns class fee when no custom fee', () => {
    const student = { custom_fee: null } as Student
    const cls = { monthly_fee: 100000 } as Class
    expect(getStudentFee(student, cls)).toBe(100000)
  })

  it('returns 0 when no class', () => {
    const student = { custom_fee: undefined } as unknown as Student
    expect(getStudentFee(student, null)).toBe(0)
  })
})

describe('getPaymentStatus', () => {
  it('returns paid when fully paid', () => {
    expect(getPaymentStatus(100000, 100000)).toBe('paid')
    expect(getPaymentStatus(150000, 100000)).toBe('paid')
  })

  it('returns partial when partially paid', () => {
    expect(getPaymentStatus(50000, 100000)).toBe('partial')
  })

  it('returns unpaid when nothing paid', () => {
    expect(getPaymentStatus(0, 100000)).toBe('unpaid')
  })

  it('returns paid when fee is 0', () => {
    expect(getPaymentStatus(0, 0)).toBe('paid')
  })
})

describe('countClassDays', () => {
  it('counts specific days of week', () => {
    // Jan 1, 2024 is Monday (day 1)
    const start = new Date(2024, 0, 1)
    const end = new Date(2024, 0, 8) // exclusive
    // Mon Jan 1, Wed Jan 3, Fri Jan 5 = 3
    expect(countClassDays(start, end, [1, 3, 5])).toBe(3)
  })

  it('returns 0 for empty days', () => {
    const start = new Date(2024, 0, 1)
    const end = new Date(2024, 0, 31)
    expect(countClassDays(start, end, [])).toBe(0)
  })
})

describe('parseClassDays', () => {
  it('parses comma-separated day numbers', () => {
    expect(parseClassDays('1,3,5')).toEqual([1, 3, 5])
    expect(parseClassDays('2, 4')).toEqual([2, 4])
  })

  it('returns null for empty input', () => {
    expect(parseClassDays(null)).toBeNull()
    expect(parseClassDays(undefined)).toBeNull()
    expect(parseClassDays('')).toBeNull()
  })

  it('filters out NaN values', () => {
    expect(parseClassDays('1,abc,3')).toEqual([1, 3])
  })
})
