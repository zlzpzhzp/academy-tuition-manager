/**
 * 출결번호 중복 가드 fail-closed 회귀 (2026-08-16 라인리뷰)
 *
 * takenAttendanceCodes가 조회 error를 버리고 빈 Set을 돌려주면 POST/PUT의 중복 검사가 전부
 * 통과해 같은 4자리 코드 학생이 둘 생긴다(키오스크는 첫 매칭 한 명만 처리 = 다른 학생의 등원이
 * 기록·통보되지 않음). → 조회 실패 시 500 GUARD_QUERY_FAILED + 저장 0건이어야 한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type MockResult = { data: unknown; error: unknown }
const results: Record<string, MockResult[]> = {}
const writes: { table: string; op: 'insert' | 'update'; row: unknown }[] = []

function makeBuilder(table: string) {
  const b: Record<string, unknown> = {}
  const result = () => results[table]?.shift() ?? { data: null, error: null }
  for (const m of ['select', 'eq', 'is', 'not', 'neq', 'order', 'limit']) b[m] = () => b
  b.insert = (row: unknown) => {
    writes.push({ table, op: 'insert', row })
    return b
  }
  b.update = (row: unknown) => {
    writes.push({ table, op: 'update', row })
    return b
  }
  b.single = async () => result()
  b.maybeSingle = async () => result()
  b.then = (resolve: (v: MockResult) => void) => resolve(result())
  return b
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }))
vi.mock('@/lib/auth', () => ({ requireAdminSession: vi.fn(() => null) }))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/feeSnapshot', () => ({ snapshotCurrentMonthFee: vi.fn().mockResolvedValue(undefined) }))

import { POST } from '@/app/api/students/route'
import { PUT } from '@/app/api/students/[id]/route'

const OK: MockResult = { data: null, error: null }
const req = (body: unknown) => ({ json: async () => body }) as unknown as Request
const params = Promise.resolve({ id: 'stu1' })

const NEW_STUDENT = {
  name: '테스트', class_id: 'c1', enrollment_date: '2026-08-01', attendance_code: '1234',
}

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k]
  writes.length = 0
})

describe('학생 POST 출결번호 중복 가드', () => {
  it('중복 조회 실패는 fail-closed: 500 GUARD_QUERY_FAILED — 저장 0건', async () => {
    // [0] order_index max 조회, [1] 중복 검사 조회(실패)
    results['tuition_students'] = [OK, { data: null, error: { message: 'DB down' } }]

    const res = await POST(req(NEW_STUDENT))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.code).toBe('GUARD_QUERY_FAILED')
    expect(writes).toHaveLength(0)
  })

  it('정상 조회 + 중복이면 409 (기존 동작 유지)', async () => {
    results['tuition_students'] = [OK, { data: [{ attendance_code: '1234' }], error: null }]

    const res = await POST(req(NEW_STUDENT))

    expect(res.status).toBe(409)
    expect(writes).toHaveLength(0)
  })

  it('정상 조회 + 중복 없으면 저장된다 (가드 오차단 없음)', async () => {
    results['tuition_students'] = [
      { data: { order_index: 3 }, error: null },
      { data: [{ attendance_code: '9999' }], error: null },
      { data: { id: 'stu9', name: '테스트' }, error: null },
    ]

    const res = await POST(req(NEW_STUDENT))

    expect(res.status).toBe(200)
    expect(writes).toHaveLength(1)
    expect((writes[0].row as { attendance_code: string }).attendance_code).toBe('1234')
  })

  it('자동배정(phone) 경로의 조회 실패도 fail-closed — 이미 쓰이는 코드 배정 방지', async () => {
    results['tuition_students'] = [OK, { data: null, error: { message: 'DB down' } }]

    const res = await POST(req({ ...NEW_STUDENT, attendance_code: undefined, phone: '010-1234-5678' }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.code).toBe('GUARD_QUERY_FAILED')
    expect(writes).toHaveLength(0)
  })
})

describe('학생 PUT 출결번호 중복 가드', () => {
  it('중복 조회 실패는 fail-closed: 500 GUARD_QUERY_FAILED — 저장 0건', async () => {
    results['tuition_students'] = [{ data: null, error: { message: 'DB down' } }]

    const res = await PUT(req({ attendance_code: '1234' }), { params })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.code).toBe('GUARD_QUERY_FAILED')
    expect(writes).toHaveLength(0)
  })

  it('정상 조회 + 중복이면 409 (기존 동작 유지)', async () => {
    results['tuition_students'] = [{ data: [{ attendance_code: '1234' }], error: null }]

    const res = await PUT(req({ attendance_code: '1234' }), { params })

    expect(res.status).toBe(409)
    expect(writes).toHaveLength(0)
  })

  it('정상 조회 + 중복 없으면 저장된다', async () => {
    results['tuition_students'] = [
      { data: [{ attendance_code: '9999' }], error: null },
      { data: { id: 'stu1', name: '테스트' }, error: null },
    ]

    const res = await PUT(req({ attendance_code: '1234' }), { params })

    expect(res.status).toBe(200)
    expect(writes).toHaveLength(1)
    expect(writes[0].op).toBe('update')
  })
})
