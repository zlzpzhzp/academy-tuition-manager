import { createHmac, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'

/**
 * HMAC 서명 비교는 반드시 상수시간으로. `a === b`는 첫 불일치 바이트에서 조기 리턴하므로
 * 서명을 바이트 단위로 맞춰가는 timing oracle이 성립한다(미들웨어는 src/lib/hmac-edge.ts 의
 * constant-time subtle.verify를 쓰는데 이 파일만 `===`였음 — 과거 감사에서 적발).
 * 길이가 다르면 timingSafeEqual이 예외를 던지므로 선검사 + 더미 비교로 평탄화.
 * 2026-08-13 라인리뷰로 export 승격 — login/finance/cron 시크릿 비교 공용 단일 구현.
 * (finance 사본은 32자 초과 입력에서 timingSafeEqual throw = 500 + 실패 카운트 미기록,
 *  requireCronSecret은 비상수시간 `!==` 비교였다 — 사본 제거하고 이걸 쓴다)
 */
export function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(bBuf, bBuf)
    return false
  }
  return timingSafeEqual(aBuf, bBuf)
}

const COOKIE_NAME = 'auth_token'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET 환경변수가 설정되지 않았거나 너무 짧습니다 (최소 16자)')
  }
  return secret
}

function sign(data: string): string {
  return createHmac('sha256', getSecret()).update(data).digest('base64url')
}

export function createSessionToken(): string {
  const adminId = process.env.ADMIN_ID || ''
  // ADMIN_ID가 비면 발급은 되는데 verifySessionToken(!adminId → false)이 전부 거부한다 —
  // '로그인 성공처럼 보이고 이후 모든 API 401' 미스터리 방지, 발급 시점에 명시적으로 죽인다 (2026-08-13 라인리뷰)
  if (!adminId.trim()) {
    throw new Error('ADMIN_ID 환경변수가 설정되지 않았습니다 — 세션 토큰을 발급해도 검증에서 전부 거부됩니다')
  }
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE
  const body = `${adminId}|${exp}`
  const payload = Buffer.from(body).toString('base64url')
  const signature = sign(body)
  return `${payload}.${signature}`
}

export function verifySessionToken(token: string): boolean {
  if (!token) return false
  const dotIdx = token.indexOf('.')
  if (dotIdx < 0) return false

  try {
    const payload = token.slice(0, dotIdx)
    const signature = token.slice(dotIdx + 1)
    const body = Buffer.from(payload, 'base64url').toString('utf-8')
    const pipeIdx = body.lastIndexOf('|')
    if (pipeIdx < 0) return false
    const adminId = body.slice(0, pipeIdx)
    const exp = Number(body.slice(pipeIdx + 1))
    if (!adminId || !adminId.trim()) return false
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false
    const expected = sign(body)
    return safeEqual(signature, expected)
  } catch {
    return false
  }
}

/**
 * Mutating API 라우트용 defense-in-depth 가드.
 * 미들웨어가 모든 경로에서 이미 검증하지만, 미들웨어 버그/우회 대비해
 * 라우트에서도 재확인. 인증 실패 시 401 Response 반환, 성공 시 null.
 *
 * 사용: `const unauthorized = requireAdminSession(request); if (unauthorized) return unauthorized`
 */
/**
 * Cookie 헤더에서 같은 이름의 값을 **전부** 뽑는다.
 * 중복 쿠키(같은 이름 2개+)가 실렸을 때 하나만 집으면, 그게 남의(서명 불일치) 토큰이면 인증이 깨진다.
 * 실제 사고(2026-07-14 자매 앱 세션 쿠키 Domain 승격 → 다른 서브도메인 앱(teacher.example.com)에 자매 앱 토큰까지
 * 실려 401 7일 장애)의 원인이 '하나만 집는 파싱'이었다. 원비 auth_token 은 host-only라 즉시 위험은
 * 없지만, 미들웨어(request.cookies.get=마지막)와 이 가드(정규식=첫번째)가 서로 다른 쿠키를 집어
 * '페이지는 열리는데 API 401'이 재현됐다(2026-07-21 실측). → 후보 전부 검증, 하나라도 유효하면 통과.
 */
export function extractCookieValues(cookieHeader: string, name: string): string[] {
  const out: string[] = []
  const re = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(cookieHeader)) !== null) {
    try { out.push(decodeURIComponent(m[1])) } catch { out.push(m[1]) }
  }
  return out
}

export function requireAdminSession(request: Request): NextResponse | null {
  const cookieHeader = request.headers.get('cookie') || ''
  const candidates = extractCookieValues(cookieHeader, 'auth_token')
  // 중복 쿠키 관용: 후보 중 하나라도 유효하면 통과 (첫 후보가 남의 토큰이어도 뒤 후보로 복구)
  if (!candidates.some(t => verifySessionToken(t))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

/**
 * Vercel/시스템 Cron 라우트용 CRON_SECRET Bearer 가드.
 * 인증 실패 시 401 Response 반환, 성공 시 null (requireAdminSession과 동일 계약).
 * 사용: `const unauthorized = requireCronSecret(request); if (unauthorized) return unauthorized`
 */
export function requireCronSecret(request: Request): NextResponse | null {
  const authHeader = request.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret || !safeEqual(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export { COOKIE_NAME, MAX_AGE }

/* ─── Finance(원장 전용) PIN 인증 토큰 ──────────────────────────────────
 * audit 2026-05-10 P0 fix — sessionStorage + 클라이언트 PIN 비교 결함 제거.
 * 같은 SESSION_SECRET으로 HMAC 서명. 30일 만료.
 * payload = "finance|<exp>" / cookie = `${payload}.${signature}` (base64url)
 */

const FINANCE_COOKIE_NAME = 'finance_session'

export function createFinanceToken(): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE
  const body = `finance|${exp}`
  const payload = Buffer.from(body).toString('base64url')
  const signature = sign(body)
  return `${payload}.${signature}`
}

export function verifyFinanceToken(token: string): boolean {
  if (!token) return false
  const dotIdx = token.indexOf('.')
  if (dotIdx < 0) return false
  try {
    const payload = token.slice(0, dotIdx)
    const signature = token.slice(dotIdx + 1)
    const body = Buffer.from(payload, 'base64url').toString('utf-8')
    if (!body.startsWith('finance|')) return false
    const exp = Number(body.slice('finance|'.length))
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false
    const expected = sign(body)
    return safeEqual(signature, expected)
  } catch {
    return false
  }
}

/**
 * 요청에 유효한 finance PIN 쿠키가 실렸는지 판정 (미들웨어 PIN 게이트와 같은 토큰·같은 코어).
 * 미들웨어가 게이트하지 않는 공용 라우트(/api/teachers 등)에서 **응답 필드 단위로**
 * 원장 전용 데이터(pay_ratio)를 가리거나 쓰기를 막는 데 쓴다.
 * 401을 반환하는 가드가 아니라 boolean 판정이라는 점에 주의 — 라우트 자체는 admin 세션으로 통과해야 한다.
 */
export function hasFinanceSession(request: Request): boolean {
  const cookieHeader = request.headers.get('cookie') || ''
  const candidates = extractCookieValues(cookieHeader, FINANCE_COOKIE_NAME)
  return candidates.some(t => verifyFinanceToken(t))
}

/** 원장 전용(급여) 필드 — PIN 없는 응답에서는 제거한다. */
export function stripFinanceFields<T extends Record<string, unknown>>(row: T): Omit<T, 'pay_ratio'> {
  const { pay_ratio: _payRatio, ...rest } = row
  void _payRatio
  return rest
}

export { FINANCE_COOKIE_NAME }
