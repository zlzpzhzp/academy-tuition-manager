import { describe, it, expect } from 'vitest'
import { getRegularTuitionTitle, getElectivesTuitionTitle } from '@/lib/billing-title'
import { ACADEMY_NAME } from '@/lib/branding'

describe('getRegularTuitionTitle', () => {
  it('선택과목 없으면 기본 제목만', () => {
    expect(getRegularTuitionTitle('수학', '2026-07', 'N', null)).toBe(`${ACADEMY_NAME} 수학 N 7월 정규원비`)
    expect(getRegularTuitionTitle('수학', '2026-07', 'N', [])).toBe(`${ACADEMY_NAME} 수학 N 7월 정규원비`)
  })

  it('선택과목 있으면(합산 단일청구) "+과목" 표기', () => {
    expect(getRegularTuitionTitle('수학', '2026-07', 'N', ['확통'])).toBe(`${ACADEMY_NAME} 수학 N 7월 정규원비 + 확통`)
  })

  // 2026-07-10 msg 3551: 분리발송(정규/선택 별건)의 정규 건은 호출부가 electives를
  // null/[]로 넘겨 "+확통"이 붙지 않아야 한다 — 위 계약(null/[] → 기본 제목)이 그 근거.
  it('분리발송 정규 건 계약: null 전달 시 선택과목 미표기', () => {
    expect(getRegularTuitionTitle('수학', '2026-07', 'N', null)).not.toContain('+')
  })
})

describe('getElectivesTuitionTitle', () => {
  it('선택과목 건 제목', () => {
    expect(getElectivesTuitionTitle('2026-07', ['확통'])).toBe(`${ACADEMY_NAME} 7월 선택과목 (확통)`)
  })
})
