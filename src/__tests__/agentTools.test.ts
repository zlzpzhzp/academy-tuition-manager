import { describe, it, expect, vi, beforeEach } from 'vitest'

// agentTools → queries → supabase 체인 차단 (supabase는 import 시 env 없으면 throw)
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queries')>()
  return {
    ...actual, // mapGradesTree는 순수 함수라 실물 사용
    queryGradesTree: vi.fn(),
    queryPaidMap: vi.fn(),
    querySnapshotFeeMap: vi.fn(),
  }
})

import { queryGradesTree, queryPaidMap, querySnapshotFeeMap } from '@/lib/queries'
import { getUnpaidStudents, getPaymentStatusByMonth } from '@/lib/agentTools'

// 실데이터 모사 (2026-08-13 실측): 고3 수학N — 반비 45만, 확통 선택과목 20만
const RAW_GRADES = [
  {
    id: 'g1', name: '고3', order_index: 1,
    tuition_classes: [
      {
        id: 'c1', name: 'N', subject: '수학', monthly_fee: 450000, order_index: 1,
        tuition_teachers: null,
        tuition_students: [
          // P1 시나리오: 확통 수강생이 기본요금만 납부 → 정본 요금은 65만
          { id: 's-park', name: '유재석', custom_fee: null, electives: ['확통'], withdrawal_date: null, enrollment_date: '2026-03-01' },
          // 확통 수강생 전액(65만) 납부 → 완납
          { id: 's-seo', name: '강호동', custom_fee: null, electives: ['확통'], withdrawal_date: null, enrollment_date: '2026-03-01' },
          // 스냅샷 정본 시나리오(태연 실측): 그 달 스냅샷 38만 vs 현재 반비 45만
          { id: 's-lee', name: '태연', custom_fee: 350000, electives: [], withdrawal_date: null, enrollment_date: '2026-03-01' },
          // 월중 퇴원(아이유 실측): 8월 재적이므로 8월 미납엔 포함, 9월엔 제외
          { id: 's-out', name: '아이유', custom_fee: null, electives: [], withdrawal_date: '2026-08-07', enrollment_date: '2026-03-01' },
          // 미래 등록: 8월 명단에 없어야 함
          { id: 's-new', name: '신입생', custom_fee: null, electives: [], withdrawal_date: null, enrollment_date: '2026-09-02' },
        ],
      },
    ],
  },
]

const mockGrades = vi.mocked(queryGradesTree)
const mockPaid = vi.mocked(queryPaidMap)
const mockSnap = vi.mocked(querySnapshotFeeMap)

beforeEach(() => {
  vi.clearAllMocks()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockGrades.mockResolvedValue({ data: RAW_GRADES as any, error: null })
  mockPaid.mockResolvedValue({ paidMap: {}, error: null })
  mockSnap.mockResolvedValue({ feeMap: {}, error: null })
})

type UnpaidResult = { billing_month: string; total_unpaid: number; students: { name: string; fee: number; paid: number }[] }
type StatusResult = { classes: { total_students: number; paid_count: number; unpaid_count: number; total_fee: number; total_paid: number }[] }

describe('getUnpaidStudents — 요금 정본', () => {
  it('P1: 선택과목 수강생이 기본요금만 냈으면 미납으로 잡힌다 (선택과목비 합산)', async () => {
    mockPaid.mockResolvedValue({ paidMap: { 's-park': 450000 }, error: null })
    const res = await getUnpaidStudents({ billing_month: '2026-08' }) as UnpaidResult
    const park = res.students.find(s => s.name === '유재석')
    expect(park).toBeDefined()
    expect(park!.fee).toBe(650000) // 45만 + 확통 20만 — custom_fee ?? monthly_fee 였으면 45만=완납으로 은폐
    expect(park!.paid).toBe(450000)
  })

  it('선택과목 포함 전액 납부자는 미납에 없다', async () => {
    mockPaid.mockResolvedValue({ paidMap: { 's-seo': 650000 }, error: null })
    const res = await getUnpaidStudents({ billing_month: '2026-08' }) as UnpaidResult
    expect(res.students.find(s => s.name === '강호동')).toBeUndefined()
  })

  it('과거 월 요금은 그 달 스냅샷이 정본 (현재 요금 재계산 금지)', async () => {
    mockSnap.mockResolvedValue({ feeMap: { 's-lee': 380000 }, error: null })
    mockPaid.mockResolvedValue({ paidMap: { 's-lee': 350000 }, error: null })
    const res = await getUnpaidStudents({ billing_month: '2026-07' }) as UnpaidResult
    const lee = res.students.find(s => s.name === '태연')
    expect(lee).toBeDefined()
    expect(lee!.fee).toBe(380000) // 현재 custom_fee 35만이 아니라 그 달 스냅샷 38만
  })

  it('재적 판정은 월 기준: 월중 퇴원자는 그 달 미납에 포함, 다음 달엔 제외', async () => {
    const aug = await getUnpaidStudents({ billing_month: '2026-08' }) as UnpaidResult
    expect(aug.students.find(s => s.name === '아이유')).toBeDefined() // 8/7 퇴원 = 8월 재적
    expect(aug.students.find(s => s.name === '신입생')).toBeUndefined() // 9월 등록 = 8월 비재적

    const sep = await getUnpaidStudents({ billing_month: '2026-09' }) as UnpaidResult
    expect(sep.students.find(s => s.name === '아이유')).toBeUndefined()
    expect(sep.students.find(s => s.name === '신입생')).toBeDefined()
  })

  it('납부 조회 실패는 명단 대신 error를 돌려준다', async () => {
    mockPaid.mockResolvedValue({ paidMap: {}, error: { message: 'DB down', details: '', hint: '', code: '500', name: 'PostgrestError' } as never })
    const res = await getUnpaidStudents({ billing_month: '2026-08' }) as { error?: string }
    expect(res.error).toContain('납부 기록 조회에 실패')
  })

  it('스냅샷 조회 실패도 명단 대신 error를 돌려준다', async () => {
    mockSnap.mockResolvedValue({ feeMap: {}, error: { message: 'DB down', details: '', hint: '', code: '500', name: 'PostgrestError' } as never })
    const res = await getUnpaidStudents({ billing_month: '2026-08' }) as { error?: string }
    expect(res.error).toContain('요금 스냅샷 조회에 실패')
  })

  it('billing_month 형식이 틀리면 error', async () => {
    const res = await getUnpaidStudents({ billing_month: '8월' }) as { error?: string }
    expect(res.error).toContain('YYYY-MM')
    expect(mockGrades).not.toHaveBeenCalled()
  })
})

describe('getPaymentStatusByMonth — 같은 정본 공유', () => {
  it('반별 합계에 선택과목비·스냅샷·월 기준 재적이 모두 반영된다', async () => {
    mockSnap.mockResolvedValue({ feeMap: { 's-lee': 380000 }, error: null })
    mockPaid.mockResolvedValue({ paidMap: { 's-park': 450000, 's-seo': 650000 }, error: null })
    const res = await getPaymentStatusByMonth({ billing_month: '2026-08' }) as StatusResult
    expect(res.classes).toHaveLength(1)
    const c = res.classes[0]
    expect(c.total_students).toBe(4) // 신입생(9월 등록) 제외, 아이유(8/7 퇴원) 포함
    expect(c.total_fee).toBe(650000 + 650000 + 380000 + 450000) // 유재석+강호동+태연(스냅샷)+아이유
    expect(c.total_paid).toBe(1100000)
    expect(c.paid_count).toBe(1) // 강호동만 (유재석 45만<65만)
    expect(c.unpaid_count).toBe(3)
  })

  it('billing_month 형식이 틀리면 error', async () => {
    const res = await getPaymentStatusByMonth({ billing_month: '2026-13' }) as { error?: string }
    expect(res.error).toContain('YYYY-MM')
  })
})
