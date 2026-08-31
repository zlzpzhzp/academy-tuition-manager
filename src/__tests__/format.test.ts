import { describe, it, expect } from 'vitest'
import { formatWon, formatWonShort, formatNumber, formatClassName } from '@/lib/format'

describe('formatWon', () => {
  it('정상 숫자에 콤마 + 원 단위 붙임', () => {
    expect(formatWon(350000)).toBe('350,000원')
    expect(formatWon(1000)).toBe('1,000원')
    expect(formatWon(0)).toBe('0원')
  })

  it('null/undefined → 0원', () => {
    expect(formatWon(null)).toBe('0원')
    expect(formatWon(undefined)).toBe('0원')
  })

  it('큰 숫자도 정확하게', () => {
    expect(formatWon(33870000)).toBe('33,870,000원')
    expect(formatWon(123456789)).toBe('123,456,789원')
  })

  it('음수도 정상 처리', () => {
    expect(formatWon(-50000)).toBe('-50,000원')
  })
})

describe('formatWonShort', () => {
  it('만 단위 미만은 그대로', () => {
    expect(formatWonShort(0)).toBe('0원')
    expect(formatWonShort(5000)).toBe('5,000원')
    expect(formatWonShort(9999)).toBe('9,999원')
  })

  it('만 단위는 만원으로', () => {
    expect(formatWonShort(10000)).toBe('1만원')
    expect(formatWonShort(350000)).toBe('35만원')
    expect(formatWonShort(33870000)).toBe('3,387만원')
  })

  it('억 단위는 억원으로 (소수 1자리, 정수면 자리 생략)', () => {
    expect(formatWonShort(100000000)).toBe('1억원')
    expect(formatWonShort(120000000)).toBe('1.2억원')
    expect(formatWonShort(550000000)).toBe('5.5억원')
  })

  it('음수도 처리', () => {
    expect(formatWonShort(-350000)).toBe('-35만원')
    expect(formatWonShort(-100000000)).toBe('-1억원')
  })

  it('null/undefined → 0원', () => {
    expect(formatWonShort(null)).toBe('0원')
    expect(formatWonShort(undefined)).toBe('0원')
  })
})

describe('formatClassName', () => {
  it('subject 있으면 과목+반이름 붙여쓰기', () => {
    expect(formatClassName({ name: 'H', subject: '수학' })).toBe('수학H')
    expect(formatClassName({ name: 'A', subject: '영어' })).toBe('영어A')
  })

  it('subject 없으면 반 이름만', () => {
    expect(formatClassName({ name: 'K', subject: null })).toBe('K')
    expect(formatClassName({ name: 'K' })).toBe('K')
  })

  it('이미 과목으로 시작하면 중복 안 붙임', () => {
    expect(formatClassName({ name: '수학H', subject: '수학' })).toBe('수학H')
  })

  it('반 이름 없으면 빈 문자열', () => {
    expect(formatClassName({ name: null, subject: '수학' })).toBe('')
    expect(formatClassName({ name: '', subject: '수학' })).toBe('')
    expect(formatClassName(null)).toBe('')
    expect(formatClassName(undefined)).toBe('')
  })
})

describe('formatNumber', () => {
  it('단위 없이 콤마만', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(1000)).toBe('1,000')
    expect(formatNumber(123456)).toBe('123,456')
  })

  it('null/undefined → 0', () => {
    expect(formatNumber(null)).toBe('0')
    expect(formatNumber(undefined)).toBe('0')
  })
})
