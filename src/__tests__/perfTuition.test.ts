import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
type Query = { table: string; op: string; columns: string; payload: Row; filters: ((r: Row) => boolean)[] }
const tables: Record<string, Row[]> = {}
const queries: Query[] = []
let dbError: (q: Query) => { code: string; message: string } | null = () => null
let beforeQuery: (q: Query) => void = () => {}
let delay: (q: Query) => Promise<void> = async () => {}
// SELECT는 스냅샷, 조건부 UPDATE는 실행 시 현재 행에 적용하는 DB 대역.
function builder(table: string) {
  const q: Query = { table, op: 'select', columns: '*', payload: {}, filters: [] }
  let single = false
  let returning = false
  const b = {
    select(columns: string) { q.columns = columns; returning = true; return b },
    eq(k: string, v: unknown) { q.filters.push(r => r[k] === v); return b },
    is(k: string, v: unknown) { return b.eq(k, v) },
    in(k: string, v: unknown[]) { q.filters.push(r => v.includes(r[k])); return b },
    lt(k: string, v: string) { q.filters.push(r => String(r[k]) < v); return b },
    lte(k: string, v: string) { q.filters.push(r => String(r[k]) <= v); return b },
    limit() { return b },
    order() { return b },
    maybeSingle() { single = true; return b },
    single() { single = true; return b },
    update(payload: Row) { q.op = 'update'; q.payload = payload; return b },
    insert(payload: Row) { q.op = 'insert'; q.payload = payload; return b },
    upsert(payload: Row) { q.op = 'upsert'; q.payload = payload; return b },
    async then(resolve: (v: { data: unknown; error: { code: string; message: string } | null }) => unknown, reject: (e: unknown) => unknown) {
      try {
        queries.push(q)
        beforeQuery(q)
        const error = dbError(q)
        if (error) return resolve({ data: null, error })
        const source = tables[table] ?? (tables[table] = [])
        let rows = source.filter(r => q.filters.every(f => f(r)))
        if (q.op === 'update') rows.forEach(r => Object.assign(r, q.payload))
        if (q.op === 'insert' && table === 'tuition_monthly_memos' && source.some(r => r.billing_month === q.payload.billing_month)) {
          return resolve({ data: null, error: { code: '23505', message: 'duplicate monthly PK' } })
        }
        if (q.op === 'insert' || q.op === 'upsert') {
          const old = q.op === 'upsert' ? source.find(r => r.billing_month === q.payload.billing_month) : undefined
          const row = old ? Object.assign(old, q.payload) : { ...q.payload }
          if (!old) source.push(row)
          rows = [row]
        }
        const projected = rows.map(r => q.columns === '*' ? { ...r } : Object.fromEntries(
          q.columns.split(',').map(k => k.trim()).filter(k => k in r).map(k => [k, r[k]]),
        ))
        const data = q.op !== 'select' && !returning ? null : single ? projected[0] ?? null : projected
        await delay(q)
        return resolve({ data, error: null })
      } catch (e) { return reject(e) }
    },
  }
  return b
}
const sendBill = vi.fn()
const recordSentBill = vi.fn()
const destroyBill = vi.fn()
const realStatus = vi.fn()
const audit = vi.fn()
const resolveWarnings = vi.fn()
const alimtalk = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => builder(table) } }))
vi.mock('@/lib/auth', () => ({ requireAdminSession: () => null, requireCronSecret: () => null }))
vi.mock('@/lib/payssam', () => ({ sendBill: (...a: unknown[]) => sendBill(...a), destroyBill: (...a: unknown[]) => destroyBill(...a), fetchPaySsamStatus: (...a: unknown[]) => realStatus(...a) }))
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: (...a: unknown[]) => audit(...a), resolveAuditWarnings: (...a: unknown[]) => resolveWarnings(...a) }))
vi.mock('@/lib/solapi', () => ({ sendAlimtalk: (...a: unknown[]) => alimtalk(...a) }))
vi.mock('@/lib/schedule', () => ({ isBusinessHourKst: () => true }))
vi.mock('@/lib/billHistory', () => ({ recordSentBill: (...a: unknown[]) => recordSentBill(...a) }))
import { GET as sendQueued } from '@/app/api/cron/send-queued/route'
import { mapGradesTree } from '@/lib/queries'
import { POST as checkIn } from '@/app/api/attendance/check-in/route'
import { PUT as memoPut } from '@/app/api/monthly-memo/route'
import { GET as queueGet } from '@/app/api/billing/queue/route'
import { processOverdueDestroys } from '@/lib/deferredDestroy'

const request = (path: string, body?: unknown) => new NextRequest(`http://test.invalid${path}`, body === undefined ? undefined : {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
})
const Q = 'tuition_bill_queue'
const H = 'tuition_bill_history'
beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  queries.length = 0
  delay = async () => {}
  dbError = () => null
  beforeQuery = () => {}
  sendBill.mockReset().mockResolvedValue({ code: '0000', bill_id: 'new' })
  recordSentBill.mockReset().mockResolvedValue({ error: null })
  destroyBill.mockReset().mockResolvedValue({ code: '0000' })
  realStatus.mockReset().mockResolvedValue('sent')
  audit.mockReset()
  resolveWarnings.mockReset()
  alimtalk.mockReset().mockResolvedValue({})
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('실제 네트워크 금지') }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('perf #1 명단 응답', () => {
  it('원본 중첩 없이 별칭·학생 전체 필드 보존, 모의 200명 JSON 감소', () => {
    const students = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, name: `fixture-${i}`, phone: 'fixture-phone', memo: 'fixture-memo', electives: [], custom_fee: 0 }))
    const raw = [{ id: 'g', name: '학년', order_index: 0, tuition_classes: [{ id: 'c', grade_id: 'g', name: '반', monthly_fee: 100, order_index: 0, tuition_teachers: { id: 't', pay_ratio: 0.5 }, tuition_students: students }] }]
    const mapped = mapGradesTree(raw)
    const legacy = raw.map(g => ({ ...g, classes: g.tuition_classes.map(c => ({ ...c, teacher: c.tuition_teachers, students: c.tuition_students })) }))
    const before = JSON.stringify(legacy).length
    const after = JSON.stringify(mapped).length
    console.info(`perf #1 JSON chars: ${before} -> ${after}`)
    expect(mapped[0]).not.toHaveProperty('tuition_classes')
    expect(mapped[0].classes[0]).not.toHaveProperty('tuition_teachers')
    expect(mapped[0].classes[0]).not.toHaveProperty('tuition_students')
    expect(mapped[0].classes[0].teacher).toEqual(raw[0].tuition_classes[0].tuition_teachers)
    expect(mapped[0].classes[0].students).toEqual(students)
    expect(after).toBeLessThan(before / 2)
    expect(raw[0].tuition_classes[0].tuition_students).toEqual(students)
  })
})

describe('perf #2 키오스크 병렬 조회', () => {
  const setup = (note: string | null = null) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-07T03:00:00Z'))
    vi.stubEnv('SOLAPI_TEMPLATE_CHECKIN', 'fixture-template')
    vi.stubEnv('SOLAPI_API_KEY', 'fixture-key')
    tables.tuition_students = [
      { id: 's1', name: 'fixture', class_id: 'c1', parent_phone: 'fixture-phone', withdrawal_date: null, attendance_code: '1234' },
      { id: 's2', name: 'fixture', class_id: 'c2', parent_phone: 'fixture-phone', withdrawal_date: null, attendance_code: '1234' },
    ]
    tables.tuition_classes = [{ id: 'c1', subject: '수학', class_days: '1,3,5' }, { id: 'c2', subject: '영어', class_days: '2,4' }]
    tables.tuition_attendance = [{ id: 'a1', student_id: 's1', date: '2026-09-07', note }]
    delay = q => new Promise(r => setTimeout(r, q.op !== 'select' ? 0 : q.table === 'tuition_attendance' ? 40 : q.columns === 'class_id' || q.table === 'tuition_classes' ? 20 : 0))
  }
  it('두 과목 조회 20+20ms와 오늘 출결 40ms를 겹쳐 기다린다', async () => {
    setup()
    const start = Date.now()
    let elapsed = 0
    const pending = checkIn(request('/check-in', { code: '1234', action: 'check_in' })).then(r => { elapsed = Date.now() - start; return r })
    await vi.runAllTimersAsync()
    const res = await pending
    console.info(`perf #2 injected wait: ${elapsed}ms (serial 80ms)`)
    expect(elapsed).toBeLessThan(80)
    expect(await res.json()).toMatchObject({ ok: true, action: 'check_in', student: { name: 'fixture', classCount: 2 } })
    expect(tables.tuition_attendance[0].note).toBe('수학')
    expect(alimtalk).toHaveBeenCalledTimes(1)
  })
  it('기존 메모·best-effort 과목 조회 실패를 보존한다', async () => {
    setup('관리자 메모')
    delay = async q => { if (q.columns === 'class_id') throw new Error('모의 조회 실패') }
    const res = await checkIn(request('/check-in', { code: '1234', action: 'check_in' }))
    expect(res.status).toBe(200)
    expect(tables.tuition_attendance[0].note).toBe('관리자 메모')
  })
})

describe('perf #4 월별 메모 조건부 저장', () => {
  it('baseUpdatedAt 불일치 → 409 + 서버 현재값, 저장된 내용 보존', async () => {
    tables.tuition_monthly_memos = [{ billing_month: '2026-09', content: '다른 기기 내용', updated_at: '2026-09-07T03:00:00.000Z' }]
    const res = await memoPut(request('/memo', { month: '2026-09', content: '오래된 기기', baseUpdatedAt: '2026-09-07T02:00:00.000Z' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'MEMO_CONFLICT', content: '다른 기기 내용', updated_at: '2026-09-07T03:00:00.000Z' })
    expect(tables.tuition_monthly_memos[0].content).toBe('다른 기기 내용')
  })
  it('같은 버전 동시 PUT은 하나만 성공한다', async () => {
    const baseUpdatedAt = '2026-09-01T00:00:00.000Z'
    tables.tuition_monthly_memos = [{ billing_month: '2026-09', content: '기존', updated_at: baseUpdatedAt }]
    const responses = await Promise.all(['A', 'B'].map(content => memoPut(request('/memo', { month: '2026-09', content, baseUpdatedAt }))))
    expect(responses.map(r => r.status).sort()).toEqual([200, 409])
    const success = await responses.find(r => r.status === 200)!.json()
    expect(success.updated_at).toBe(tables.tuition_monthly_memos[0].updated_at)
    expect(success.updated_at).not.toBe(baseUpdatedAt)
  })
  it('같은 밀리초의 갱신도 버전을 바꿔 다음 stale PUT을 거절한다', async () => {
    vi.useFakeTimers()
    const baseUpdatedAt = '2026-09-07T03:00:00.000Z'
    vi.setSystemTime(new Date(baseUpdatedAt))
    tables.tuition_monthly_memos = [{ billing_month: '2026-09', content: '기존', updated_at: baseUpdatedAt }]
    const first = await memoPut(request('/memo', { month: '2026-09', content: '최신', baseUpdatedAt }))
    expect(first.status).toBe(200)
    const stale = await memoPut(request('/memo', { month: '2026-09', content: '옛 기기', baseUpdatedAt }))
    expect(stale.status).toBe(409)
    expect(tables.tuition_monthly_memos[0].content).toBe('최신')
  })
  it.each([null, undefined])('baseUpdatedAt=%s 새 월 첫 저장 + 새 updated_at 반환', async baseUpdatedAt => {
    const res = await memoPut(request('/memo', { month: '2026-09', content: '호환', baseUpdatedAt }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, updated_at: tables.tuition_monthly_memos[0].updated_at })
  })
})

describe('perf #7 지연 파기 선점', () => {
  const setup = (retry = 0) => {
    tables[Q] = [{ id: 'q1', student_name: 'fixture', send_type: 'destroy', status: 'pending', scheduled_at: '2020-01-01', payload: { billId: 'b1', amount: 100 }, retry_count: retry }]
    tables[H] = [{ bill_id: 'b1', status: 'sent' }]
  }
  it('같은 pending 스냅샷을 두 실행이 읽어도 외부 파기는 1회', async () => {
    setup()
    // 양쪽 pending 조회가 모두 끝난 뒤에만 진행한다.
    let reads = 0
    let release!: () => void
    const barrier = new Promise<void>(r => { release = r })
    delay = async q => { if (q.table === Q && q.op === 'select') { if (++reads === 2) release(); await barrier } }
    const processed = await Promise.all([processOverdueDestroys(), processOverdueDestroys()])
    expect(destroyBill).toHaveBeenCalledTimes(1)
    expect(processed.reduce((a, b) => a + b)).toBe(1)
    expect(tables[Q][0].status).toBe('sent')
  })
  it('파기 실패는 processing에서 pending 복귀 후 다음 실행에서 재시도', async () => {
    setup()
    const observed: unknown[] = []
    destroyBill.mockImplementationOnce(async () => { observed.push(tables[Q][0].status); throw new Error('HTTP 502') })
    await processOverdueDestroys()
    expect(observed).toEqual(['processing'])
    expect(tables[Q][0]).toMatchObject({ status: 'pending', retry_count: 1 })
    await processOverdueDestroys()
    expect(destroyBill).toHaveBeenCalledTimes(2)
    expect(tables[Q][0].status).toBe('sent')
  })
  it('3회 최종 실패와 기파기 자가치유를 보존한다', async () => {
    setup(2)
    destroyBill.mockResolvedValue({ code: '9999', msg: '거절' })
    await processOverdueDestroys()
    expect(tables[Q][0]).toMatchObject({ status: 'failed', retry_count: 3 })
    expect(audit).toHaveBeenCalledTimes(1)
    setup()
    destroyBill.mockResolvedValue({ code: '9999', msg: '청구서를 찾을 수 없습니다' })
    realStatus.mockResolvedValue('destroyed')
    await processOverdueDestroys()
    expect(tables[Q][0].status).toBe('cancelled')
    expect(tables[H][0].status).toBe('destroyed')
    expect(resolveWarnings).toHaveBeenCalledTimes(1)
  })
})

it('perf #8 electives pending 응답에 bill_type 보존', async () => {
  tables[Q] = [{ id: 'q1', billing_month: '2026-09', bill_type: 'electives', status: 'pending', send_type: 'single' }]
  const res = await queueGet(request('/queue?month=2026-09'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual([expect.objectContaining({ bill_type: 'electives' })])
  expect(destroyBill).not.toHaveBeenCalled()
})

// 주간 라인리뷰 #1: 대역은 실제 월 PK를 강제한다. 응답뿐 아니라 최종 저장 내용도 대조한다.
describe('첫 월 메모 충돌', () => {
  const M = 'tuition_monthly_memos'
  it.each([null, undefined])('기존 행에 base=%s 첫 저장은 409, 내용 보존', async baseUpdatedAt => {
    tables[M] = [{ billing_month: '2026-09', content: '선행 저장', updated_at: 'v1' }]
    const res = await memoPut(request('/memo', { month: '2026-09', content: '덮기', baseUpdatedAt }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'MEMO_CONFLICT', content: '선행 저장', updated_at: 'v1' })
    expect(tables[M]).toEqual([{ billing_month: '2026-09', content: '선행 저장', updated_at: 'v1' }])
  })
  it.each([null, undefined])('빈 월의 동시 첫 저장 base=%s는 200 하나·409 하나', async baseUpdatedAt => {
    const responses = await Promise.all(['A', 'B'].map(content => memoPut(request('/memo', { month: '2026-09', content, baseUpdatedAt }))))
    expect(responses.map(r => r.status).sort()).toEqual([200, 409])
    expect(tables[M]).toHaveLength(1)
    expect(await responses.find(r => r.status === 409)!.json()).toMatchObject({ code: 'MEMO_CONFLICT', content: tables[M][0].content, updated_at: tables[M][0].updated_at })
  })
  it.each(['insert', 'read'])('%s DB 실패는 충돌로 위장하지 않고 500', async stage => {
    tables[M] = [{ billing_month: '2026-09', content: '보존', updated_at: 'v1' }]
    dbError = q => q.table === M && q.op === (stage === 'insert' ? 'insert' : 'select') ? { code: '08006', message: 'synthetic DB down' } : null
    const res = await memoPut(request('/memo', { month: '2026-09', content: '변경', baseUpdatedAt: null }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'synthetic DB down' })
    expect(tables[M][0].content).toBe('보존')
  })
})

const setupDestroy = (overrides: Row = {}) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-14T03:00:00Z'))
  tables[Q] = [{ id: 'q1', student_name: 'fixture', send_type: 'destroy', status: 'processing', updated_at: '2026-09-14T02:30:00.000Z', scheduled_at: '2020-01-01', payload: { billId: 'b1', amount: 100 }, retry_count: 1, ...overrides }]
  tables[H] = [{ bill_id: 'b1', status: 'sent' }]
}
const destroyRunners = [
  ['lazy', () => processOverdueDestroys()],
  ['cron', () => sendQueued(request('/cron'))],
] as const

describe.each(destroyRunners)('파기 선점 복구 %s', (_name, run) => {
  it('pending이 없어도 정확히 30분 지난 destroy를 회수·처리, 예약·retry 보존', async () => {
    setupDestroy()
    await run()
    expect(tables[Q][0]).toMatchObject({ status: 'sent', retry_count: 1, scheduled_at: '2020-01-01', updated_at: '2026-09-14T03:00:00.000Z' })
    expect(destroyBill).toHaveBeenCalledOnce()
    expect(audit.mock.calls.filter(a => String(a[3]).includes('고착 복구 —'))).toHaveLength(1)
  })
  it.each(['single', 'reissue', 'split', 'resend', 'fresh', 'no_claim_time'])('%s processing은 복구하지 않는다', async type => {
    setupDestroy(type === 'fresh' ? { updated_at: '2026-09-14T02:30:00.001Z' } : type === 'no_claim_time' ? { updated_at: null } : { send_type: type })
    await run()
    expect(tables[Q][0].status).toBe('processing')
    expect(destroyBill).not.toHaveBeenCalled()
    expect(sendBill).not.toHaveBeenCalled()
    expect(audit.mock.calls.filter(a => String(a[3]).includes('고착 복구 —'))).toHaveLength(0)
  })
  it('복구 UPDATE 직전 다른 작업이 갱신한 선점은 건드리지 않고 복구 로그도 없다', async () => {
    setupDestroy()
    beforeQuery = q => { if (q.table === Q && q.op === 'update' && q.payload.status === 'pending') tables[Q][0].updated_at = '2026-09-14T02:59:00.000Z' }
    await run()
    expect(tables[Q][0].status).toBe('processing')
    expect(audit.mock.calls.filter(a => String(a[3]).includes('고착 복구 —'))).toHaveLength(0)
  })
  it('복구가 경합해도 실제 복구 로그·파기는 한 번', async () => {
    setupDestroy()
    await Promise.all([run(), run()])
    expect(destroyBill).toHaveBeenCalledOnce()
    expect(audit.mock.calls.filter(a => String(a[3]).includes('고착 복구 —'))).toHaveLength(1)
  })
  it.each(['sent', 'pending', 'failed', 'cancelled'])('%s 종료 UPDATE 오류는 고착을 숨기지 않고 경고', async status => {
    setupDestroy({ status: 'pending', retry_count: status === 'failed' ? 2 : 0 })
    if (status === 'cancelled') tables[H][0].status = 'paid'
    if (status === 'pending' || status === 'failed') destroyBill.mockResolvedValue({ code: '9999', msg: '거절' })
    dbError = q => q.table === Q && q.op === 'update' && q.payload.status === status && (status === 'sent' || 'error_msg' in q.payload) ? { code: '08006', message: 'synthetic finish down' } : null
    await run()
    expect(tables[Q][0].status).toBe('processing')
    expect(audit.mock.calls.some(a => String(a[3]).includes('⚠️ 지연 파기 큐 종료 저장 실패'))).toBe(true)
  })
  it.each(['0000', '9999', 'throw'])('복구·재선점 뒤 옛 작업(%s)은 새 processing을 덮지 않는다', async outcome => {
    setupDestroy({ status: 'pending' })
    let release!: (value: { code: string; msg?: string }) => void
    let reject!: (error: Error) => void
    let entered!: () => void
    const started = new Promise<void>(r => { entered = r })
    destroyBill.mockImplementationOnce(() => { entered(); return new Promise((r, j) => { release = r; reject = j }) })
    const oldWork = run()
    await started
    vi.setSystemTime(new Date('2026-09-14T03:31:00Z'))
    // 두 번째 실행도 선점 후 외부 호출에서 멈춘다.
    let finishNew!: (value: { code: string }) => void
    let enteredNew!: () => void
    const newStarted = new Promise<void>(r => { enteredNew = r })
    destroyBill.mockImplementationOnce(() => { enteredNew(); return new Promise(r => { finishNew = r }) })
    const newWork = run()
    await newStarted
    const newClaim = { ...tables[Q][0] }
    if (outcome === 'throw') reject(new Error('synthetic network failure'))
    else release({ code: outcome, msg: '거절' })
    await oldWork
    expect(tables[Q][0]).toEqual(newClaim)
    finishNew({ code: '0000' })
    await newWork
    expect(tables[Q][0].status).toBe('sent')
  })
  it('배치 앞 작업이 오래 걸려도 뒤 행은 실제 선점 시각부터 30분', async () => {
    setupDestroy({ status: 'pending' })
    tables[Q].push({ ...tables[Q][0], id: 'q2', payload: { billId: 'b2', amount: 200 } })
    tables[H].push({ bill_id: 'b2', status: 'sent' })
    destroyBill.mockImplementationOnce(async () => { vi.setSystemTime(new Date('2026-09-14T03:31:00Z')); return { code: '0000' } })
    await run()
    expect(tables[Q][1].updated_at).toBe('2026-09-14T03:31:00.000Z')
  })
})

const setupSend = (type: string, persist = false) => {
  tables[Q] = [{ id: 'q1', student_id: 's1', student_name: 'fixture', phone: 'fixture-phone', billing_month: '2026-09', status: 'pending', scheduled_at: '2020-01-01', send_type: type, is_regular_tuition: false, retry_count: 0,
    payload: { amount: 100, amounts: [40, 60], productName: 'fixture', message: 'fixture', oldBillId: 'old', persist, supersedesBillId: type === 'single' ? 'paid-old' : undefined } }]
  tables[H] = []
}
describe('예약 발송 알려진 성공과 저장 예외 분리', () => {
  it.each(['single', 'reissue', 'split'])('%s 이력 throw도 전건 성공은 sent, 다음 실행에 재발송 없음', async type => {
    setupSend(type)
    recordSentBill.mockRejectedValue(new Error('synthetic history throw'))
    const result = await (await sendQueued(request('/cron'))).json()
    expect(result).toMatchObject({ sent: 1, failed: 0, retrying: 0 })
    expect(tables[Q][0].status).toBe('sent')
    expect(audit.mock.calls.filter(a => String(a[3]).includes('DB기록 실패'))).toHaveLength(type === 'split' ? 2 : 1)
    await sendQueued(request('/cron'))
    expect(sendBill).toHaveBeenCalledTimes(type === 'split' ? 2 : 1)
  })
  for (const type of ['single', 'reissue', 'split']) it.each(['error', 'throw'])(`${type} 큐 sent 저장 %s는 성공 집계 금지·processing 유지·경고`, async failure => {
    setupSend(type)
    const matches = (q: Query) => q.table === Q && q.op === 'update' && q.payload.status === 'sent'
    if (failure === 'error') dbError = q => matches(q) ? { code: '08006', message: 'queue down' } : null
    else beforeQuery = q => { if (matches(q)) throw new Error('queue throw') }
    const result = await (await sendQueued(request('/cron'))).json()
    expect(result).toMatchObject({ sent: 0, failed: 0, retrying: 0, storageWarnings: ['q1'] })
    expect(tables[Q][0].status).toBe('processing')
    expect(audit.mock.calls.some(a => String(a[3]).includes('큐 sent 저장 실패'))).toBe(true)
    await sendQueued(request('/cron'))
    expect(sendBill).toHaveBeenCalledTimes(type === 'split' ? 2 : 1)
  })
  for (const type of ['single', 'split']) it.each(['error', 'throw'])(`${type} 후처리 %s도 sent 유지·경고`, async failure => {
    setupSend(type, true)
    const target = type === 'single' ? 'tuition_withdrawal_status' : 'tuition_students'
    if (failure === 'error') dbError = q => q.table === target ? { code: '08006', message: 'postprocess down' } : null
    else beforeQuery = q => { if (q.table === target) throw new Error('postprocess throw') }
    const result = await (await sendQueued(request('/cron'))).json()
    expect(result).toMatchObject({ sent: 1, failed: 0, retrying: 0, storageWarnings: ['q1'] })
    expect(tables[Q][0].status).toBe('sent')
  })
  it.each(['9999', 'throw'])('split 이력 throw 후 일부 외부 %s는 성공 건수 보존·원본 보존·재시도 금지', async failure => {
    setupSend('split', true)
    tables[H] = [{ bill_id: 'old', student_id: 's1', billing_month: '2026-09', status: 'sent', amount: 100, is_regular_tuition: true }]
    recordSentBill.mockRejectedValue(new Error('history throw'))
    sendBill.mockResolvedValueOnce({ code: '0000', bill_id: 'new1' })
    if (failure === 'throw') sendBill.mockRejectedValueOnce(new Error('send throw'))
    else sendBill.mockResolvedValueOnce({ code: '9999', msg: '거절' })
    const result = await (await sendQueued(request('/cron'))).json()
    expect(result).toMatchObject({ sent: 0, failed: 1, retrying: 0 })
    expect(tables[Q][0]).toMatchObject({ status: 'failed', error_msg: expect.stringContaining('1/2건 성공') })
    expect(destroyBill).not.toHaveBeenCalled()
    expect(queries.some(q => q.table === 'tuition_students')).toBe(false)
  })
})

it('예약 split: 조회 projection에 유형을 보존해 정규 교집합만 전건 발송 뒤 파기', async () => {
  setupSend('split', true)
  tables.tuition_students = [{ id: 's1' }]
  tables[H] = [
    ['regular', true, 'regular', 10], ['legacy', null, null, 20],
    ['electives', true, 'electives', 30], ['special', false, 'regular', 40], ['special-null', false, null, 50],
  ].map(([bill_id, is_regular_tuition, bill_type, amount]) => ({ bill_id, is_regular_tuition, bill_type, amount, student_id: 's1', billing_month: '2026-09', status: 'sent' }))
  destroyBill.mockImplementation(async () => { expect(sendBill).toHaveBeenCalledTimes(2); return { code: '0000' } })
  const result = await (await sendQueued(request('/cron'))).json()
  expect(result).toMatchObject({ sent: 1 })
  expect(destroyBill.mock.calls).toEqual([['regular', 10], ['legacy', 20]])
  expect(tables[H].filter(r => r.status === 'sent').map(r => r.bill_id)).toEqual(['electives', 'special', 'special-null'])
  expect(tables.tuition_students[0]).toMatchObject({ split_billing_parts: 2, split_billing_amounts: [40, 60] })
})

describe.each(destroyRunners)('파기 복구 오류·종결 throw %s', (_name, run) => {
  it.each(['error', 'throw'])('복구 UPDATE %s면 경고·현재 processing 보존', async kind => {
    setupDestroy()
    const recovery = (q: Query) => q.table === Q && q.op === 'update' && q.payload.status === 'pending'
    if (kind === 'error') dbError = q => recovery(q) ? { code: '08006', message: 'recovery down' } : null
    else beforeQuery = q => { if (recovery(q)) throw new Error('recovery throw') }
    await run()
    expect(tables[Q][0]).toMatchObject({ status: 'processing', retry_count: 1 })
    expect(destroyBill).not.toHaveBeenCalled()
    expect(audit.mock.calls.some(a => String(a[3]).includes('⚠️ 지연 파기 고착 복구 실패'))).toBe(true)
    expect(audit.mock.calls.some(a => String(a[3]).includes('고착 복구 —'))).toBe(false)
  })
  it('종료 저장 throw면 pending 재시도 없이 경고', async () => {
    setupDestroy({ status: 'pending' })
    beforeQuery = q => { if (q.table === Q && q.op === 'update' && q.payload.status === 'sent') throw new Error('finish throw') }
    await run()
    expect(tables[Q][0]).toMatchObject({ status: 'processing', retry_count: 1 })
    expect(audit.mock.calls.some(a => String(a[3]).includes('⚠️ 지연 파기 큐 종료 저장 실패'))).toBe(true)
  })
  it('선점 시각이 같아도 cancelled로 바뀐 행을 완료로 덮지 않는다', async () => {
    setupDestroy({ status: 'pending' })
    destroyBill.mockImplementationOnce(async () => { tables[Q][0].status = 'cancelled'; return { code: '0000' } })
    await run()
    expect(tables[Q][0].status).toBe('cancelled')
  })
})
it('reissue 알려진 성공 뒤 감사 후처리 throw도 재시도하지 않는다', async () => {
  setupSend('reissue')
  audit.mockImplementationOnce(async () => { throw new Error('synthetic postprocess throw') })
  const result = await (await sendQueued(request('/cron'))).json()
  expect(result).toMatchObject({ sent: 1, retrying: 0, failed: 0, storageWarnings: ['q1'] })
  expect(tables[Q][0].status).toBe('sent')
})
it('예약 split 파기 실패는 sent·응답·감사·persist 의미 보존', async () => {
  setupSend('split', true)
  tables.tuition_students = [{ id: 's1' }]
  tables[H] = [{ bill_id: 'old', amount: 100, is_regular_tuition: true, bill_type: 'regular', status: 'sent', student_id: 's1', billing_month: '2026-09' }]
  destroyBill.mockResolvedValue({ code: '9999', msg: 'synthetic reject' })
  const result = await (await sendQueued(request('/cron'))).json()
  expect(result).toMatchObject({ sent: 1, destroyFailed: ['old'] })
  expect(tables[Q][0]).toMatchObject({ status: 'sent', error_msg: expect.stringContaining('old') })
  expect(tables[H][0].status).toBe('sent')
  expect(tables.tuition_students[0]).toMatchObject({ split_billing_parts: 2 })
  expect(audit.mock.calls.some(a => String(a[3]).includes('기존 청구서 파기 실패'))).toBe(true)
})
it('큐 sent 조건부 저장이 0행이면 성공으로 집계하지 않고 경고', async () => {
  setupSend('single')
  sendBill.mockImplementationOnce(async () => {
    tables[Q][0].status = 'cancelled'
    return { code: '0000', bill_id: 'new' }
  })
  const result = await (await sendQueued(request('/cron'))).json()
  expect(result).toMatchObject({ sent: 0, retrying: 0, failed: 0, storageWarnings: ['q1'] })
  expect(tables[Q][0].status).toBe('cancelled')
})
