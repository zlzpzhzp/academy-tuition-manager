/**
 * withdrawal-status POST 역행 차단 가드 회귀 (2026-08-23 주간 라인리뷰 P2)
 *
 * 종결(TERMINAL) → 진행중(IN_PROGRESS) 하향 전이는 force 없이 거부하는 가드가 있는데,
 * 현재 상태 조회의 error 를 안 보면 조회 장애 시 cur=null → 종결 건이 force 없이
 * 진행중으로 upsert 된다(지드래곤 사고가 DB 순간장애로 재현되는 구조). 가드는 막는 쪽이 안전 —
 * 조회 실패면 500 GUARD_QUERY_FAILED 로 저장을 중단한다. 음성(정상 통과)·양성(가드 발화) 대조.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

type MockResult = { data: unknown; error: unknown }
const results: Record<string, MockResult[]> = {}
const upserts: { table: string; payload: unknown }[] = []
const deletes: string[] = []

function makeBuilder(table: string) {
  const b: Record<string, unknown> = {}
  const result = () => results[table]?.shift() ?? { data: null, error: null }
  for (const m of ['select', 'eq', 'maybeSingle']) b[m] = () => b
  b.upsert = (payload: unknown) => { upserts.push({ table, payload }); return b }
  b.delete = () => { deletes.push(table); return b }
  b.then = (resolve: (v: MockResult) => void) => resolve(result())
  return b
}

const writeAuditLog = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }))
vi.mock('@/lib/auth', () => ({ requireAdminSession: vi.fn(() => null) }))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }))

import { POST } from '@/app/api/withdrawal-status/route'

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k]
  upserts.length = 0
  deletes.length = 0
  writeAuditLog.mockClear()
})

describe('withdrawal-status 역행 차단 가드', () => {
  it('음성: 기존 기록 없음(정상 0행) → 진행중 저장 통과', async () => {
    results['tuition_withdrawal_status'] = [
      { data: null, error: null }, // cur 조회: 행 없음 (성공)
      { data: null, error: null }, // upsert
    ]

    const res = await POST(req({ student_id: 's1', billing_month: '2026-08', status: 'resettle_pending' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(upserts).toHaveLength(1)
  })

  it('음성: 종결 건은 force 없이 진행중 전이 시 409 (기존 가드 회귀)', async () => {
    results['tuition_withdrawal_status'] = [
      { data: { status: 'refund_done' }, error: null },
    ]

    const res = await POST(req({ student_id: 's1', billing_month: '2026-08', status: 'resettle_pending' }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('TERMINAL_STATUS_DOWNGRADE_BLOCKED')
    expect(upserts).toHaveLength(0)
  })

  it('🔴 양성: 현재 상태 조회 장애면 500 GUARD_QUERY_FAILED — 종결 건이 조용히 진행중으로 내려가지 않는다', async () => {
    results['tuition_withdrawal_status'] = [
      { data: null, error: { message: 'connection reset' } },
    ]

    const res = await POST(req({ student_id: 's1', billing_month: '2026-08', status: 'resettle_pending' }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.code).toBe('GUARD_QUERY_FAILED')
    expect(upserts).toHaveLength(0) // 저장 자체가 없어야 한다
  })

  it('음성: 종결 상태 저장은 조회 가드를 타지 않고 통과 (하향 전이가 아니다)', async () => {
    results['tuition_withdrawal_status'] = [
      { data: null, error: null }, // upsert (진행중이 아니므로 cur 조회 자체가 없다)
    ]

    const res = await POST(req({ student_id: 's1', billing_month: '2026-08', status: 'refund_done' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(upserts).toHaveLength(1)
  })
})
