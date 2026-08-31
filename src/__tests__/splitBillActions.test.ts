// 분할 청구 액션 대상 선정 회귀 (2026-08-16 주간 라인리뷰 high)
// 호출부가 '첫 분할 id + 합계'를 보내면 서버 AMOUNT_MISMATCH 가드에 100% 막혔다 —
// 액션은 반드시 건별 (billId, amount) 쌍으로, 상태에 맞는 청구서만 골라 실행한다.
import { describe, it, expect } from 'vitest'
import { pickSplitActionTargets, type SplitActionBill } from '@/lib/splitBillActions'

const BILLS: SplitActionBill[] = [
  { billId: 'TM-a', amount: 450000, status: 'sent' },
  { billId: 'TM-b', amount: 200000, status: 'sent' },
]

describe('pickSplitActionTargets', () => {
  it('파기/재발송/재발행은 sent 건만, 건별 (billId, 자기 금액) 쌍으로 고른다 — 합계 아님', () => {
    for (const kind of ['destroy', 'resend', 'reissue'] as const) {
      const targets = pickSplitActionTargets(kind, BILLS)
      expect(targets).toEqual(BILLS) // 각자 자기 금액 — 650,000 합계가 어디에도 없다
      expect(targets.map(t => t.amount)).not.toContain(650000)
    }
  })

  it('취소(환불)는 paid 건만 고른다', () => {
    const mixed: SplitActionBill[] = [
      { billId: 'TM-a', amount: 450000, status: 'paid' },
      { billId: 'TM-b', amount: 200000, status: 'sent' },
    ]
    expect(pickSplitActionTargets('cancel', mixed)).toEqual([mixed[0]])
    expect(pickSplitActionTargets('destroy', mixed)).toEqual([mixed[1]])
  })

  it('파기·취소된 건은 어떤 액션 대상에도 안 들어간다', () => {
    const dead: SplitActionBill[] = [
      { billId: 'TM-x', amount: 100000, status: 'destroyed' },
      { billId: 'TM-y', amount: 100000, status: 'cancelled' },
    ]
    for (const kind of ['destroy', 'cancel', 'resend', 'reissue'] as const) {
      expect(pickSplitActionTargets(kind, dead)).toEqual([])
    }
  })
})
