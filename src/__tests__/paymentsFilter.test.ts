import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { getStudentFee, getPaymentStatus, type Class, type Student } from '@/types'
import { isOverdueUnsent } from '@/lib/utils'

// 페이지 내부 콜백 자체를 실행한다. UI 리팩터 없이 스냅샷 기준 판정·의존성을 검증한다.
const source = ts.createSourceFile('page.tsx', readFileSync('src/app/payments/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let declaration: ts.VariableDeclaration | undefined
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'passesFilter') declaration = node
  ts.forEachChild(node, visit)
}
visit(source)
if (!declaration) throw new Error('payments 페이지의 passesFilter 콜백을 찾을 수 없습니다')
const code = ts.transpile(`const ${declaration.getText(source)};`, { target: ts.ScriptTarget.ES2022 })

type Overrides = {
  paymentFilter?: string
  billStatus?: 'unsent' | 'sent' | 'paid' | 'cancelled' | 'destroyed' | 'scheduled'
  duePassed?: boolean
  payments?: { amount: number }[]
}

function filter(snapshotFee: number | undefined, paid: number, overrides: Overrides = {}) {
  const feeForMonth = vi.fn((_id: string, _month: string, liveFee: number) => snapshotFee ?? liveFee)
  let dependencies: unknown[] = []
  const context = {
    useCallback: (fn: unknown, deps: unknown[]) => { dependencies = deps; return fn },
    aiFilterIds: null, customStart: null, customEnd: null, today: '2026-08-12',
    paymentFilter: overrides.paymentFilter ?? 'unpaid',
    paymentsByStudentId: new Map([['s1', overrides.payments ?? [{ amount: paid }]]]), selectedMonth: '2026-08',
    hasSplitDueDays: () => false, getPaymentDueDay: () => 1,
    // 기본은 '결제일 지남'(false = 예정 아님). duePassed=false 로 주면 아직 안 지난 상태를 흉내낸다
    isPaymentScheduled: () => overrides.duePassed === false,
    getStudentFee, getPaymentStatus, feeForMonth,
    getBillStatus: () => overrides.billStatus ?? 'unsent',
    isOverdueUnsent,
  }
  const passesFilter = new Function(...Object.keys(context), `${code}\nreturn passesFilter`)(...Object.values(context)) as (student: Student, cls: Class) => boolean
  const result = passesFilter({ id: 's1', custom_fee: null, electives: [], payment_due_day: 1 } as unknown as Student, { monthly_fee: 450000 } as Class)
  return { result, dependencies, feeForMonth }
}

describe('미납 필터 확정 요금 (#11)', () => {
  it('스냅샷 30만원 완납은 현재 요금 45만원이어도 미납 목록에서 제외', () => {
    const { result, feeForMonth, dependencies } = filter(300000, 300000)
    expect(result).toBe(false)
    expect(feeForMonth).toHaveBeenCalledWith('s1', '2026-08', 450000)
    expect(dependencies).toContain(feeForMonth)
  })
  it('스냅샷 50만원 중 45만원 납부는 미납 목록에 포함', () => {
    expect(filter(500000, 450000).result).toBe(true)
  })
  it('스냅샷 없으면 현재 요금 기준 정상 흐름 유지', () => {
    expect(filter(undefined, 450000).result).toBe(false)
    expect(filter(undefined, 300000).result).toBe(true)
  })
})

describe('청구지연 필터 (2026-09-12) — 날짜 지났는데 청구서 안 나간 학생', () => {
  const overdue = (o: Overrides) => filter(undefined, 0, { paymentFilter: 'overdue_unsent', payments: [], ...o }).result

  it('결제일 지남 + 미발송 + 납부 없음 = 포함', () => {
    expect(overdue({ billStatus: 'unsent' })).toBe(true)
  })
  it('결제일이 아직 안 지났으면 제외', () => {
    expect(overdue({ billStatus: 'unsent', duePassed: false })).toBe(false)
  })
  it('예약 대기(scheduled)·발송됨·완납은 제외', () => {
    expect(overdue({ billStatus: 'scheduled' })).toBe(false)
    expect(overdue({ billStatus: 'sent' })).toBe(false)
    expect(overdue({ billStatus: 'paid' })).toBe(false)
  })
  it('다른 수단으로 이미 받았으면 제외', () => {
    expect(overdue({ billStatus: 'unsent', payments: [{ amount: 450000 }] })).toBe(false)
  })
})

describe('청구지연 — 분할 결제일(정규≠선택과목) 학생 (2026-09-12 코드 검수 P2)', () => {
  // 결제일과 청구 상태를 **같은 유형끼리** 봐야 한다. 정규 5일 발송완료 + 선택 20일 미발송인 학생을
  // 12일에 보면, 옛 구현은 '지난 결제일(정규)'과 '미발송(선택)'을 섞어 지연으로 잘못 잡았다.
  function splitFilter(opts: {
    regularDuePassed: boolean
    electivesDuePassed: boolean
    regularStatus: 'unsent' | 'sent'
    electivesStatus: 'unsent' | 'sent'
  }) {
    const feeForMonth = vi.fn((_id: string, _month: string, liveFee: number) => liveFee)
    const context = {
      useCallback: (fn: unknown) => fn,
      aiFilterIds: null, customStart: null, customEnd: null, paymentFilter: 'overdue_unsent', today: '2026-08-12',
      paymentsByStudentId: new Map([['s1', []]]), selectedMonth: '2026-08',
      hasSplitDueDays: () => true,
      getPaymentDueDay: () => 5,
      // 결제일별로 '아직 예정인가'를 다르게 답한다 (5=정규, 20=선택과목)
      isPaymentScheduled: (_s: unknown, _m: string, day?: number) =>
        day === 20 ? !opts.electivesDuePassed : !opts.regularDuePassed,
      getStudentFee: () => 450000,
      getStudentBaseFee: () => 350000,
      getStudentElectivesFee: () => 100000,
      getPaymentStatus, feeForMonth, isOverdueUnsent,
      getBillStatus: (_id: string, type: 'regular' | 'electives' = 'regular') =>
        type === 'electives' ? opts.electivesStatus : opts.regularStatus,
    }
    const passesFilter = new Function(...Object.keys(context), `${code}\nreturn passesFilter`)(...Object.values(context)) as (student: Student, cls: Class) => boolean
    return passesFilter(
      { id: 's1', custom_fee: null, electives: [{ name: '확통', fee: 100000 }], payment_due_day: 5, electives_payment_due_day: 20 } as unknown as Student,
      { monthly_fee: 350000 } as Class,
    )
  }

  it('정규는 발송됐고 선택과목 결제일이 아직 안 왔으면 지연 아님 (오탐 재발 방지)', () => {
    expect(splitFilter({ regularDuePassed: true, electivesDuePassed: false, regularStatus: 'sent', electivesStatus: 'unsent' })).toBe(false)
  })
  it('정규 결제일 지났는데 정규가 미발송이면 지연', () => {
    expect(splitFilter({ regularDuePassed: true, electivesDuePassed: false, regularStatus: 'unsent', electivesStatus: 'unsent' })).toBe(true)
  })
  it('선택과목 결제일까지 지났는데 선택과목이 미발송이면 지연', () => {
    expect(splitFilter({ regularDuePassed: true, electivesDuePassed: true, regularStatus: 'sent', electivesStatus: 'unsent' })).toBe(true)
  })
  it('둘 다 발송됐으면 지연 아님', () => {
    expect(splitFilter({ regularDuePassed: true, electivesDuePassed: true, regularStatus: 'sent', electivesStatus: 'sent' })).toBe(false)
  })
})
