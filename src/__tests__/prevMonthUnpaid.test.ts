/**
 * '지난달 미납' 판정 회귀 (2026-08-27)
 *
 * - 카리나 건: 이월 차감 청구(스냅샷 35만 < 청구 181,000) 완납이 스냅샷 비교만으로 미납 오판.
 *   → 그 달 정규 청구가 존재하고 전부 종결(paid≥1·sent=0)이면 완납 취급.
 * - 같은 판정이 행 배지와 일괄청구 자동 제외(운영자님 지시)에 공용으로 쓰인다.
 */
import { describe, it, expect } from 'vitest'
import { buildBillSettledSet, judgePrevMonthUnpaid } from '@/lib/utils'

describe('buildBillSettledSet', () => {
  it('paid 1건 + sent 0건 = 종결 (카리나: 조정 청구 완납)', () => {
    const set = buildBillSettledSet([{ student_id: 'kdy', status: 'paid' }])
    expect(set.has('kdy')).toBe(true)
  })

  it('분할 미결(paid 1 + sent 1)은 종결 아님 — 잔여 청구가 살아 있다', () => {
    const set = buildBillSettledSet([
      { student_id: 's', status: 'paid' },
      { student_id: 's', status: 'sent' },
    ])
    expect(set.has('s')).toBe(false)
  })

  it('destroyed/cancelled만 있으면 종결 아님 — 낸 돈이 없다 (손흥민 상계·재청구 대기 유형)', () => {
    const set = buildBillSettledSet([
      { student_id: 'a', status: 'destroyed' },
      { student_id: 'b', status: 'cancelled' },
    ])
    expect(set.size).toBe(0)
  })

  it('특강 등 비정규(is_regular_tuition=false) 청구는 판정에서 제외', () => {
    const set = buildBillSettledSet([{ student_id: 's', status: 'paid', is_regular_tuition: false }])
    expect(set.has('s')).toBe(false)
  })
})

describe('judgePrevMonthUnpaid', () => {
  const active = { enrollment_date: '2026-03-01', withdrawal_date: null }

  it('🔴 카리나 케이스: 스냅샷 35만 > 납부 18.1만이어도 청구 종결이면 미납 아님', () => {
    expect(judgePrevMonthUnpaid(active, '2026-08', 350000, 181000, true)).toBe(false)
  })

  it('진짜 미납: 요금 > 납부 + 청구 미종결', () => {
    expect(judgePrevMonthUnpaid(active, '2026-08', 350000, 0, false)).toBe(true)
  })

  it('완납(납부 ≥ 요금)이면 종결 여부와 무관하게 미납 아님', () => {
    expect(judgePrevMonthUnpaid(active, '2026-08', 350000, 350000, false)).toBe(false)
  })

  it('요금 0(면제 학생)은 미납 아님', () => {
    expect(judgePrevMonthUnpaid(active, '2026-08', 0, 0, false)).toBe(false)
  })

  it('지난달에 아직 미등록이던 신입은 미납 아님 (등록월 이전 명단 제외 규칙과 동일 축)', () => {
    expect(judgePrevMonthUnpaid({ enrollment_date: '2026-09-01', withdrawal_date: null }, '2026-08', 350000, 0, false)).toBe(false)
  })

  it('지난달 이전에 퇴원한 학생은 미납 아님', () => {
    expect(judgePrevMonthUnpaid({ enrollment_date: '2026-03-01', withdrawal_date: '2026-07-10' }, '2026-08', 350000, 0, false)).toBe(false)
  })

  it('지난달 중 퇴원(그 달까지 재원)은 판정 대상', () => {
    expect(judgePrevMonthUnpaid({ enrollment_date: '2026-03-01', withdrawal_date: '2026-08-20' }, '2026-08', 350000, 0, false)).toBe(true)
  })
})
