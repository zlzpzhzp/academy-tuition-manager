/**
 * 결제선생 발송 판정 헬퍼 (2026-08-13 라인리뷰 P1-C/D)
 * send API는 결제선생 실패(code≠'0000')도 HTTP 200으로 준다 — r.ok만 보면 false-success.
 */
import { describe, it, expect } from 'vitest'
import { isSendSuccess, sendFailReason } from '@/lib/payssamJudge'

describe('isSendSuccess', () => {
  it('HTTP 200 + code 0000 = 성공', () => {
    expect(isSendSuccess({ ok: true }, { code: '0000' })).toBe(true)
  })
  it('HTTP 200 + SCHEDULED(영업시간 외 예약) = 성공', () => {
    expect(isSendSuccess({ ok: true }, { code: 'SCHEDULED' })).toBe(true)
  })
  it('P1-C 회귀: HTTP 200이라도 결제선생 실패코드면 실패', () => {
    expect(isSendSuccess({ ok: true }, { code: '9999' })).toBe(false)
    expect(isSendSuccess({ ok: true }, {})).toBe(false) // code 없는 이상 응답
  })
  it('HTTP 실패는 code와 무관하게 실패', () => {
    expect(isSendSuccess({ ok: false }, { code: '0000' })).toBe(false)
  })
})

describe('sendFailReason', () => {
  it('error > msg > HTTP status 순으로 사유를 고른다', () => {
    expect(sendFailReason({ status: 409 }, { error: '이미 납부한 학생입니다 (중복 청구 방지)' })).toContain('이미 납부')
    expect(sendFailReason({ status: 200 }, { msg: '수신번호 오류' })).toBe('수신번호 오류')
    expect(sendFailReason({ status: 500 }, {})).toBe('HTTP 500')
  })
})
