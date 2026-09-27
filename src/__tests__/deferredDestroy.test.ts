/**
 * 지연 파기 배치 — payload 파손 행이 배치를 죽이던 문제 (2026-08-16 라인리뷰)
 *
 * payload 구조분해가 try 밖에 있어 row.payload가 null/파손이면 TypeError로 for 루프와 함수 전체가
 * 죽었다(바깥 catch에 도달 못 함) → 같은 배치 뒤쪽 행들이 통째로 미처리.
 * 무효 행은 실패 처리(재시도 카운터)로 넘기고 나머지 행은 계속 처리해야 한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type MockResult = { data: unknown; error: unknown }
const results: Record<string, MockResult[]> = {}
const updates: { table: string; row: Record<string, unknown> }[] = []

function makeBuilder(table: string) {
  const b: Record<string, unknown> = {}
  let mutation = false
  let id: unknown
  const result = () => {
    if (mutation && table === 'tuition_bill_queue') {
      if (id === undefined) return { data: [], error: null } // 복구할 고착 행 없음
      updates.push({ table, row: values })
      return { data: [{ id }], error: null }
    }
    return results[table]?.shift() ?? { data: null, error: null }
  }
  let values: Record<string, unknown> = {}
  for (const m of ['select', 'lte', 'limit']) b[m] = () => b
  b.eq = (key: string, value: unknown) => { if (key === 'id') id = value; return b }
  b.update = (row: Record<string, unknown>) => {
    mutation = true
    values = row
    if (table !== 'tuition_bill_queue') updates.push({ table, row })
    return b
  }
  b.single = async () => result()
  b.then = (resolve: (v: MockResult) => void) => resolve(result())
  return b
}

const destroyBill = vi.fn()

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }))
vi.mock('@/lib/payssam', () => ({ destroyBill: (...a: unknown[]) => destroyBill(...a) }))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { processOverdueDestroys } from '@/lib/deferredDestroy'

const QUEUE = 'tuition_bill_queue'
const HISTORY = 'tuition_bill_history'

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k]
  updates.length = 0
  destroyBill.mockReset()
  destroyBill.mockResolvedValue({ code: '0000' })
})

describe('processOverdueDestroys', () => {
  it('payload가 null인 행이 있어도 뒤쪽 행이 처리된다', async () => {
    results[QUEUE] = [{
      data: [
        { id: 'q1', payload: null, retry_count: 0, student_name: 'A' },
        { id: 'q2', payload: { billId: 'B2', amount: 100 }, retry_count: 0, student_name: 'B' },
      ],
      error: null,
    }]
    results[HISTORY] = [{ data: { status: 'sent' }, error: null }]

    const processed = await processOverdueDestroys()

    expect(processed).toBe(1) // 파손 행이 배치를 죽이지 않음
    expect(destroyBill).toHaveBeenCalledTimes(1)
    expect(destroyBill).toHaveBeenCalledWith('B2', 100)
    // 파손 행은 조용히 사라지지 않고 재시도 카운터가 올라간다
    const failUpdate = updates.find(u => u.table === QUEUE && String(u.row.error_msg ?? '').includes('payload'))
    expect(failUpdate).toBeDefined()
    expect(failUpdate!.row.retry_count).toBe(1)
  })

  it('billId 없는 payload도 실패 처리로 넘긴다 (파기 호출 0건)', async () => {
    results[QUEUE] = [{
      data: [{ id: 'q1', payload: { amount: 100 }, retry_count: 0, student_name: 'A' }],
      error: null,
    }]

    const processed = await processOverdueDestroys()

    expect(processed).toBe(0)
    expect(destroyBill).not.toHaveBeenCalled()
    expect(updates.some(u => String(u.row.error_msg ?? '').includes('payload'))).toBe(true)
  })

  it('정상 행은 그대로 파기된다 (회귀 없음)', async () => {
    results[QUEUE] = [{
      data: [{ id: 'q1', payload: { billId: 'B1', amount: 300, methodLabel: '계좌이체' }, retry_count: 0, student_name: 'A' }],
      error: null,
    }]
    results[HISTORY] = [{ data: { status: 'sent' }, error: null }]

    const processed = await processOverdueDestroys()

    expect(processed).toBe(1)
    expect(updates.some(u => u.table === HISTORY && u.row.status === 'destroyed')).toBe(true)
    expect(updates.some(u => u.table === QUEUE && u.row.status === 'sent')).toBe(true)
  })

  it('대상 조회 장애면 취소하지 않고 재시도 (#7)', async () => {
    results[QUEUE] = [{ data: [{ id: 'q1', payload: { billId: 'B1', amount: 300 }, retry_count: 0 }], error: null }]
    results[HISTORY] = [{ data: null, error: { code: '08006', message: 'DB down' } }]
    expect(await processOverdueDestroys()).toBe(0)
    expect(destroyBill).not.toHaveBeenCalled()
    expect(updates).toEqual([
      { table: QUEUE, row: expect.objectContaining({ status: 'processing' }) },
      { table: QUEUE, row: expect.objectContaining({ status: 'pending', retry_count: 1 }) },
    ])
  })

  it.each([
    { data: null, error: { code: 'PGRST116', message: 'no rows' } },
    { data: null, error: null },
    { data: { status: 'paid' }, error: null },
  ])('실제 부재·상태 변동이면 기존대로 취소: %j', async result => {
    results[QUEUE] = [{ data: [{ id: 'q1', payload: { billId: 'B1', amount: 300 }, retry_count: 0 }], error: null }]
    results[HISTORY] = [result]
    await processOverdueDestroys()
    expect(destroyBill).not.toHaveBeenCalled()
    expect(updates).toEqual([
      { table: QUEUE, row: expect.objectContaining({ status: 'processing' }) },
      { table: QUEUE, row: expect.objectContaining({ status: 'cancelled' }) },
    ])
  })

})
