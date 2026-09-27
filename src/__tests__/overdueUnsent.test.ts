import { describe, it, expect } from 'vitest'
import { isOverdueUnsent } from '@/lib/utils'

const base = { duePassed: true, billStatus: 'unsent' as const, hasPayments: false, fee: 350000 }

describe('isOverdueUnsent — 날짜 지났는데 청구서 안 나간 학생', () => {
  it('결제일 지남 + 미발송 + 미납 + 요금 있음 = 지연', () => {
    expect(isOverdueUnsent(base)).toBe(true)
  })
  it('결제일이 아직 안 지났으면 지연 아님', () => {
    expect(isOverdueUnsent({ ...base, duePassed: false })).toBe(false)
  })
  it('예약(scheduled)은 지연 아님 — 영업시간 되면 나간다', () => {
    expect(isOverdueUnsent({ ...base, billStatus: 'scheduled' })).toBe(false)
  })
  it('이미 발송·완납은 지연 아님', () => {
    expect(isOverdueUnsent({ ...base, billStatus: 'sent' })).toBe(false)
    expect(isOverdueUnsent({ ...base, billStatus: 'paid' })).toBe(false)
  })
  it('파기·취소는 의도적으로 없앤 것이라 지연 아님', () => {
    expect(isOverdueUnsent({ ...base, billStatus: 'destroyed' })).toBe(false)
    expect(isOverdueUnsent({ ...base, billStatus: 'cancelled' })).toBe(false)
  })
  it('다른 수단으로 이미 받았으면 지연 아님', () => {
    expect(isOverdueUnsent({ ...base, hasPayments: true })).toBe(false)
  })
  it('요금 0원(면제 학생)은 청구 대상 아님', () => {
    expect(isOverdueUnsent({ ...base, fee: 0 })).toBe(false)
  })
})
