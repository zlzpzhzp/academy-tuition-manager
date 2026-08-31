/**
 * Sentry PII 마스킹 (2026-08-16 라인리뷰)
 *
 * 최상위 키만 마스킹하던 탓에 문자열 body와 중첩 객체·배열 안의 전화번호·학생명이
 * 그대로 외부(Sentry)로 나갔다.
 */
import { describe, it, expect } from 'vitest'
import type { ErrorEvent as SentryErrorEvent } from '@sentry/nextjs'
import { maskSentryEvent } from '@/lib/sentryMask'

const ev = (data: unknown): SentryErrorEvent =>
  ({ request: { data } }) as unknown as SentryErrorEvent
const dataOf = (e: SentryErrorEvent) => e.request!.data as Record<string, unknown>

describe('maskSentryEvent', () => {
  it('최상위 PII 키 마스킹 (기존 동작 유지)', () => {
    const out = dataOf(maskSentryEvent(ev({ phone: '010-1234-5678', pin: '1234', memo: '정상' })))
    expect(out.phone).toBe('<masked>')
    expect(out.pin).toBe('<masked>')
    expect(out.memo).toBe('정상') // 비민감 필드는 보존
  })

  it('중첩 객체 안의 PII도 마스킹', () => {
    const out = dataOf(maskSentryEvent(ev({
      student: { student_name: '홍길동', parent_phone: '010-1111-2222', class_id: 'c1' },
    })))
    const student = out.student as Record<string, unknown>
    expect(student.student_name).toBe('<masked>')
    expect(student.parent_phone).toBe('<masked>')
    expect(student.class_id).toBe('c1')
  })

  it('배열 안의 객체도 마스킹', () => {
    const out = dataOf(maskSentryEvent(ev({
      entries: [{ studentName: '홍길동', phone: '010-1111-2222', status: 'present' }],
    })))
    const first = (out.entries as Record<string, unknown>[])[0]
    expect(first.studentName).toBe('<masked>')
    expect(first.phone).toBe('<masked>')
    expect(first.status).toBe('present')
  })

  it('키 표기가 갈려도 phone 부분일치로 잡는다', () => {
    const out = dataOf(maskSentryEvent(ev({ parentFatherPhone: '010-3333-4444', phone_number: '010-5555-6666' })))
    expect(out.parentFatherPhone).toBe('<masked>')
    expect(out.phone_number).toBe('<masked>')
  })

  it('문자열 body는 통째로 마스킹 (형식을 알 수 없음)', () => {
    const e = maskSentryEvent(ev('{"phone":"010-1234-5678"}'))
    expect(e.request!.data).toBe('<masked>')
  })

  it('순환 참조도 깊이 상한으로 방어 — 예외 없이 반환', () => {
    const node: Record<string, unknown> = { name: 'root' }
    node.self = node
    expect(() => maskSentryEvent(ev(node))).not.toThrow()
  })

  it('쿠키는 전부 마스킹 (기존 동작 유지)', () => {
    const e = { request: { cookies: { auth_token: 'x', finance_session: 'y' } } } as unknown as SentryErrorEvent
    const out = maskSentryEvent(e).request!.cookies as Record<string, string>
    expect(out.auth_token).toBe('<masked>')
    expect(out.finance_session).toBe('<masked>')
  })
})
