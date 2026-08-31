import { NextRequest, NextResponse } from 'next/server'
import { createSessionToken, COOKIE_NAME, MAX_AGE, safeEqual } from '@/lib/auth'
import { getClientIp } from '@/lib/client-ip'
import {
  pinLockRemainingSec, recordPinFailure, clearPinFailures, pinAttemptsRemaining,
} from '@/lib/pin-lockout'

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers)

  // IP별 연속실패 잠금 검사 — 검증보다 먼저 (2026-07-26)
  const locked = pinLockRemainingSec(ip)
  if (locked > 0) {
    return NextResponse.json(
      { success: false, error: `너무 많이 틀렸습니다. ${Math.ceil(locked / 60)}분 후 다시 시도하세요.`, retryAfter: locked },
      { status: 429, headers: { 'Retry-After': String(locked) } },
    )
  }

  let id: unknown, password: unknown
  try {
    ({ id, password } = await request.json())
  } catch {
    return NextResponse.json({ success: false, error: '잘못된 요청 형식' }, { status: 400 })
  }

  const adminId = process.env.ADMIN_ID
  const adminPassword = process.env.ADMIN_PASSWORD

  if (!adminId || !adminPassword) {
    console.error('[Auth] ADMIN_ID 또는 ADMIN_PASSWORD 환경변수가 설정되지 않았습니다!')
    return NextResponse.json({ success: false, error: '서버 설정 오류' }, { status: 500 })
  }

  const idInput = typeof id === 'string' ? id : ''
  const passwordInput = typeof password === 'string' ? password : ''

  const idMatch = safeEqual(idInput, adminId)
  const passwordMatch = safeEqual(passwordInput, adminPassword)

  if (idMatch && passwordMatch) {
    clearPinFailures(ip)
    const response = NextResponse.json({ success: true })
    response.cookies.set(COOKIE_NAME, createSessionToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: MAX_AGE,
      path: '/',
    })
    return response
  }

  // 실패 시 약간의 딜레이로 brute-force 비용 상승
  await new Promise(r => setTimeout(r, 300))

  // 실패 카운트 (성공 시엔 위에서 clear). 임계 도달 시 이 IP만 잠근다.
  const lockedNow = recordPinFailure(ip)
  if (lockedNow > 0) {
    return NextResponse.json(
      { success: false, error: `너무 많이 틀렸습니다. ${Math.ceil(lockedNow / 60)}분 후 다시 시도하세요.`, retryAfter: lockedNow },
      { status: 429, headers: { 'Retry-After': String(lockedNow) } },
    )
  }
  // 계정 열거 방지: ID/비번 구분 없이 동일 문구
  const remaining = pinAttemptsRemaining(ip)
  return NextResponse.json(
    { success: false, error: `아이디 또는 비밀번호가 올바르지 않습니다. 앞으로 ${remaining}번 틀리면 잠깁니다.`, remaining },
    { status: 401 },
  )
}
