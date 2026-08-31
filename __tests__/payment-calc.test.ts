import { describe, it, expect } from 'vitest'
import { getStudentFee, getPaymentStatus } from '@/types'
import type { Student, Class } from '@/types'

const makeStudent = (overrides: Partial<Student> = {}): Student => ({
  id: 'test-1', class_id: 'cls-1', name: '테스트', enrollment_date: '2026-03-01', created_at: '',
  ...overrides,
})

const makeClass = (overrides: Partial<Class> = {}): Class => ({
  id: 'cls-1', grade_id: 'g-1', name: '수학A', monthly_fee: 300000, order_index: 0, created_at: '',
  ...overrides,
})

describe('getStudentFee', () => {
  it('반 기본 원비를 반환한다', () => {
    const student = makeStudent()
    const cls = makeClass({ monthly_fee: 300000 })
    expect(getStudentFee(student, cls)).toBe(300000)
  })

  it('개별 원비(custom_fee)가 있으면 그것을 우선한다', () => {
    const student = makeStudent({ custom_fee: 250000 })
    const cls = makeClass({ monthly_fee: 300000 })
    expect(getStudentFee(student, cls)).toBe(250000)
  })

  it('custom_fee가 0이면 0을 반환한다 (null과 다름)', () => {
    const student = makeStudent({ custom_fee: 0 })
    const cls = makeClass({ monthly_fee: 300000 })
    expect(getStudentFee(student, cls)).toBe(0)
  })

  it('반이 없으면 0을 반환한다', () => {
    const student = makeStudent()
    expect(getStudentFee(student, null)).toBe(0)
    expect(getStudentFee(student, undefined)).toBe(0)
  })
})

describe('getPaymentStatus', () => {
  it('전액 납부 → paid', () => {
    expect(getPaymentStatus(300000, 300000)).toBe('paid')
  })

  it('초과 납부 → paid', () => {
    expect(getPaymentStatus(350000, 300000)).toBe('paid')
  })

  it('부분 납부 → partial', () => {
    expect(getPaymentStatus(150000, 300000)).toBe('partial')
  })

  it('미납 → unpaid', () => {
    expect(getPaymentStatus(0, 300000)).toBe('unpaid')
  })

  it('원비가 0이면 → paid', () => {
    expect(getPaymentStatus(0, 0)).toBe('paid')
  })

  it('원비가 음수면 → paid', () => {
    expect(getPaymentStatus(0, -100)).toBe('paid')
  })
})
