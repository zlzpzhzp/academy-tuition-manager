import { describe, it, expect } from 'vitest'
import { isBatchExcluded, isBatchExcludedNoBill } from '@/lib/utils'

// '이 달만 일괄 제외' 판정 2종 — 배지와 반 헤더 분모가 같은 함수를 쓰게 통일한 커밋의 계약.
// 2026-08-05 실회귀: 배지만 '청구 있으면 상태 표시'로 바뀌고 분모는 무조건 제외로 남아,
// 제외월+개별청구+미납 학생이 빨간 미납인데 반은 완납으로 접혔다(정국). 이 테스트가 그 경계를 지킨다.
describe('isBatchExcluded (발송 제외 — 무조건)', () => {
  it('제외월과 같은 달이면 참', () => {
    expect(isBatchExcluded({ batch_exclude_month: '2026-08' }, '2026-08')).toBe(true)
  })
  it('다른 달이면 거짓 — 월이 지나면 자동 무효', () => {
    expect(isBatchExcluded({ batch_exclude_month: '2026-08' }, '2026-09')).toBe(false)
  })
  it('미지정(null/undefined)이면 거짓', () => {
    expect(isBatchExcluded({ batch_exclude_month: null }, '2026-08')).toBe(false)
    expect(isBatchExcluded({}, '2026-08')).toBe(false)
  })
})

describe('isBatchExcludedNoBill (화면 부재 — 청구 없을 때만)', () => {
  it('제외월 + 청구 없음 → 참 (회색 청구없음 + 분모 제외)', () => {
    expect(isBatchExcludedNoBill({ batch_exclude_month: '2026-08' }, '2026-08', false)).toBe(true)
  })
  it('제외월이어도 청구가 있으면 거짓 — 정국 회귀 케이스: 분모에 남고 실상태를 보여야 한다', () => {
    expect(isBatchExcludedNoBill({ batch_exclude_month: '2026-08' }, '2026-08', true)).toBe(false)
  })
  it('제외월이 아니면 청구 유무와 무관하게 거짓', () => {
    expect(isBatchExcludedNoBill({ batch_exclude_month: '2026-07' }, '2026-08', false)).toBe(false)
  })
})
