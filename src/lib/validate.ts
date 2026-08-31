import { NextResponse } from 'next/server'

type ValidationRule = {
  field: string
  check: () => boolean
  message: string
}

/** 공통 API 입력 검증 헬퍼 */
export function validateInput(rules: ValidationRule[]): NextResponse | null {
  const errors = rules.filter(r => !r.check()).map(r => r.message)
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
  }
  return null
}

/** 자주 쓰이는 검증 규칙들 */
export const rules = {
  requiredString: (field: string, value: unknown): ValidationRule => ({
    field,
    check: () => typeof value === 'string' && value.trim() !== '',
    message: `${field} is required and must be a non-empty string`,
  }),

  optionalString: (field: string, value: unknown): ValidationRule => ({
    field,
    check: () => value === undefined || (typeof value === 'string' && value.trim() !== ''),
    message: `${field} must be a non-empty string`,
  }),

  required: (field: string, value: unknown): ValidationRule => ({
    field,
    check: () => value !== undefined && value !== null && value !== '',
    message: `${field} is required`,
  }),

  validDate: (field: string, value: unknown): ValidationRule => ({
    field,
    check: () => typeof value === 'string' && !isNaN(Date.parse(value)),
    message: `${field} must be a valid date (YYYY-MM-DD)`,
  }),

  optionalDate: (field: string, value: unknown): ValidationRule => ({
    field,
    check: () => value === undefined || (typeof value === 'string' && !isNaN(Date.parse(value))),
    message: `${field} must be a valid date (YYYY-MM-DD)`,
  }),

  nonNegativeNumber: (field: string, value: unknown): ValidationRule => ({
    field,
    // Number() 강제변환만 하면 문자열·소수·지수표기가 통과한다 — 금액은 0 이상 '정수 number'만
    // (2026-08-13 라인리뷰. 프론트는 parseInt/Number로 보내므로 number 타입 강제가 안전)
    check: () => value === undefined || value === null ||
      (typeof value === 'number' && Number.isInteger(value) && value >= 0),
    message: `${field} must be a non-negative integer`,
  }),

  billingMonth: (field: string, value: unknown): ValidationRule => ({
    field,
    check: () => typeof value === 'string' && /^\d{4}-\d{2}$/.test(value),
    message: `${field} must be in YYYY-MM format`,
  }),

  oneOf: (field: string, value: unknown, allowed: string[]): ValidationRule => ({
    field,
    check: () => typeof value === 'string' && allowed.includes(value),
    message: `${field} must be one of: ${allowed.join(', ')}`,
  }),
}
