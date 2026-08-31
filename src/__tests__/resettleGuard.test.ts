import { describe, it, expect } from 'vitest'
import { isGuardExemptResettle } from '@/lib/resettleGuard'

/**
 * 크론 중복발송 가드의 면제 판정.
 * 2026-07-22 야간검수 #1: 미납형 정산분까지 면제해버려 '예약 후 현장수납 → 이중청구'가 뚫렸다.
 * 그 회귀를 막는 테스트 — 미납형은 절대 면제되면 안 된다.
 */
describe('isGuardExemptResettle', () => {
  it('환불형(supersedesBillId 보유)은 면제한다 — 기존 완납분과 의도적으로 공존해야 하므로', () => {
    expect(isGuardExemptResettle({ supersedesBillId: 'TM-abc123' })).toBe(true)
  })

  it('🔴 미납형(resettleUnpaid)은 면제하지 않는다 — 낸 돈이 없어 면제 근거가 없다', () => {
    expect(isGuardExemptResettle({ resettleUnpaid: true })).toBe(false)
  })

  it('일반 예약분은 면제하지 않는다', () => {
    expect(isGuardExemptResettle({})).toBe(false)
    expect(isGuardExemptResettle(null)).toBe(false)
    expect(isGuardExemptResettle(undefined)).toBe(false)
  })

  it('미납형 플래그가 있어도 supersedesBillId가 없으면 면제 안 됨 (플래그는 진단용 마커일 뿐)', () => {
    expect(isGuardExemptResettle({ resettleUnpaid: true, supersedesBillId: undefined })).toBe(false)
  })

  it('환불형이면 미납형 플래그가 섞여 있어도 면제한다 (supersedesBillId가 판정 기준)', () => {
    expect(isGuardExemptResettle({ supersedesBillId: 'TM-x', resettleUnpaid: true })).toBe(true)
  })
})
