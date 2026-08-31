// 강사 급여 계산 — 단일 소스 (2026-08-13 라인리뷰: teachers/[id]·finance가 각자 하드코딩하고
// 테스트는 제3의 복제본을 검증하고 있었다 — 셋 다 여기로 통일, 테스트가 프로덕션 코드를 문다)

export const SALARY_TAX_RATE = 0.033 // 원천징수 3.3%
export const DEFAULT_PAY_RATIO = 40  // 기본 배분율 40%

export interface TeacherPay {
  share: number // 배분액 = 수납액 × 비율
  gross: number // 배분액 + 보너스
  tax: number   // 원천징수 (gross × 3.3%, 반올림)
  net: number   // 실수령
}

export function calcTeacherPay(paidTotal: number, payRatio: number, bonus: number): TeacherPay {
  const share = Math.round(paidTotal * payRatio / 100)
  const gross = share + bonus
  const tax = Math.round(gross * SALARY_TAX_RATE)
  return { share, gross, tax, net: gross - tax }
}
