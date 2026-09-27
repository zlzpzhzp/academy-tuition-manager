import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let saved: Record<string, unknown>
const writes: Record<string, unknown>[] = []
const from = vi.fn(() => {
  const b: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'limit']) b[method] = () => b
  for (const method of ['insert', 'update']) b[method] = (row: Record<string, unknown>) => {
    writes.push(row)
    saved = { ...saved, ...row }
    return b
  }
  b.maybeSingle = async () => ({ data: { order_index: 1 }, error: null })
  b.single = async () => ({ data: saved, error: null })
  return b
})
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => from() } }))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/feeSnapshot', () => ({ snapshotCurrentMonthFee: vi.fn().mockResolvedValue(undefined) }))
import { POST } from '@/app/api/students/route'
import { PUT } from '@/app/api/students/[id]/route'
import { createSessionToken } from '@/lib/auth'
import { writeAuditLog } from '@/lib/auditLog'
import { snapshotCurrentMonthFee } from '@/lib/feeSnapshot'

const EXTRA = '010-0000-0003' // 합성 번호
const params = { params: Promise.resolve({ id: 'synthetic-student' }) }
const request = (body: unknown, authenticated = true) => new Request('http://localhost/api/students', {
  method: 'POST', body: JSON.stringify(body),
  headers: authenticated ? { cookie: `auth_token=${createSessionToken()}` } : {},
})
const newStudent = { name: '합성학생', class_id: 'synthetic-class', enrollment_date: '2026-09-16' }
beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'synthetic-session-secret-only')
  vi.stubEnv('ADMIN_ID', 'synthetic-admin')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('실네트워크 금지') }))
  vi.clearAllMocks()
  writes.length = 0
  saved = { id: 'synthetic-student', ...newStudent, attendance_extra_phone: EXTRA }
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe.each(['POST', 'PUT'])('%s 추가 번호 저장', method => {
  const invoke = (body: Record<string, unknown>, authenticated = true) => method === 'POST'
    ? POST(request({ ...newStudent, ...body }, authenticated))
    : PUT(request(body, authenticated), params)

  it.each([EXTRA, '01000000003', '', null])('번호 %s 저장·조회 응답, 빈 문자열은 NULL', async phone => {
    const response = await invoke({ attendance_extra_phone: phone })
    expect(response.status).toBe(200)
    expect(writes).toHaveLength(1)
    expect(writes[0].attendance_extra_phone).toBe(phone || null)
    expect((await response.json()).attendance_extra_phone).toBe(phone || null)
    if (method === 'PUT') {
      expect(writeAuditLog).toHaveBeenCalledWith('student', 'synthetic-student', 'update',
        expect.stringContaining('attendance_extra_phone'), { attendance_extra_phone: phone || null })
      expect(snapshotCurrentMonthFee).not.toHaveBeenCalled()
      expect(writes[0]).not.toHaveProperty('payssam_recipient')
    }
  })

  it('추가 번호 생략은 신규 NULL·부분 수정 시 기존값 유지', async () => {
    const response = await invoke(method === 'PUT' ? { school: '합성학교' } : {})
    expect(response.status).toBe(200)
    if (method === 'POST') expect(writes[0].attendance_extra_phone).toBeNull()
    else expect(writes[0]).not.toHaveProperty('attendance_extra_phone')
    expect((await response.json()).attendance_extra_phone).toBe(method === 'POST' ? null : EXTRA)
  })

  it('기존 보호자 번호와 같은 저장 규칙을 사용한다', async () => {
    // 기존 API에는 전화번호 형식 가드가 없다. 추가 번호만 새 제한을 만들지 않는다.
    const phone = '01000000003'
    const response = await invoke({ parent_phone: phone, parent_father_phone: phone, attendance_extra_phone: phone })
    expect(response.status).toBe(200)
    expect(writes[0]).toMatchObject({ parent_phone: phone, parent_father_phone: phone, attendance_extra_phone: phone })
  })

  it('미인증 요청은 추가 번호 저장·감사로그 전에 거부', async () => {
    const response = await invoke({ attendance_extra_phone: EXTRA }, false)
    expect(response.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
    expect(writeAuditLog).not.toHaveBeenCalled()
  })
})

it('마이그레이션은 기존 테이블에 nullable/default NULL 컬럼만 멱등 추가한다', () => {
  const sql = readFileSync('supabase/migrations/20260916_attendance_extra_phone.sql', 'utf8').replace(/--[^\n]*/g, '').trim()
  expect(sql).toMatch(/^alter table public\.tuition_students\s+add column if not exists attendance_extra_phone text(?:\s+default null)?;$/i)
  expect(sql).not.toMatch(/\b(not null|grant|revoke|policy|row level security)\b/i)
})
