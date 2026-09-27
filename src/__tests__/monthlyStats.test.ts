/**
 * 월별 매출 추이 집계 회귀 (2026-09-03)
 *
 * 지키려는 것:
 * - 데이터 없는 달도 0으로 채워 나온다(차트 x축이 끊기면 "그 달 매출 0"과 구분이 안 됨)
 * - 특강 납부월은 **KST 기준** 버킷 — UTC 그대로 자르면 월말 밤 결제가 전월로 샌다
 * - 반 미배정 학생은 사라지지 않고 '미배정'으로 잡힌다(합계가 조용히 줄어드는 것 방지)
 */
import { describe, it, expect } from 'vitest'
import {
  aggregateMonthlyStats,
  monthRange,
  addMonths,
  isValidMonth,
  kstMonthOf,
  UNASSIGNED_LABEL,
  type AggregateInput,
} from '@/lib/monthlyStats'

const base: AggregateInput = {
  from: '2026-07',
  to: '2026-09',
  snapshots: [],
  payments: [],
  specials: [],
  students: [],
  classes: [],
  teachers: [],
}

describe('monthRange / addMonths / isValidMonth', () => {
  it('from~to 포함 오름차순', () => {
    expect(monthRange('2026-07', '2026-09')).toEqual(['2026-07', '2026-08', '2026-09'])
  })

  it('같은 달이면 1개', () => {
    expect(monthRange('2026-03', '2026-03')).toEqual(['2026-03'])
  })

  it('from > to 면 빈 배열', () => {
    expect(monthRange('2026-09', '2026-03')).toEqual([])
  })

  it('연도 경계를 넘는다', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })

  it('addMonths 는 음수·연도 경계 모두 처리', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-09', -11)).toBe('2025-10')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
  })

  it('isValidMonth 는 13월·문자열을 거른다', () => {
    expect(isValidMonth('2026-09')).toBe(true)
    expect(isValidMonth('2026-13')).toBe(false)
    expect(isValidMonth('2026-00')).toBe(false)
    expect(isValidMonth('202609')).toBe(false)
    expect(isValidMonth('abcd-ef')).toBe(false)
  })
})

describe('kstMonthOf', () => {
  it('date 컬럼(YYYY-MM-DD)은 그대로 자른다', () => {
    expect(kstMonthOf('2026-07-31')).toBe('2026-07')
  })

  it('🔴 UTC 월말 밤 타임스탬프는 KST 다음 달로 (2026-07-31T15:30:00Z = KST 8/1 00:30)', () => {
    expect(kstMonthOf('2026-07-31T15:30:00Z')).toBe('2026-08')
  })

  it('UTC 월말 낮은 같은 달 유지 (KST 7/31 21:00)', () => {
    expect(kstMonthOf('2026-07-31T12:00:00Z')).toBe('2026-07')
  })

  it('null/빈값/파싱불가는 null', () => {
    expect(kstMonthOf(null)).toBeNull()
    expect(kstMonthOf('')).toBeNull()
    expect(kstMonthOf('nope')).toBeNull()
  })
})

describe('aggregateMonthlyStats — 범위 채움', () => {
  it('데이터 없는 달도 0으로 채워 오름차순 반환', () => {
    const out = aggregateMonthlyStats({
      ...base,
      payments: [{ student_id: 's1', amount: 350000, billing_month: '2026-08', method: 'card' }],
    })
    expect(out.map(m => m.month)).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(out[0]).toMatchObject({ month: '2026-07', paid: 0, fee: 0, special: 0, studentCount: 0, paidCount: 0 })
    expect(out[0].byTeacher).toEqual([])
    expect(out[1].paid).toBe(350000)
  })

  it('범위 밖 데이터는 무시', () => {
    const out = aggregateMonthlyStats({
      ...base,
      payments: [{ student_id: 's1', amount: 999, billing_month: '2026-05', method: 'card' }],
      snapshots: [{ student_id: 's1', month: '2026-05', fee: 999 }],
    })
    expect(out.every(m => m.paid === 0 && m.fee === 0)).toBe(true)
  })

  it('from > to 면 빈 배열', () => {
    expect(aggregateMonthlyStats({ ...base, from: '2026-09', to: '2026-07' })).toEqual([])
  })
})

describe('aggregateMonthlyStats — 합계와 인원', () => {
  const input: AggregateInput = {
    ...base,
    from: '2026-08',
    to: '2026-08',
    snapshots: [
      { student_id: 's1', month: '2026-08', fee: 350000 },
      { student_id: 's2', month: '2026-08', fee: 400000 },
      { student_id: 's3', month: '2026-08', fee: 0 },
    ],
    payments: [
      // s1 분할 납부 2건 — paidCount 는 학생 단위로 1명이어야 한다
      { student_id: 's1', amount: 200000, billing_month: '2026-08', method: 'payssam' },
      { student_id: 's1', amount: 150000, billing_month: '2026-08', method: 'transfer' },
      { student_id: 's2', amount: 400000, billing_month: '2026-08', method: 'payssam' },
    ],
  }

  it('fee 는 스냅샷 합, studentCount 는 스냅샷 학생 수', () => {
    const [m] = aggregateMonthlyStats(input)
    expect(m.fee).toBe(750000)
    expect(m.studentCount).toBe(3)
  })

  it('paid 합계와 중복 제거된 paidCount', () => {
    const [m] = aggregateMonthlyStats(input)
    expect(m.paid).toBe(750000)
    expect(m.paidCount).toBe(2)
  })

  it('byMethod 는 결제수단별 합', () => {
    const [m] = aggregateMonthlyStats(input)
    expect(m.byMethod).toEqual({ payssam: 600000, transfer: 150000 })
  })

  it('method 가 비면 other 로 모은다', () => {
    const [m] = aggregateMonthlyStats({
      ...input,
      payments: [{ student_id: 's1', amount: 100, billing_month: '2026-08', method: null }],
    })
    expect(m.byMethod).toEqual({ other: 100 })
  })
})

describe('aggregateMonthlyStats — 특강 KST 버킷', () => {
  it('paid_at(date)로 그 달에 들어간다', () => {
    const out = aggregateMonthlyStats({
      ...base,
      specials: [{ amount: 200000, paid_at: '2026-07-09' }],
    })
    expect(out.find(m => m.month === '2026-07')!.special).toBe(200000)
    expect(out.find(m => m.month === '2026-08')!.special).toBe(0)
  })

  it('🔴 UTC 월말 밤(2026-07-31T15:30:00Z)은 KST 8월로 버킷', () => {
    const out = aggregateMonthlyStats({
      ...base,
      specials: [{ amount: 100000, paid_at: '2026-07-31T15:30:00Z' }],
    })
    expect(out.find(m => m.month === '2026-07')!.special).toBe(0)
    expect(out.find(m => m.month === '2026-08')!.special).toBe(100000)
  })

  it('paid_at 이 null 이면 created_at 으로 폴백', () => {
    const out = aggregateMonthlyStats({
      ...base,
      specials: [{ amount: 50000, paid_at: null, created_at: '2026-09-02T01:00:00Z' }],
    })
    expect(out.find(m => m.month === '2026-09')!.special).toBe(50000)
  })

  it('둘 다 없으면 버린다(합계 오염 방지)', () => {
    const out = aggregateMonthlyStats({
      ...base,
      specials: [{ amount: 50000, paid_at: null, created_at: null }],
    })
    expect(out.every(m => m.special === 0)).toBe(true)
  })
})

describe('aggregateMonthlyStats — 선생님/과목 귀속', () => {
  const input: AggregateInput = {
    from: '2026-08',
    to: '2026-08',
    teachers: [
      { id: 't1', name: '김선생' },
      { id: 't2', name: '이선생' },
    ],
    classes: [
      { id: 'c1', teacher_id: 't1', subject: '수학' },
      { id: 'c2', teacher_id: 't2', subject: '영어' },
      { id: 'c3', teacher_id: null, subject: '수학' }, // 선생 미배정 반
    ],
    students: [
      { id: 's1', class_id: 'c1' },
      { id: 's2', class_id: 'c2' },
      { id: 's3', class_id: null }, // 반 미배정
      { id: 's4', class_id: 'c3' },
    ],
    snapshots: [
      { student_id: 's1', month: '2026-08', fee: 350000 },
      { student_id: 's2', month: '2026-08', fee: 300000 },
      { student_id: 's3', month: '2026-08', fee: 100000 },
      { student_id: 's4', month: '2026-08', fee: 200000 },
    ],
    payments: [
      { student_id: 's1', amount: 350000, billing_month: '2026-08', method: 'payssam' },
      { student_id: 's2', amount: 100000, billing_month: '2026-08', method: 'card' },
      { student_id: 's3', amount: 50000, billing_month: '2026-08', method: 'cash' },
    ],
    specials: [],
  }

  it('선생님별 수납/예정/인원 — 수납 내림차순', () => {
    const [m] = aggregateMonthlyStats(input)
    expect(m.byTeacher[0]).toMatchObject({ teacher_id: 't1', name: '김선생', paid: 350000, fee: 350000, studentCount: 1 })
    expect(m.byTeacher[1]).toMatchObject({ teacher_id: 't2', name: '이선생', paid: 100000, fee: 300000, studentCount: 1 })
  })

  it('🔴 반/선생 미배정은 사라지지 않고 미배정으로 합류 (s3 반없음 + s4 선생없음)', () => {
    const [m] = aggregateMonthlyStats(input)
    const none = m.byTeacher.find(t => t.name === UNASSIGNED_LABEL)!
    expect(none.teacher_id).toBeNull()
    expect(none.paid).toBe(50000)
    expect(none.fee).toBe(300000) // s3 10만 + s4 20만
    expect(none.studentCount).toBe(2)
    // 합계가 새지 않는다
    expect(m.byTeacher.reduce((s, t) => s + t.paid, 0)).toBe(m.paid)
    expect(m.byTeacher.reduce((s, t) => s + t.fee, 0)).toBe(m.fee)
  })

  it('과목별 귀속 — 반 없는 학생은 과목도 미배정', () => {
    const [m] = aggregateMonthlyStats(input)
    const math = m.bySubject.find(s => s.subject === '수학')!
    const eng = m.bySubject.find(s => s.subject === '영어')!
    const none = m.bySubject.find(s => s.subject === UNASSIGNED_LABEL)!
    expect(math).toMatchObject({ paid: 350000, fee: 550000 }) // c1 + c3
    expect(eng).toMatchObject({ paid: 100000, fee: 300000 })
    expect(none).toMatchObject({ paid: 50000, fee: 100000 })
    expect(m.bySubject.reduce((s, x) => s + x.paid, 0)).toBe(m.paid)
  })

  it('학생 목록에 없는 결제(퇴원 후 하드삭제 등)도 미배정으로 잡혀 합계가 맞는다', () => {
    const [m] = aggregateMonthlyStats({
      ...input,
      payments: [{ student_id: 'ghost', amount: 70000, billing_month: '2026-08', method: 'cash' }],
    })
    expect(m.paid).toBe(70000)
    expect(m.byTeacher.find(t => t.name === UNASSIGNED_LABEL)!.paid).toBe(70000)
  })
})
