import { describe, it, expect } from 'vitest'
// 2026-08-13 라인리뷰: 이 테스트는 파일 안 복제본을 검증하고 있었다(프로덕션 2벌 하드코딩과
// 3벌 독립 = 돈 경로 무검증). 프로덕션이 실제로 쓰는 @/lib/salary 를 물도록 교체.
import { calcTeacherPay as calcLib } from '@/lib/salary'

function calcTeacherPay(params: { paidByStudents: number; payRatio: number; bonus: number }) {
  const { share, gross, tax, net } = calcLib(params.paidByStudents, params.payRatio, params.bonus)
  return { share, bonus: params.bonus, gross, tax, net }
}

describe('급여 계산', () => {
  it('기본 급여 계산 (40% 비율, 보너스 없음)', () => {
    const result = calcTeacherPay({ paidByStudents: 1000000, payRatio: 40, bonus: 0 })
    expect(result.share).toBe(400000)
    expect(result.gross).toBe(400000)
    expect(result.tax).toBe(Math.round(400000 * 0.033)) // 13200
    expect(result.net).toBe(400000 - 13200)             // 386800
  })

  it('보너스 포함 급여', () => {
    const result = calcTeacherPay({ paidByStudents: 1000000, payRatio: 40, bonus: 100000 })
    expect(result.share).toBe(400000)
    expect(result.gross).toBe(500000)
    expect(result.tax).toBe(Math.round(500000 * 0.033)) // 16500
    expect(result.net).toBe(500000 - 16500)             // 483500
  })

  it('50% 비율', () => {
    const result = calcTeacherPay({ paidByStudents: 2000000, payRatio: 50, bonus: 0 })
    expect(result.share).toBe(1000000)
    expect(result.net).toBe(1000000 - Math.round(1000000 * 0.033))
  })

  it('납부액 0이면 급여도 0', () => {
    const result = calcTeacherPay({ paidByStudents: 0, payRatio: 40, bonus: 0 })
    expect(result.share).toBe(0)
    expect(result.gross).toBe(0)
    expect(result.tax).toBe(0)
    expect(result.net).toBe(0)
  })

  it('세금은 세전 총액(share+bonus)의 3.3%', () => {
    const result = calcTeacherPay({ paidByStudents: 3000000, payRatio: 40, bonus: 50000 })
    expect(result.tax).toBe(Math.round((1200000 + 50000) * 0.033))
  })

  it('반올림 처리 확인', () => {
    // 333333 * 0.033 = 10999.989 → Math.round → 11000
    const result = calcTeacherPay({ paidByStudents: 333333, payRatio: 100, bonus: 0 })
    expect(result.tax).toBe(Math.round(333333 * 0.033))
  })
})

describe('손익 계산', () => {
  it('총 수입 - 총 지출 = 순이익', () => {
    const totalRevenue = 5000000
    const teacherPay = 1500000
    const teacherTax = 50000
    const fixedExpenses = 800000
    const variableExpenses = 200000
    const totalExpense = teacherPay + teacherTax + fixedExpenses + variableExpenses
    const profit = totalRevenue - totalExpense

    expect(profit).toBe(5000000 - 2550000)
    expect(profit).toBe(2450000)
  })

  it('지출이 수입보다 크면 적자', () => {
    const profit = 1000000 - 1500000
    expect(profit).toBeLessThan(0)
  })
})
