import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { IN_PROGRESS_STATUSES, TERMINAL_STATUSES } from '@/lib/withdrawalStatuses'

type Row = Record<string, unknown>
type Result = { data: unknown; error: { message: string } | null }
const HISTORY = 'tuition_bill_history'
const STATUSES = 'tuition_withdrawal_status'
const PAYMENTS = 'tuition_payments'
const STUDENT_ID = 'synthetic-student'
const BILL_ID = 'synthetic-resettle-bill'
const OLD_BILL_ID = 'synthetic-old-bill'
const db: Record<string, Row[]> = {}
const events: string[] = []
let statusUpdateFailure: 'error' | 'throw' | null
let oldBillQueryError: boolean

// 실제 라우트가 지정한 필터를 합성 행에 적용하고, await 시에만 DB 변경을 반영한다.
// UPDATE 결과를 미리 정해 두지 않아 학생/상태 조건 누락과 월 제한을 검출한다.
function builder(table: string) {
  if (!db[table]) throw new Error(`예상하지 않은 테이블: ${table}`)
  const filters: ((row: Row) => boolean)[] = []
  let operation = 'select'
  let payload: Row = {}
  let conflictKeys: string[] = []
  let single = false
  let limit = Infinity
  let ordering: { column: string; ascending: boolean } | undefined
  const b = {
    select() { return b },
    eq(column: string, value: unknown) { filters.push(row => row[column] === value); return b },
    is(column: string, value: unknown) { filters.push(row => (row[column] ?? null) === value); return b },
    in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return b },
    order(column: string, { ascending = true } = {}) { ordering = { column, ascending }; return b },
    limit(value: number) { limit = value; return b },
    single() { single = true; return b },
    update(value: Row) { operation = 'update'; payload = value; return b },
    insert(value: Row) { operation = 'insert'; payload = value; return b },
    upsert(value: Row, { onConflict }: { onConflict: string }) {
      operation = 'upsert'; payload = value; conflictKeys = onConflict.split(','); return b
    },
    then(resolve: (result: Result) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve().then((): Result => {
        if (table === STATUSES && operation === 'update' && statusUpdateFailure) {
          if (statusUpdateFailure === 'throw') throw new Error('합성 종결 UPDATE 실패')
          return { data: null, error: { message: '합성 종결 UPDATE 실패' } }
        }
        let rows = db[table].filter(row => filters.every(filter => filter(row)))
        if (table === HISTORY && operation === 'select' && oldBillQueryError
          && rows.some(row => row.bill_id === OLD_BILL_ID)) {
          return { data: null, error: { message: '합성 기존 청구서 조회 실패' } }
        }
        if (operation === 'update') rows.forEach(row => Object.assign(row, payload))
        if (operation === 'insert') {
          const row = { id: `synthetic-payment-${db[table].length}`, ...payload }
          db[table].push(row)
          rows = [row]
        }
        if (operation === 'upsert') {
          const existing = db[table].find(row => conflictKeys.every(key => row[key] === payload[key]))
          if (existing) Object.assign(existing, payload)
          else db[table].push({ ...payload })
        }
        if (operation !== 'select') events.push(`${table}:${operation}`)
        if (ordering) {
          const { column, ascending } = ordering
          rows.sort((a, z) => String(a[column]).localeCompare(String(z[column])) * (ascending ? 1 : -1))
        }
        rows = rows.slice(0, limit)
        return { data: single ? rows[0] ?? null : rows.map(row => ({ ...row })), error: null }
      }).then(resolve, reject)
    },
  }
  return b
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => builder(table) } }))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/paymentCancel', () => ({ clearPaymentForBill: vi.fn() }))
vi.mock('@/lib/payssam', () => ({ cancelBill: vi.fn() }))
vi.mock('@/lib/solapi', () => ({ sendSms: vi.fn() }))

import { POST } from '@/app/api/payssam/callback/route'
import { writeAuditLog } from '@/lib/auditLog'
import { cancelBill } from '@/lib/payssam'
import { clearPaymentForBill } from '@/lib/paymentCancel'

const statusRow = (status: string, billing_month: string, student_id = STUDENT_ID): Row =>
  ({ student_id, billing_month, status, updated_at: '2026-09-01T00:00:00.000Z' })
const call = (appr_state = 'F') => POST(new NextRequest('http://localhost/api/payssam/callback', {
  method: 'POST',
  body: JSON.stringify({ apikey: 'synthetic-api-key', bill_id: BILL_ID, appr_state, appr_price: '100000' }),
}))
async function expectSuccess(response: Response) {
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ code: '0000' })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PAYSSAM_API_KEY', 'synthetic-api-key')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('실네트워크 금지') }))
  for (const table of Object.keys(db)) delete db[table]
  db[HISTORY] = [{ bill_id: BILL_ID, student_id: STUDENT_ID, amount: 100000,
    billing_month: '2026-08', bill_note: '중도퇴원 정산', is_regular_tuition: true, status: 'sent' }]
  db[STATUSES] = [statusRow('resettle_pending', '2026-08'), statusRow('resettle_pending', '2026-09')]
  db[PAYMENTS] = []
  events.length = 0
  statusUpdateFailure = null
  oldBillQueryError = false
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('정산 결제완료 콜백: 학생의 진행중 상태 전체 종결', () => {
  it.each(IN_PROGRESS_STATUSES)('폴백 두 달 %s을 모두 종결하고 재호출에도 납부가 중복되지 않는다', async status => {
    db[STATUSES] = [statusRow(status, '2026-08'), statusRow(status, '2026-09')]
    await expectSuccess(await call())
    expect(db[STATUSES].map(row => [row.billing_month, row.status])).toEqual([
      ['2026-08', 'resettled_paid'], ['2026-09', 'resettled_paid'],
    ])
    await expectSuccess(await call())
    expect(db[STATUSES].every(row => row.status === 'resettled_paid')).toBe(true)
    expect(db[PAYMENTS]).toEqual([expect.objectContaining({
      student_id: STUDENT_ID, billing_month: '2026-08', amount: 100000, memo: `[bill:${BILL_ID}]`,
    })])
    expect(writeAuditLog).not.toHaveBeenCalled()
  })

  it('두 달 밖의 진행중도 닫되 기존 종결·기타 상태와 다른 학생 행은 그대로 보존한다', async () => {
    const preserved = [
      ...TERMINAL_STATUSES.map((status, i) => statusRow(status, `2026-0${i + 1}`)),
      statusRow('resettle_refund_failed', '2026-04'),
      statusRow('resettle_pending', '2026-09', 'another-synthetic-student'),
      statusRow('resettle_scheduled', '2026-08', 'another-synthetic-student'),
    ]
    db[STATUSES].push(statusRow('resettle_scheduled', '2026-07'), ...structuredClone(preserved))
    await expectSuccess(await call())
    expect(db[STATUSES].slice(0, 3).map(row => row.status)).toEqual(Array(3).fill('resettled_paid'))
    expect(db[STATUSES].slice(3)).toEqual(preserved)
  })

  it('청구월 상태행이 없어도 기존처럼 생성하고 다른 달의 진행중을 닫는다', async () => {
    db[STATUSES] = [statusRow('resettle_pending', '2026-09')]
    await expectSuccess(await call())
    expect(db[STATUSES]).toHaveLength(2)
    for (const billing_month of ['2026-08', '2026-09']) {
      expect(db[STATUSES]).toContainEqual(expect.objectContaining({ billing_month, status: 'resettled_paid' }))
    }
  })

  it.each(['error', 'throw'] as const)('진행중 UPDATE %s 실패도 0000·납부 기록을 유지하고 경고 감사로그를 남긴다', async failure => {
    statusUpdateFailure = failure
    await expectSuccess(await call())
    expect(db[HISTORY][0].status).toBe('paid')
    expect(db[STATUSES].map(row => row.status)).toEqual(['resettled_paid', 'resettle_pending'])
    expect(db[PAYMENTS]).toEqual([expect.objectContaining({ amount: 100000, memo: `[bill:${BILL_ID}]` })])
    expect(writeAuditLog).toHaveBeenCalledWith(
      'payment', STUDENT_ID, 'update', expect.stringMatching(/^⚠️.*종결.*실패/),
      expect.objectContaining({ bill_id: BILL_ID, error: '합성 종결 UPDATE 실패' }),
    )
    statusUpdateFailure = null
    await expectSuccess(await call())
    expect(db[STATUSES].every(row => row.status === 'resettled_paid')).toBe(true)
    expect(db[PAYMENTS]).toHaveLength(1)
  })

  it('일반 청구 결제는 정산 상태를 변경하지 않는다', async () => {
    db[HISTORY][0].bill_note = null
    const before = structuredClone(db[STATUSES])
    await expectSuccess(await call())
    expect(db[STATUSES]).toEqual(before)
    expect(db[PAYMENTS]).toHaveLength(1)
  })

  it('미결제 콜백은 진행중 상태를 종결하지 않는다', async () => {
    const before = structuredClone(db[STATUSES])
    await expectSuccess(await call('W'))
    expect(db[STATUSES]).toEqual(before)
    expect(db[PAYMENTS]).toHaveLength(0)
  })

  it('supersedes는 기존 결제 환불·납부 해제 뒤 정산 납부를 기록하고 재호출에 환불을 반복하지 않는다', async () => {
    db[HISTORY][0].supersedes_bill_id = 'synthetic-old-bill'
    db[HISTORY].push({ bill_id: 'synthetic-old-bill', student_id: STUDENT_ID,
      billing_month: '2026-08', amount: 300000, status: 'paid' })
    db[PAYMENTS] = [{ id: 'synthetic-old-payment', student_id: STUDENT_ID,
      billing_month: '2026-08', amount: 300000, method: 'payssam', memo: '[bill:synthetic-old-bill]' }]
    let statusesDuringRefund: Row[] = []
    vi.mocked(cancelBill).mockImplementation(async () => {
      statusesDuringRefund = structuredClone(db[STATUSES])
      events.push('refund')
      return { code: '0000', msg: '합성 환불 성공' }
    })
    vi.mocked(clearPaymentForBill).mockImplementation(async () => {
      events.push('clear-payment')
      db[PAYMENTS] = []
      return 1
    })
    await expectSuccess(await call())
    expect(statusesDuringRefund.map(row => [row.billing_month, row.status])).toEqual([
      ['2026-08', 'resettled_paid'], ['2026-09', 'resettle_pending'],
    ])
    expect(db[STATUSES].map(row => [row.billing_month, row.status])).toEqual([
      ['2026-08', 'resettled_paid'], ['2026-09', 'resettled_paid'],
    ])
    await expectSuccess(await call())
    expect(cancelBill).toHaveBeenCalledExactlyOnceWith('synthetic-old-bill', 300000)
    expect(clearPaymentForBill).toHaveBeenCalledExactlyOnceWith(STUDENT_ID, '2026-08', 'synthetic-old-bill', 300000)
    expect(events.filter(event => ['refund', 'clear-payment', `${PAYMENTS}:insert`].includes(event)))
      .toEqual(['refund', 'clear-payment', `${PAYMENTS}:insert`])
    expect(db[PAYMENTS]).toEqual([expect.objectContaining({ amount: 100000, memo: `[bill:${BILL_ID}]` })])
    expect(db[STATUSES].every(row => row.status === 'resettled_paid')).toBe(true)
  })
})

describe('폴백 정산 환불 결과에 따른 진행중 상태 보존 (v2)', () => {
  beforeEach(() => {
    db[HISTORY][0].supersedes_bill_id = OLD_BILL_ID
    db[HISTORY].push({ bill_id: OLD_BILL_ID, student_id: STUDENT_ID,
      billing_month: '2026-08', amount: 300000, status: 'paid' })
    db[PAYMENTS] = [{ id: 'synthetic-old-payment', student_id: STUDENT_ID,
      billing_month: '2026-08', amount: 300000, method: 'payssam', memo: `[bill:${OLD_BILL_ID}]` }]
  })

  it.each(IN_PROGRESS_STATUSES.flatMap(status =>
    (['code', 'throw'] as const).map(failure => ({ status, failure })),
  ))('환불 $failure 실패 시 요청 월 $status 보존·기준 달 실패 표시·납부 미기록·0000', async ({ status, failure }) => {
    db[STATUSES] = [statusRow(status, '2026-08'), statusRow(status, '2026-09')]
    const requestedMonth = structuredClone(db[STATUSES][1])
    const paymentsBefore = structuredClone(db[PAYMENTS])
    if (failure === 'code') {
      vi.mocked(cancelBill).mockResolvedValue({ code: '9999', msg: '합성 환불 거절' })
    } else {
      vi.mocked(cancelBill).mockRejectedValue(new Error('합성 환불 예외'))
    }

    await expectSuccess(await call())

    expect(cancelBill).toHaveBeenCalledExactlyOnceWith(OLD_BILL_ID, 300000)
    expect(db[STATUSES][1]).toEqual(requestedMonth)
    expect(db[STATUSES][0]).toMatchObject({ billing_month: '2026-08', status: 'resettle_refund_failed' })
    expect(db[HISTORY][0].status).toBe('paid')
    expect(db[HISTORY][1].status).toBe('paid')
    expect(db[PAYMENTS]).toEqual(paymentsBefore)
    expect(clearPaymentForBill).not.toHaveBeenCalled()
    expect(writeAuditLog).toHaveBeenCalledWith(
      'payment', STUDENT_ID, 'update', expect.stringMatching(/^⚠️.*환불/),
      expect.objectContaining({ newBillId: BILL_ID, refundBillId: OLD_BILL_ID }),
    )
  })

  it.each(['error', 'missing'] as const)('기존 청구서 조회 %s이면 요청 월을 보존하고 납부를 기록하지 않는다', async failure => {
    oldBillQueryError = failure === 'error'
    if (failure === 'missing') db[HISTORY].pop()
    const requestedMonth = structuredClone(db[STATUSES][1])
    const paymentsBefore = structuredClone(db[PAYMENTS])

    await expectSuccess(await call())

    expect(db[STATUSES][1]).toEqual(requestedMonth)
    // 조회 실패/없음 분기는 기존대로 첫 청구월 upsert만 남긴다. 새 실패 상태를 쓰지 않는다.
    expect(db[STATUSES][0]).toMatchObject({ billing_month: '2026-08', status: 'resettled_paid' })
    expect(db[PAYMENTS]).toEqual(paymentsBefore)
    expect(cancelBill).not.toHaveBeenCalled()
    expect(clearPaymentForBill).not.toHaveBeenCalled()
    expect(writeAuditLog).toHaveBeenCalledWith(
      'payment', STUDENT_ID, 'update', expect.stringMatching(/^⚠️.*조회 실패\/없음/),
      expect.objectContaining({ newBillId: BILL_ID, oldBillId: OLD_BILL_ID }),
    )
  })
})
