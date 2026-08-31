import { NextResponse } from 'next/server'
import { requireAdminSession, createFinanceToken, FINANCE_COOKIE_NAME, MAX_AGE, safeEqual } from '@/lib/auth'
import { getClientIp } from '@/lib/client-ip'
import {
  pinLockRemainingSec, recordPinFailure, clearPinFailures, pinAttemptsRemaining,
} from '@/lib/pin-lockout'

/**
 * Finance(원장 전용) PIN 인증 — audit 2026-05-10 P0 fix.
 *
 * 흐름:
 *   - 클라가 PIN 입력 → POST /api/auth/finance { pin } → 서버에서 timingSafeEqual 비교
 *   - 통과 시 HMAC 서명된 finance_session 쿠키 발급 (httpOnly + 30일 + Same-Site Lax)
 *   - middleware.ts가 /finance/* 모든 요청에 finance_session 검증 → 미통과 /finance/auth 리다이렉트
 *
 * 보안:
 *   - 어드민 세션이 이미 있어야 PIN 검증 시도 가능 (defense-in-depth)
 *   - 인공 200ms 지연 — brute-force 비용 상승
 *   - PIN은 환경변수 FINANCE_PIN. 클라이언트 코드에서 완전 제거.
 *   - 쿠키는 HMAC SHA-256 서명 — sessionStorage 위조나 raw 쿠키 set 불가능.
 */

export async function POST(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  const ip = getClientIp(request.headers)

  // IP별 연속실패 잠금 검사 — PIN 검증보다 먼저 (2026-07-26)
  const locked = pinLockRemainingSec(ip)
  if (locked > 0) {
    return NextResponse.json(
      { error: `너무 많이 틀렸습니다. ${Math.ceil(locked / 60)}분 후 다시 시도하세요.`, retryAfter: locked },
      { status: 429, headers: { 'Retry-After': String(locked) } },
    )
  }

  const { pin } = await request.json().catch(() => ({}))
  const expected = process.env.FINANCE_PIN

  if (!expected) {
    console.error('[Finance Auth] FINANCE_PIN 환경변수 미설정')
    return NextResponse.json({ error: 'PIN이 설정되지 않았습니다' }, { status: 500 })
  }

  await new Promise(r => setTimeout(r, 200))

  if (typeof pin !== 'string' || !safeEqual(pin, expected)) {
    // 실패 카운트. 임계 도달 시 이 IP만 잠근다.
    const lockedNow = recordPinFailure(ip)
    if (lockedNow > 0) {
      return NextResponse.json(
        { error: `너무 많이 틀렸습니다. ${Math.ceil(lockedNow / 60)}분 후 다시 시도하세요.`, retryAfter: lockedNow },
        { status: 429, headers: { 'Retry-After': String(lockedNow) } },
      )
    }
    const remaining = pinAttemptsRemaining(ip)
    return NextResponse.json(
      { error: `PIN이 올바르지 않습니다. 앞으로 ${remaining}번 틀리면 잠깁니다.`, remaining },
      { status: 401 },
    )
  }

  clearPinFailures(ip)
  const token = createFinanceToken()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(FINANCE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE,
    path: '/',
  })
  return res
}

export async function DELETE(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const res = NextResponse.json({ ok: true })
  res.cookies.set(FINANCE_COOKIE_NAME, '', { path: '/', maxAge: 0 })
  return res
}
