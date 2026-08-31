/**
 * 학생360 동명이인 가드 회귀 (2026-08-23 주간 라인리뷰 P2·P3)
 *
 * - P2: 동명이인 판정 쿼리(soft) 실패 시 dupPhones=[] → ambiguous=false 로 오귀속 방지 가드가
 *   조용히 풀렸다('남의 기록이 붙는 게 빈 것보다 나쁘다' 역전). 실패면 보수적으로 동명이인 취급 + note 표면화.
 * - P3: 동명이인일 때 진도·질문의 이름 폴백 절이 쿼리에 남아, 남의 폴백 행이 limit 칸을 채우고
 *   사후 필터가 그걸 지워 '기록 없음' 오표시가 됐다. ambiguous 면 .or() 에서 이름 절 자체를 뺀다.
 * 음성(정상 이름 폴백 유지)·양성(가드 발화) 대조.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type MockResult = { data: unknown; error: unknown }
const results: Record<string, MockResult[]> = {}
const orCalls: { table: string; arg: string }[] = []

function makeBuilder(table: string) {
  const b: Record<string, unknown> = {}
  const result = () => results[table]?.shift() ?? { data: null, error: null }
  for (const m of ['select', 'eq', 'in', 'is', 'ilike', 'order', 'limit', 'maybeSingle', 'single']) b[m] = () => b
  b.or = (arg: string) => { orCalls.push({ table, arg }); return b }
  b.then = (resolve: (v: MockResult) => void) => resolve(result())
  return b
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }))
vi.mock('@/lib/auth', () => ({ requireAdminSession: vi.fn(() => null) }))

import { GET } from '@/app/api/students/[id]/360/route'

const SID = '11111111-2222-3333-4444-555555555555'
const call = () =>
  GET(new Request('http://x/api/students/x/360'), { params: Promise.resolve({ id: SID }) })

const base = { id: SID, name: '김테스트', parent_phone: '010-1111-2222', class_id: null, school: null, status: 'good', enrollment_date: '2026-01-01', withdrawal_date: null }
const personRow = { id: SID, class_id: null, withdrawal_date: null }

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k]
  orCalls.length = 0
})

describe('학생360 동명이인 가드', () => {
  it('음성: 판정 정상 + 번호 1종(동명이인 아님) → 진도·질문 쿼리에 이름 폴백 절 유지, memosSkipped=false', async () => {
    results['tuition_students'] = [
      { data: base, error: null },                                   // 기준행
      { data: [personRow], error: null },                            // 형제행
      { data: [{ parent_phone: '010-1111-2222' }], error: null },    // 동명이인 판정: 1종
    ]

    const res = await call()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.sections.callLogs.memosSkipped).toBe(false)
    const progressOr = orCalls.find(c => c.table === 'dm_class_progress_parsed')
    const qaOr = orCalls.find(c => c.table === 'qa_submissions')
    expect(progressOr?.arg).toContain('student_name') // 이름 폴백 절 살아 있음
    expect(qaOr?.arg).toContain('student_name')
  })

  it('음성: 번호 2종(진짜 동명이인) → 이름 폴백 절 제거 + memosSkipped=true', async () => {
    results['tuition_students'] = [
      { data: base, error: null },
      { data: [personRow], error: null },
      { data: [{ parent_phone: '010-1111-2222' }, { parent_phone: '010-3333-4444' }], error: null },
    ]

    const res = await call()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.sections.callLogs.memosSkipped).toBe(true)
    const progressOr = orCalls.find(c => c.table === 'dm_class_progress_parsed')
    const qaOr = orCalls.find(c => c.table === 'qa_submissions')
    expect(progressOr?.arg).not.toContain('student_name') // 남의 폴백 행이 limit 칸을 못 채운다
    expect(qaOr?.arg).not.toContain('student_name')
    expect(progressOr?.arg).toContain('tuition_student_id.in') // id 귀속 절은 유지
  })

  it('🔴 양성: 판정 쿼리 실패 → 보수적으로 동명이인 취급(가드 유지) + note 표면화', async () => {
    results['tuition_students'] = [
      { data: base, error: null },
      { data: [personRow], error: null },
      { data: null, error: { message: 'connection reset' } },        // 판정 쿼리 장애
    ]

    const res = await call()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.sections.callLogs.memosSkipped).toBe(true)           // 가드가 풀리지 않는다
    expect(body.sections.callLogs.note).toContain('판정 조회 실패')
    const progressOr = orCalls.find(c => c.table === 'dm_class_progress_parsed')
    expect(progressOr?.arg).not.toContain('student_name')
    const memosQueried = orCalls.some(c => c.table === 'memos')
    expect(memosQueried).toBe(false)                                 // 이름 ilike 검색도 스킵
  })
})
