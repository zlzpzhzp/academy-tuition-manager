// 뮤테이션 드릴 2026-08-14: 발송용 번호 정규화(M26)와 출결코드 중복 회피(M27)가 무보증이었다.
import { describe, it, expect } from 'vitest'
import { normalizePhone, pickAttendanceCode } from '@/lib/student-codes'

describe('normalizePhone', () => {
  it('하이픈뿐 아니라 공백·괄호·점 등 비숫자 전부 제거 — 하이픈만 지우면 발송 검증 422 재발(2026-07-22 사고)', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678')
    expect(normalizePhone('010 1234 5678')).toBe('01012345678')
    expect(normalizePhone('(010) 1234-5678')).toBe('01012345678')
    expect(normalizePhone('010.1234.5678')).toBe('01012345678')
  })
  it('null/undefined는 빈 문자열', () => {
    expect(normalizePhone(null)).toBe('')
    expect(normalizePhone(undefined)).toBe('')
  })
})

describe('pickAttendanceCode', () => {
  it('뒷4자리가 비어 있으면 그대로 배정', () => {
    expect(pickAttendanceCode('010-1234-5678', new Set())).toEqual({ code: '5678', conflict: 'none' })
  })
  it('뒷4자리 중복이면 가운데4자리로 회피 — 회피가 죽으면 두 학생이 같은 코드로 출결이 엉킨다', () => {
    expect(pickAttendanceCode('010-1234-5678', new Set(['5678']))).toEqual({ code: '1234', conflict: 'middle' })
  })
  it('둘 다 중복이면 뒷4자리 + both(사람 개입 신호)', () => {
    expect(pickAttendanceCode('010-1234-5678', new Set(['5678', '1234']))).toEqual({ code: '5678', conflict: 'both' })
  })
})
