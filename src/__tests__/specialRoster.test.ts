import { describe, expect, it } from 'vitest'
import { isSpecialTarget } from '@/lib/specialRoster'

describe('특강 시작 시점 재원생 판정', () => {
  it.each([
    ['시작 전 등록', '2026-07-22', true],
    ['시작 당일 등록', '2026-07-23', true],
    ['시작 후 등록', '2026-07-24', false],
    ['등록일 null', null, true],
    ['등록일 누락', undefined, true],
    ['등록일 빈 값', '', true],
  ])('%s', (_, enrollment_date, expected) => {
    expect(isSpecialTarget({ enrollment_date }, '2026-07-23')).toBe(expected)
  })

  it.each([
    ['시작 전 퇴원', '2026-07-22', false],
    ['시작 당일 퇴원', '2026-07-23', false],
    ['시작 다음 날 퇴원', '2026-07-24', true],
    ['퇴원일 없음', null, true],
  ])('기존 경계: %s', (_, withdrawal_date, expected) => {
    expect(isSpecialTarget({ enrollment_date: '2026-07-01', withdrawal_date }, '2026-07-23')).toBe(expected)
  })

  it.each([undefined, null, ''])('시작일 %s이면 기존 7/23으로 폴백', periodStart => {
    expect(isSpecialTarget({ enrollment_date: '2026-07-23' }, periodStart)).toBe(true)
    expect(isSpecialTarget({ enrollment_date: '2026-07-24' }, periodStart)).toBe(false)
    expect(isSpecialTarget({ withdrawal_date: '2026-07-23' }, periodStart)).toBe(false)
    expect(isSpecialTarget({ withdrawal_date: '2026-07-24' }, periodStart)).toBe(true)
  })

  it('겨울 행의 시작일로 등록·퇴원 경계를 함께 이동한다', () => {
    expect(isSpecialTarget({ enrollment_date: '2027-01-05' }, '2027-01-05')).toBe(true)
    expect(isSpecialTarget({ enrollment_date: '2027-01-06' }, '2027-01-05')).toBe(false)
    expect(isSpecialTarget({ withdrawal_date: '2027-01-05' }, '2027-01-05')).toBe(false)
    expect(isSpecialTarget({ withdrawal_date: '2027-01-06' }, '2027-01-05')).toBe(true)
  })

  it('시작 후 등록자는 이후 퇴원 여부와 관계없이 제외한다', () => {
    expect(isSpecialTarget({ enrollment_date: '2026-08-07', withdrawal_date: '2026-08-23' }, '2026-07-23')).toBe(false)
  })
})
