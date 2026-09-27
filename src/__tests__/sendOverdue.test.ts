import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
let student: Row
let statuses: Row[]
let statusError: { message: string } | null
const writes: { table: string; row: Row }[] = []

// 합성 행에 실제 필터·정렬·limit를 적용한다. 최근 월을 미리 골라 반환하지 않는다.
function builder(table: string) {
  let rows = table === 'tuition_students' ? [student]
    : table === 'tuition_withdrawal_status' ? [...statuses]
      : table === 'tuition_bill_history' ? [{ bill_id: 'synthetic-bill', overdue_sms_count: 2 }]
        : null
  if (!rows) throw new Error(`예상하지 않은 테이블: ${table}`)
  let columns = '*'
  let single = false
  const b = {
    select(value: string) { columns = value; return b },
    eq(column: string, value: unknown) { rows = rows!.filter(row => row[column] === value); return b },
    order(column: string, { ascending = true } = {}) {
      rows!.sort((a, z) => String(a[column]).localeCompare(String(z[column])) * (ascending ? 1 : -1))
      return b
    },
    limit(count: number) { rows = rows!.slice(0, count); return b },
    single() { single = true; return b },
    maybeSingle() { single = true; return b },
    update(row: Row) { writes.push({ table, row }); return b },
    then(resolve: (value: { data: unknown; error: unknown }) => void) {
      const projected = rows!.map(row => columns === '*' ? row
        : Object.fromEntries(columns.split(',').map(key => [key.trim(), row[key.trim()]])))
      const error = table === 'tuition_withdrawal_status' && statusError
        || (single && projected.length > 1 ? { message: '여러 행을 단일 행으로 반환할 수 없음' } : null)
      return resolve({ data: single ? projected[0] ?? null : projected, error })
    },
  }
  return b
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn((table: string) => builder(table)) } }))
vi.mock('@/lib/solapi', () => ({ sendBulkSms: vi.fn() }))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { POST } from '@/app/api/sms/send-overdue/route'
import { createSessionToken } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { sendBulkSms } from '@/lib/solapi'
import { writeAuditLog } from '@/lib/auditLog'
import { IN_PROGRESS_STATUSES, TERMINAL_STATUSES } from '@/lib/withdrawalStatuses'

const STUDENT_ID = 'synthetic-student'
const TEXT = '합성 정산 안내'
const statusRow = (status: string, billing_month = '2026-09', student_id = STUDENT_ID): Row =>
  ({ student_id, status, billing_month })
const post = (body: Row = {}, authenticated = true) => POST(new NextRequest('http://localhost/api/sms/send-overdue', {
  method: 'POST',
  headers: authenticated ? { cookie: `auth_token=${createSessionToken()}` } : {},
  body: JSON.stringify({ studentId: STUDENT_ID, text: TEXT, billId: 'synthetic-bill', ...body }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SESSION_SECRET', 'synthetic-session-secret-only')
  vi.stubEnv('ADMIN_ID', 'synthetic-admin')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('실네트워크 금지') }))
  // 모든 이름·번호는 합성값이며 DB·발송·감사로그는 대역으로 격리한다.
  student = { id: STUDENT_ID, name: '합성학생', phone: '010-0000-0004',
    parent_phone: '010-0000-0001', parent_father_phone: '010-0000-0002',
    payssam_recipient: 'mother', withdrawal_date: '2026-09-19' }
  statuses = []
  statusError = null
  writes.length = 0
  vi.mocked(sendBulkSms).mockReset().mockResolvedValue({ groupId: 'synthetic-group', count: 1, failed: 0 })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

async function expectSent(response: Response, text = TEXT, to = '01000000001') {
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, sent: 1, failed: 0, groupId: 'synthetic-group' })
  expect(sendBulkSms).toHaveBeenCalledExactlyOnceWith([{ to, text }])
  expect(writeAuditLog).toHaveBeenCalledExactlyOnceWith(
    'attendance', 'synthetic-group', 'upsert', '미납 안내 문자 발송 — 합성학생',
    { type: 'overdue_sms', student_id: STUDENT_ID, bill_id: 'synthetic-bill', sent: 1, failed: 0, content_preview: text.slice(0, 120) },
  )
  expect(writes).toEqual([{ table: 'tuition_bill_history', row: { overdue_sms_count: 3, last_overdue_sms_at: expect.any(String) } }])
}

function expectNoSend() {
  expect(sendBulkSms).not.toHaveBeenCalled()
  expect(writeAuditLog).not.toHaveBeenCalled()
  expect(writes).toHaveLength(0)
}

describe('퇴원생 단일 문자: 진행중이 없고 종결 상태가 있을 때만 차단', () => {
  it('재원생은 과거 종결 상태나 정산 조회 장애와 무관하게 발송한다', async () => {
    student.withdrawal_date = null
    statuses = [statusRow('refund_done')]
    statusError = { message: '합성 조회 장애' }
    await expectSent(await post())
    expect(supabase.from).not.toHaveBeenCalledWith('tuition_withdrawal_status')
  })

  it('퇴원 직후 상태행이 없으면 발송한다', async () => {
    await expectSent(await post())
  })

  it.each([...IN_PROGRESS_STATUSES, 'resettle_refund_failed'])('미종결 %s이면 발송한다', async status => {
    statuses = [statusRow(status)]
    await expectSent(await post())
  })

  it.each(TERMINAL_STATUSES)('종결 %s이면 상태·월 사유와 함께 400, 발송·배지·감사로그 없음', async status => {
    statuses = [statusRow(status)]
    const response = await post()
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: `이미 정산이 종결된 퇴원생입니다 (상태: ${status}, 2026-09)` })
    expectNoSend()
  })

  it.each(IN_PROGRESS_STATUSES.flatMap(status => [
    { latest: status, previous: 'refund_done' },
    { latest: 'refund_done', previous: status },
  ]))('최근 $latest / 과거 $previous 혼재 시 진행중이 있으므로 발송한다', async ({ latest, previous }) => {
    statuses = [
      { ...statusRow(previous, '2025-12'), updated_at: '2026-02-02' },
      { ...statusRow(latest, '2026-01'), updated_at: '2026-01-01' },
      { ...statusRow(previous, '2025-11'), updated_at: '2026-02-03' },
      statusRow('refund_done', '2026-02', 'another-synthetic-student'),
    ]
    await expectSent(await post())
  })

  it('종결만 여러 달 있으면 다른 학생의 진행중과 무관하게 차단하고 최근 종결 상태·월을 안내한다', async () => {
    statuses = [
      statusRow('resettled_paid', '2025-12'),
      statusRow('refund_done', '2026-01'),
      statusRow('settle', '2025-11'),
      statusRow('resettle_pending', '2026-02', 'another-synthetic-student'),
    ]
    const response = await post()
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '이미 정산이 종결된 퇴원생입니다 (상태: refund_done, 2026-01)' })
    expectNoSend()
  })

  it('진행중 집합 밖 상태는 과거 종결에 대한 차단을 풀지 않는다', async () => {
    statuses = [statusRow('resettle_refund_failed'), statusRow('resettled_paid', '2026-08')]
    const response = await post()
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '이미 정산이 종결된 퇴원생입니다 (상태: resettled_paid, 2026-08)' })
    expectNoSend()
  })

  it('그 학생의 행이 없으면 다른 학생의 종결과 무관하게 발송한다', async () => {
    statuses = [statusRow('refund_done', '2026-09', 'another-synthetic-student')]
    await expectSent(await post())
  })

  it.each([false, true])('상태 조회 실패는 데이터 유무(%s)와 무관하게 500으로 발송을 중단한다', async hasData => {
    statuses = hasData ? [statusRow('resettle_pending')] : []
    statusError = { message: '합성 조회 장애' }
    const response = await post()
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: 'GUARD_QUERY_FAILED', error: expect.stringContaining('조회') })
    expectNoSend()
  })
})

describe('기존 단일 발송 계약 보존', () => {
  it('인증 실패는 DB 조회와 발송 전에 401', async () => {
    const response = await post({}, false)
    expect(response.status).toBe(401)
    expect(supabase.from).not.toHaveBeenCalled()
    expectNoSend()
  })

  it.each([
    { label: '빈 문자열', text: '' },
    { label: '공백', text: '   ' },
    { label: '1500자 초과', text: '가'.repeat(1501) },
  ])('$label 본문은 400', async ({ text }) => {
    const response = await post({ text })
    expect(response.status).toBe(400)
    expect(supabase.from).not.toHaveBeenCalled()
    expectNoSend()
  })

  it('1500자 본문은 허용하고 앞뒤 공백만 제거해 전송한다', async () => {
    const text = '가'.repeat(1500)
    await expectSent(await post({ text: ` ${text} ` }), text)
  })

  it.each(['010-0000-0001', ''])('어머니 번호가 %s여도 선택된 아버지에게 발송한다', async mother => {
    student.payssam_recipient = 'father'
    student.parent_phone = mother
    await expectSent(await post(), TEXT, '01000000002')
  })

  it('학부모 번호가 없으면 학생 번호로 보내지 않고 400', async () => {
    student.parent_phone = ''
    student.parent_father_phone = ''
    const response = await post()
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '학부모 폰이 등록되어 있지 않습니다' })
    expectNoSend()
  })

  it('솔라피 접수 실패는 502·실패 감사로그를 남기고 배지를 증가시키지 않는다', async () => {
    vi.mocked(sendBulkSms).mockResolvedValue({ groupId: 'synthetic-group', count: 0, failed: 1 })
    const response = await post()
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ ok: false, sent: 0, failed: 1, groupId: 'synthetic-group' })
    expect(writes).toHaveLength(0)
    expect(writeAuditLog).toHaveBeenCalledExactlyOnceWith(
      'attendance', 'synthetic-group', 'upsert', expect.stringContaining('발송 실패'),
      { type: 'overdue_sms', student_id: STUDENT_ID, bill_id: 'synthetic-bill', sent: 0, failed: 1, content_preview: TEXT },
    )
  })
})
