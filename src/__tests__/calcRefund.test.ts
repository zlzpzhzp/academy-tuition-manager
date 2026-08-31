import { describe, it, expect } from 'vitest'
import { calcRefund } from '@/types'

describe('calcRefund', () => {
  it('should calculate day-based refund when no class days', () => {
    const enrollment = new Date(2024, 0, 15)
    const withdrawal = new Date(2024, 0, 25)
    const result = calcRefund(300000, enrollment, withdrawal)
    expect(result.isSessionBased).toBe(false)
    expect(result.totalSessions).toBeGreaterThan(0)
    expect(result.refundAmount).toBeGreaterThan(0)
    expect(result.refundAmount).toBeLessThan(300000)
  })

  it('should calculate session-based refund when class days provided', () => {
    const enrollment = new Date(2024, 0, 1)
    const withdrawal = new Date(2024, 0, 15)
    const result = calcRefund(400000, enrollment, withdrawal, '1,3,5')
    expect(result.isSessionBased).toBe(true)
    expect(result.totalSessions).toBeGreaterThan(0)
    expect(result.elapsedSessions).toBeGreaterThan(0)
    expect(result.remainingSessions).toBeGreaterThanOrEqual(0)
  })

  it('should return 0 refund when fee is 0', () => {
    const result = calcRefund(0, new Date(2024, 0, 1), new Date(2024, 0, 15))
    expect(result.refundAmount).toBe(0)
  })

  it('should return full fee when withdrawal is at period start', () => {
    const enrollment = new Date(2024, 0, 1)
    const withdrawal = new Date(2024, 0, 1)
    const result = calcRefund(300000, enrollment, withdrawal)
    expect(result.refundAmount).toBe(300000)
  })

  it('should handle null class_days', () => {
    const result = calcRefund(200000, new Date(2024, 0, 1), new Date(2024, 0, 15), null)
    expect(result.isSessionBased).toBe(false)
  })

  it('should handle empty class_days', () => {
    const result = calcRefund(200000, new Date(2024, 0, 1), new Date(2024, 0, 15), '')
    expect(result.isSessionBased).toBe(false)
  })
})

// 2026-08-13 라인리뷰: 기존 케이스는 범위(0 < refund < fee)만 검증해 일할계산이 틀려도
// 통과했다 — 학부모 환불액 경로라 기대값을 못박는다.
describe('calcRefund — 기대값 고정 (일할계산 회귀)', () => {
  it('수업 횟수 기반: 월수금 반, 1/1 시작 1/15 퇴원 → 14회 중 6회 수강, 환불 228,571원', () => {
    const r = calcRefund(400000, new Date(2024, 0, 1), new Date(2024, 0, 15), '1,3,5')
    expect(r.totalSessions).toBe(14)     // 2024-01 월5 수5 금4
    expect(r.elapsedSessions).toBe(6)    // 퇴원일 당일(1/15 월) 미수강
    expect(r.remainingSessions).toBe(8)
    expect(r.refundAmount).toBe(Math.round(400000 * 8 / 14)) // 228,571
  })

  it('일수 기반: 1/15 시작 1/25 퇴원 → 31일 중 10일 경과, 환불 203,226원', () => {
    const r = calcRefund(300000, new Date(2024, 0, 15), new Date(2024, 0, 25))
    expect(r.totalSessions).toBe(31)
    expect(r.elapsedSessions).toBe(10)
    expect(r.refundAmount).toBe(Math.round(300000 * 21 / 31)) // 203,226
  })

  it('결제일 31 클램프: 3/15 퇴원이면 기간이 2/29(윤년 말일)~3/31로 잡힌다', () => {
    const r = calcRefund(310000, new Date(2024, 0, 5), new Date(2024, 2, 15), null, 31)
    expect(r.totalSessions).toBe(31)   // 2/29 ~ 3/31
    expect(r.elapsedSessions).toBe(15) // 2/29 ~ 3/15
    expect(r.refundAmount).toBe(Math.round(310000 * 16 / 31))
  })
})

// 뮤테이션 드릴 2026-08-14 M08: remainingSessions 하한(Math.max 0)은 공개 API로는 도달 불가한
// 방어적 가드였다(2025~2027 전일 × 결제일 0~31 × 요일조합 6종 = 21만 케이스 스윕에서 뮤턴트도
// 음수 0건 = 등가 뮤턴트). 아래는 그 불변식을 그물로 남기는 것 — 기간 산정 로직이 바뀌어
// 하한이 실제로 필요해지는 날, 이 스윕이 잡는다.
describe('calcRefund 불변식(잔여 회차·환불액 음수 금지)', () => {
  it('넓은 입력 그리드에서 remainingSessions>=0, 0<=refundAmount<=fee', () => {
    const enroll = new Date(2024, 2, 15)
    for (let y = 2026; y <= 2027; y++) {
      for (let m = 0; m < 12; m++) {
        const lastD = new Date(y, m + 1, 0).getDate()
        for (const d of [1, 14, lastD]) {
          for (const cd of ['1', '2,6', '0,3,5', null]) {
            for (const due of [null, 1, 15, 28, 29, 31]) {
              const r = calcRefund(350000, enroll, new Date(y, m, d), cd, due)
              expect(r.remainingSessions).toBeGreaterThanOrEqual(0)
              expect(r.refundAmount).toBeGreaterThanOrEqual(0)
              expect(r.refundAmount).toBeLessThanOrEqual(350000)
            }
          }
        }
      }
    }
  })
})
