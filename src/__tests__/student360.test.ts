import { describe, it, expect } from 'vitest'
import {
  formatKstDate,
  formatDmSchedule,
  formatProgressItem,
  isAmbiguousName,
  isUuid,
  memoSnippet,
  qaNameCandidates,
  sanitizeIlikeName,
  schoolExamLabel,
  isMissingSchemaError,
} from '@/lib/student360'

describe('student360 헬퍼', () => {
  it('isUuid — uuid 만 통과 (비uuid 는 라우트에서 400, Postgres 22P02 500 방지)', () => {
    expect(isUuid('a297018e-0000-4000-8000-000000000000')).toBe(true)
    expect(isUuid('A297018E-0000-4000-8000-000000000000')).toBe(true)
    expect(isUuid('a297018e')).toBe(false)
    expect(isUuid("' or 1=1--")).toBe(false)
    expect(isUuid(null)).toBe(false)
  })

  it('formatKstDate — date(타임존 없음)는 변환하지 않고 그대로 읽는다', () => {
    // 🔴 여기서 UTC 변환하면 하루 밀린다(전앱 룰). enrollment_date 같은 date 컬럼이 이 경로.
    expect(formatKstDate('2026-08-21')).toBe('2026.8.21')
    expect(formatKstDate('2026-08-21T23:30:00')).toBe('2026.8.21')
  })

  it('formatKstDate — timestamptz 는 KST 벽시계로 (UTC 늦은 밤 = KST 다음날)', () => {
    expect(formatKstDate('2026-08-20T23:00:00+00:00')).toBe('2026.8.21')
    expect(formatKstDate('2026-08-20T23:00:00Z')).toBe('2026.8.21')
    expect(formatKstDate('2026-08-20T09:00:00+09:00')).toBe('2026.8.20')
    expect(formatKstDate(null)).toBe('-')
    expect(formatKstDate('알수없음')).toBe('알수없음')
  })

  it('qaNameCandidates — 이름+별칭 트림·중복 제거, 빈 값 제외', () => {
    expect(qaNameCandidates(' 손흥민 ', ['손흥민', '홍 준우', ''])).toEqual(['손흥민', '홍 준우'])
    expect(qaNameCandidates(null, [])).toEqual([])
  })

  it('isAmbiguousName — 같은 이름에 학부모번호 2종 이상이면 동명이인', () => {
    expect(isAmbiguousName(['010-1', '010-1', null])).toBe(false)
    expect(isAmbiguousName(['010-1', '010-2'])).toBe(true)
    expect(isAmbiguousName([null, ''])).toBe(false)
  })

  it('formatProgressItem — 교재+표기, 폴백 p./번', () => {
    expect(formatProgressItem({ t: '자이스토리', label: 'B165' })).toBe('자이스토리 B165')
    expect(formatProgressItem({ t: '쎈', p: 42 })).toBe('쎈 p.42')
    expect(formatProgressItem({ n: 7 })).toBe('7번')
    expect(formatProgressItem({})).toBe('-')
    expect(formatProgressItem(null)).toBe('-')
  })

  it('formatDmSchedule — jsonb {days:[2,4,6]} → 화·목·토', () => {
    expect(formatDmSchedule({ days: [2, 4, 6] })).toBe('화·목·토')
    expect(formatDmSchedule({ days: [] })).toBeNull()
    expect(formatDmSchedule(null)).toBeNull()
    expect(formatDmSchedule({ days: [9] })).toBeNull()
  })

  it('schoolExamLabel / memoSnippet / sanitizeIlikeName', () => {
    expect(schoolExamLabel(2026, 1, '중간고사')).toBe('2026년 1학기 중간고사')
    expect(schoolExamLabel(null, null, null)).toBe('-')
    expect(memoSnippet('  줄\n바꿈   정리 ')).toBe('줄 바꿈 정리')
    expect(memoSnippet('가'.repeat(200)).endsWith('…')).toBe(true)
    // PostgREST or() 예약문자·ilike 와일드카드 제거 (필터 구문 깨짐·전체매칭 방지)
    expect(sanitizeIlikeName('박%보_검,(A)')).toBe('박보검A')
  })

  it('isMissingSchemaError — 스키마 결손은 500 이 아니라 미연결로 강등', () => {
    expect(isMissingSchemaError({ code: 'PGRST205' })).toBe(true)
    expect(isMissingSchemaError({ code: '42703' })).toBe(true)
    expect(isMissingSchemaError({ message: 'relation "x" does not exist' })).toBe(true)
    expect(isMissingSchemaError({ code: '08006', message: 'connection failure' })).toBe(false)
    expect(isMissingSchemaError(null)).toBe(false)
  })
})
