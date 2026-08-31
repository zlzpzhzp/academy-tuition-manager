/**
 * grades/classes PUT order_index 무검증 (2026-08-16 라인리뷰)
 *
 * 문자열·소수·객체가 검증 없이 update로 들어가면 PG 에러가 raw 500으로 샌다.
 * → nonNegativeNumber(정수 only) 검증으로 400. 정상 정수는 그대로 저장.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type MockResult = { data: unknown; error: unknown }
const results: Record<string, MockResult[]> = {}
const updates: { table: string; row: Record<string, unknown> }[] = []

function makeBuilder(table: string) {
  const b: Record<string, unknown> = {}
  const result = () => results[table]?.shift() ?? { data: null, error: null }
  for (const m of ['select', 'eq']) b[m] = () => b
  b.update = (row: Record<string, unknown>) => {
    updates.push({ table, row })
    return b
  }
  b.single = async () => result()
  b.then = (resolve: (v: MockResult) => void) => resolve(result())
  return b
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }))
vi.mock('@/lib/auth', () => ({ requireAdminSession: vi.fn(() => null) }))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { PUT as gradesPut } from '@/app/api/grades/[id]/route'
import { PUT as classesPut } from '@/app/api/classes/[id]/route'

const req = (body: unknown) => ({ json: async () => body }) as unknown as Request
const params = Promise.resolve({ id: 'x1' })

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k]
  updates.length = 0
})

describe('order_index 검증', () => {
  for (const bad of ['3', 1.5, -1, { n: 1 }] as unknown[]) {
    it(`grades PUT: order_index=${JSON.stringify(bad)} → 400, update 0건`, async () => {
      const res = await gradesPut(req({ order_index: bad }), { params })
      expect(res.status).toBe(400)
      expect(updates).toHaveLength(0)
    })

    it(`classes PUT: order_index=${JSON.stringify(bad)} → 400, update 0건`, async () => {
      const res = await classesPut(req({ order_index: bad }), { params })
      expect(res.status).toBe(400)
      expect(updates).toHaveLength(0)
    })
  }

  it('정상 정수는 그대로 저장된다 (grades)', async () => {
    results['tuition_grades'] = [{ data: { id: 'x1', name: '중1' }, error: null }]
    const res = await gradesPut(req({ order_index: 3 }), { params })
    expect(res.status).toBe(200)
    expect(updates[0].row.order_index).toBe(3)
  })

  it('정상 정수는 그대로 저장된다 (classes)', async () => {
    results['tuition_classes'] = [{ data: { id: 'x1', name: 'A반' }, error: null }]
    const res = await classesPut(req({ order_index: 3 }), { params })
    expect(res.status).toBe(200)
    expect(updates[0].row.order_index).toBe(3)
  })
})
