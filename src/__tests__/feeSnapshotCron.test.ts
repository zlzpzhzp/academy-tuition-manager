/**
 * fee-snapshot 크론 fail-closed 회귀 (2026-08-13 라인리뷰 P1-A)
 *
 * classes 조회 error를 `?? []`로 삼키면 반비가 전원 0원으로 계산돼 그대로 박제되고,
 * upsert가 ignoreDuplicates라 다음 크론이 영원히 교정하지 못한다.
 * → classes 실패 시 500 + upsert 0건이어야 한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

type MockResult = { data: unknown; error: unknown }
const results: Record<string, MockResult[]> = {}
const upserts: { table: string; rows: unknown }[] = []

function makeBuilder(table: string) {
  const b: Record<string, unknown> = {}
  const result = () => results[table]?.shift() ?? { data: null, error: null }
  for (const m of ['select', 'eq', 'is', 'order', 'limit', 'single']) {
    b[m] = () => b
  }
  b.upsert = (rows: unknown) => {
    upserts.push({ table, rows })
    return b
  }
  b.then = (resolve: (v: MockResult) => void) => resolve(result())
  return b
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }))
vi.mock('@/lib/auth', () => ({ requireCronSecret: vi.fn(() => null) }))

import { GET } from '@/app/api/cron/fee-snapshot/route'
import { snapshotCurrentMonthFee } from '@/lib/feeSnapshot'

const REQ = {} as NextRequest
const STUDENTS = [
  { id: 's1', custom_fee: null, electives: ['확통'], class_id: 'c1', enrollment_date: '2026-03-01', withdrawal_date: null },
  { id: 's2', custom_fee: 300000, electives: [], class_id: 'c1', enrollment_date: '2026-03-01', withdrawal_date: null },
]

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k]
  upserts.length = 0
})

describe('fee-snapshot cron', () => {
  it('classes 조회 실패 시 500 + 스냅샷 0건 (0원 박제 방지)', async () => {
    results['tuition_students'] = [{ data: STUDENTS, error: null }]
    results['tuition_classes'] = [{ data: null, error: { message: 'DB down' } }]

    const res = await GET(REQ)

    expect(res.status).toBe(500)
    expect(upserts).toHaveLength(0) // 오염 기록이 한 건도 없어야 함
  })

  it('students 조회 실패도 500 + 스냅샷 0건', async () => {
    results['tuition_students'] = [{ data: null, error: { message: 'DB down' } }]
    results['tuition_classes'] = [{ data: [{ id: 'c1', monthly_fee: 450000 }], error: null }]

    const res = await GET(REQ)

    expect(res.status).toBe(500)
    expect(upserts).toHaveLength(0)
  })

  it('정상 경로: 선택과목비 포함 요금이 박제된다', async () => {
    results['tuition_students'] = [{ data: STUDENTS, error: null }]
    results['tuition_classes'] = [{ data: [{ id: 'c1', monthly_fee: 450000 }], error: null }]

    const res = await GET(REQ)

    expect(res.status).toBe(200)
    expect(upserts).toHaveLength(1)
    const rows = upserts[0].rows as { student_id: string; fee: number }[]
    expect(rows.find(r => r.student_id === 's1')!.fee).toBe(650000) // 45만 + 확통 20만
    expect(rows.find(r => r.student_id === 's2')!.fee).toBe(300000) // custom_fee 우선
  })
})


describe('당월 스냅샷 갱신 (#5)', () => {
  it('반 조회 오류면 기존 스냅샷 보존(upsert 없음)', async () => {
    results['tuition_students'] = [{ data: STUDENTS[0], error: null }]
    results['tuition_classes'] = [{ data: null, error: { message: 'DB down' } }]
    await snapshotCurrentMonthFee('s1')
    expect(upserts).toHaveLength(0)
  })

  it('정상 반 조회는 선택과목비까지 그대로 저장', async () => {
    results['tuition_students'] = [{ data: STUDENTS[0], error: null }]
    results['tuition_classes'] = [{ data: { id: 'c1', monthly_fee: 450000 }, error: null }]
    await snapshotCurrentMonthFee('s1')
    expect(upserts).toEqual([{ table: 'tuition_fee_snapshot', rows: expect.objectContaining({ student_id: 's1', fee: 650000 }) }])
  })

  it('반 없는 학생은 정상적으로 개별 요금 저장', async () => {
    results['tuition_students'] = [{ data: { ...STUDENTS[1], class_id: null }, error: null }]
    await snapshotCurrentMonthFee('s2')
    expect(upserts).toEqual([{ table: 'tuition_fee_snapshot', rows: expect.objectContaining({ student_id: 's2', fee: 300000 }) }])
  })
})
