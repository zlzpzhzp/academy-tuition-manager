import { describe, it, expect } from 'vitest'
import { parseClassDays, isScheduledDay } from '@/lib/attendanceDay'

describe('parseClassDays', () => {
  it('쉼표 구분 요일을 숫자 배열로', () => {
    expect(parseClassDays('1,6')).toEqual([1, 6])
    expect(parseClassDays('1, 3 ,5')).toEqual([1, 3, 5])
    expect(parseClassDays('0')).toEqual([0])
  })
  it('빈 값·잘못된 값은 버린다', () => {
    expect(parseClassDays(null)).toEqual([])
    expect(parseClassDays('')).toEqual([])
    expect(parseClassDays('7,-1,월,,3')).toEqual([3])
  })
})

describe('isScheduledDay', () => {
  it('수업일이면 true (수지 월·토 → 월요일)', () => {
    expect(isScheduledDay(['1,6'], 1)).toBe(true)
    expect(isScheduledDay(['1,6'], 6)).toBe(true)
  })
  it('수업일이 아니면 false (수지 월·토 → 수요일)', () => {
    expect(isScheduledDay(['1,6'], 3)).toBe(false)
  })
  it('두 과목 수강생은 어느 반 수업일이든 true', () => {
    expect(isScheduledDay(['1,6', '2,4'], 4)).toBe(true)
  })
  it('요일 정보가 없으면 null — 가드는 통과시켜야 한다(보강·자습 차단 금지)', () => {
    expect(isScheduledDay([], 3)).toBeNull()
    expect(isScheduledDay([null, undefined, ''], 3)).toBeNull()
  })
})
