import { describe, it, expect } from 'vitest'
import { rules, validateInput } from '@/lib/validate'

describe('rules.requiredString', () => {
  it('비어있지 않은 string 통과', () => {
    expect(rules.requiredString('name', 'foo').check()).toBe(true)
    expect(rules.requiredString('name', '  bar  ').check()).toBe(true)
  })
  it('빈 string / 공백만 / undefined 실패', () => {
    expect(rules.requiredString('name', '').check()).toBe(false)
    expect(rules.requiredString('name', '   ').check()).toBe(false)
    expect(rules.requiredString('name', undefined).check()).toBe(false)
    expect(rules.requiredString('name', null).check()).toBe(false)
    expect(rules.requiredString('name', 123).check()).toBe(false)
  })
})

describe('rules.required', () => {
  it('null/undefined/빈문자열만 실패', () => {
    expect(rules.required('id', 'foo').check()).toBe(true)
    expect(rules.required('id', 0).check()).toBe(true) // 0은 valid
    expect(rules.required('id', false).check()).toBe(true)
    expect(rules.required('id', undefined).check()).toBe(false)
    expect(rules.required('id', null).check()).toBe(false)
    expect(rules.required('id', '').check()).toBe(false)
  })
})

describe('rules.validDate', () => {
  it('YYYY-MM-DD 통과', () => {
    expect(rules.validDate('date', '2026-05-04').check()).toBe(true)
    expect(rules.validDate('date', '2026-12-31').check()).toBe(true)
  })
  it('잘못된 날짜는 실패', () => {
    expect(rules.validDate('date', 'not-a-date').check()).toBe(false)
    expect(rules.validDate('date', undefined).check()).toBe(false)
    expect(rules.validDate('date', '').check()).toBe(false)
  })
})

describe('rules.nonNegativeNumber', () => {
  it('0 또는 양수 통과', () => {
    expect(rules.nonNegativeNumber('amount', 0).check()).toBe(true)
    expect(rules.nonNegativeNumber('amount', 350000).check()).toBe(true)
    expect(rules.nonNegativeNumber('amount', undefined).check()).toBe(true)
    expect(rules.nonNegativeNumber('amount', null).check()).toBe(true)
  })
  it('음수 실패', () => {
    expect(rules.nonNegativeNumber('amount', -1).check()).toBe(false)
    expect(rules.nonNegativeNumber('amount', -350000).check()).toBe(false)
  })
})

describe('rules.billingMonth', () => {
  it('YYYY-MM 형식만 통과', () => {
    expect(rules.billingMonth('m', '2026-05').check()).toBe(true)
    expect(rules.billingMonth('m', '2026-12').check()).toBe(true)
  })
  it('다른 형식 실패', () => {
    expect(rules.billingMonth('m', '2026-5').check()).toBe(false)
    expect(rules.billingMonth('m', '26-05').check()).toBe(false)
    expect(rules.billingMonth('m', '2026-05-04').check()).toBe(false)
    expect(rules.billingMonth('m', undefined).check()).toBe(false)
  })
})

describe('rules.oneOf', () => {
  it('허용 값 안에 있으면 통과', () => {
    const allowed = ['card', 'cash', 'pay']
    expect(rules.oneOf('method', 'card', allowed).check()).toBe(true)
    expect(rules.oneOf('method', 'pay', allowed).check()).toBe(true)
  })
  it('허용 값 밖이면 실패', () => {
    const allowed = ['card', 'cash', 'pay']
    expect(rules.oneOf('method', 'unknown', allowed).check()).toBe(false)
    expect(rules.oneOf('method', '', allowed).check()).toBe(false)
    expect(rules.oneOf('method', undefined, allowed).check()).toBe(false)
  })
  it('error message에 허용 값 나열', () => {
    const r = rules.oneOf('method', 'unknown', ['card', 'cash'])
    expect(r.message).toContain('card')
    expect(r.message).toContain('cash')
  })
})

describe('validateInput', () => {
  it('모든 규칙 통과 → null', () => {
    const result = validateInput([
      rules.requiredString('name', 'foo'),
      rules.validDate('date', '2026-05-04'),
    ])
    expect(result).toBeNull()
  })

  it('실패 규칙 있으면 NextResponse 반환 (status 400)', () => {
    const result = validateInput([
      rules.requiredString('name', ''),
    ])
    expect(result).not.toBeNull()
    expect(result?.status).toBe(400)
  })

  it('여러 실패 시 메시지 합쳐짐', async () => {
    const result = validateInput([
      rules.requiredString('name', ''),
      rules.validDate('date', 'invalid'),
    ])
    expect(result).not.toBeNull()
    if (result) {
      const body = await result.json()
      expect(body.error).toContain('name')
      expect(body.error).toContain('date')
    }
  })
})

// 뮤테이션 드릴 2026-08-14: 정수·number 타입 강제(2026-08-13 픽스)가 무보증이었다(M29 생존).
// Number() 강제변환으로 완화되면 '1e5'·소수·숫자문자열이 통과해 청구액이 왜곡된다.
describe('rules.nonNegativeNumber 타입 강제', () => {
  it('0 이상 정수 number와 미지정(undefined/null)만 통과', () => {
    expect(rules.nonNegativeNumber('amount', 0).check()).toBe(true)
    expect(rules.nonNegativeNumber('amount', 350000).check()).toBe(true)
    expect(rules.nonNegativeNumber('amount', undefined).check()).toBe(true)
    expect(rules.nonNegativeNumber('amount', null).check()).toBe(true)
  })
  it("숫자문자열('1e5'·'100')·소수·음수·NaN 거부", () => {
    expect(rules.nonNegativeNumber('amount', '1e5').check()).toBe(false)
    expect(rules.nonNegativeNumber('amount', '100').check()).toBe(false)
    expect(rules.nonNegativeNumber('amount', 1.5).check()).toBe(false)
    expect(rules.nonNegativeNumber('amount', -1).check()).toBe(false)
    expect(rules.nonNegativeNumber('amount', NaN).check()).toBe(false)
  })
})
