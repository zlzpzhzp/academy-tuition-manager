import { NextRequest, NextResponse } from 'next/server'
import { verify } from '@/lib/hmac-edge'
import { getClientIp } from '@/lib/client-ip'

// Rate Limit (P0 #4, 2026-05-05) — in-memory LRU per process
const rlCache = new Map<string, number[]>()
const RL_SOFT_SIZE = 10000 // 이 크기를 넘으면 만료분 prune 시작
const RL_HARD_CAP = 20000 // 살아있는 키만으로 이만큼 차면 오래된 것부터 버린다
const RL_PRUNE_INTERVAL = 30_000 // prune 최소 간격 (2026-08-16 라인리뷰: 매 변경요청 O(n) 순회 방지)
let rlLastPrune = 0

// 상한 도달 시 전체 clear는 모든 IP의 카운터·잠금을 동시에 리셋한다 — 만료분만 prune (2026-08-13 라인리뷰).
// 다만 만료분 prune만으로는 살아있는 키가 상한을 넘을 때 맵이 무한 성장한다 → 오래된 순 축출로 하드 상한
// 유지 (2026-08-16 라인리뷰). Edge 런타임이라 Node 전용 API는 쓰지 않는다.
function rlPrune(now: number) {
  rlLastPrune = now
  for (const [k, v] of rlCache) {
    const alive = v.filter((t) => now - t < 5 * 60_000) // 가장 긴 창(auth 5분) 기준
    if (alive.length === 0) rlCache.delete(k)
    else rlCache.set(k, alive)
  }
  if (rlCache.size > RL_HARD_CAP) {
    // 정확히 상한까지만 줄이면 다음 요청마다 다시 넘으므로 여유(90%)를 두고 축출한다.
    // stamps는 시간순 push라 마지막 원소가 그 키의 최신 활동 시각.
    const byAge = [...rlCache.entries()].sort((a, b) => (a[1][a[1].length - 1] ?? 0) - (b[1][b[1].length - 1] ?? 0))
    const target = Math.floor(RL_HARD_CAP * 0.9)
    for (let i = 0; i < byAge.length - target; i++) rlCache.delete(byAge[i][0])
  }
}

function rateLimitOk(ip: string, kind: 'auth' | 'api'): boolean {
  // 2026-07-04: auth 10회/5분이 너무 빡빡 — 원장이 로그인 실수·여러 기기로 몇 번 시도하면
  // 잠겨서 "로그인 안 됨" 사고. brute-force는 60회/5분으로도 무의미(비번 강도)하므로 완화.
  const limit = kind === 'auth' ? 60 : 200
  const win = kind === 'auth' ? 5 * 60_000 : 60_000
  const now = Date.now()
  const key = `${ip}:${kind}`
  const stamps = (rlCache.get(key) ?? []).filter((t) => now - t < win)
  if (stamps.length >= limit) return false
  stamps.push(now)
  rlCache.set(key, stamps)
  if (rlCache.size > RL_SOFT_SIZE && (now - rlLastPrune >= RL_PRUNE_INTERVAL || rlCache.size > RL_HARD_CAP)) {
    rlPrune(now)
  }
  return true
}
// IP 판정은 @/lib/client-ip 단일 소스 — 사본이 갈리면 IP별 잠금이 통째로 무의미 (2026-08-13 라인리뷰,
// 그 파일 헤더가 '반드시 이 헬퍼 하나만'이라 경고하는 바로 그 로직의 사본이 여기 있었다)
const clientIpOf = (req: NextRequest): string => getClientIp(req.headers)

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET 환경변수가 설정되지 않았거나 너무 짧습니다 (최소 16자)')
  }
  return secret
}

// 2026-07-04: base64url payload를 atob로 디코드할 때 패딩을 붙여야 함.
// 안 붙이면 payload 길이가 4의 배수가 아닐 때(=exp에 따라 매초 가변) atob가 실패 →
// 세션 간헐 거부(로그인해도 계속 튕김). Node Buffer(lib/auth)는 자동 처리하지만 atob(edge)는 아님.
function decodeB64url(payload: string): string {
  const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  return atob(b64 + pad)
}

// HMAC 검증은 src/lib/hmac-edge.ts(constant-time subtle.verify)에 위임.
// 토큰 형식(payload=base64url(body), sig=HMAC(body))은 lib/auth.ts 발급분과 동일 → 세션 무효화 없음.
async function verifyToken(token: string): Promise<boolean> {
  const dotIdx = token.indexOf('.')
  if (dotIdx < 0) return false
  try {
    const payload = token.slice(0, dotIdx)
    const signature = token.slice(dotIdx + 1)
    const body = decodeB64url(payload)
    const pipeIdx = body.lastIndexOf('|')
    if (pipeIdx < 0) return false
    const adminId = body.slice(0, pipeIdx)
    const exp = Number(body.slice(pipeIdx + 1))
    if (!adminId || !adminId.trim()) return false
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false
    return await verify(getSecret(), body, signature)
  } catch {
    return false
  }
}

/** Finance(원장 전용) HMAC 토큰 검증 — payload = "finance|<exp>" */
async function verifyFinanceToken(token: string): Promise<boolean> {
  const dotIdx = token.indexOf('.')
  if (dotIdx < 0) return false
  try {
    const payload = token.slice(0, dotIdx)
    const signature = token.slice(dotIdx + 1)
    const body = decodeB64url(payload)
    if (!body.startsWith('finance|')) return false
    const exp = Number(body.slice('finance|'.length))
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false
    return await verify(getSecret(), body, signature)
  } catch {
    return false
  }
}

// Cookie 헤더에서 같은 이름 값을 전부 추출. request.cookies.get()은 중복 시 하나만 반환하는데,
// 그게 남의(서명 불일치) 토큰이면 인증이 깨진다(2026-07-14 워라 dm_session 사고 계열).
// 원비는 미들웨어(마지막)와 라우트 가드(첫번째)가 서로 다른 쿠키를 집어 '페이지는 열리는데 API 401'이
// 재현됐다(2026-07-21). 후보 전부 검증해 하나라도 유효하면 통과하는 관용 파싱으로 방어. (Edge 호환 인라인)
function cookieCandidates(cookieHeader: string, name: string): string[] {
  const out: string[] = []
  const re = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(cookieHeader)) !== null) {
    try { out.push(decodeURIComponent(m[1])) } catch { out.push(m[1]) }
  }
  return out
}
async function anyValid(candidates: string[], verifier: (t: string) => Promise<boolean>): Promise<boolean> {
  for (const t of candidates) { if (await verifier(t)) return true }
  return false
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Rate limit before any other check (P0 #4)
  // GET/HEAD는 카운트 제외 — 정상 사용자 새로고침/리다이렉트로 막히는 문제 방지
  // POST 등 mutating 요청만 카운트 (brute force / abuse 차단 목적)
  const isMutating = request.method !== 'GET' && request.method !== 'HEAD'
  if (isMutating && pathname.startsWith('/api/')) {
    const isAuth = pathname.startsWith('/api/auth/')
    if (!rateLimitOk(clientIpOf(request), isAuth ? 'auth' : 'api')) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '60', 'Content-Type': 'text/plain' },
      })
    }
  }

  // 출결코드 조회 GET: 이름 열람에 레이트리밋을 두지 않는다 — 사용자가 2026-06-20
  // "출석 이름조회는 비민감"으로 명시적 원복한 결정을 존중(commit 0c14361). 보안스윕이
  // 지적한 진짜 민감 요소(내부 student UUID 노출→IDOR pivot)는 GET 응답에서 UUID 자체를
  // 제거해 닫았으므로(check-in/route.ts), 이름 열거만 남고 그건 사용자 판단상 비민감.

  // 로그인 페이지, API 로그인, 정적 파일은 통과
  // /kiosk: 학원 내부 태블릿용 — 공용 접근 (인증 우회). 학생 출결번호 4자리로 식별
  if (
    pathname === '/login' ||
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/logout' ||
    pathname === '/kiosk' ||
    pathname === '/api/attendance/check-in' ||
    pathname === '/api/kiosk-version' ||
    pathname.startsWith('/api/payssam/callback') ||
    pathname.startsWith('/api/cron/') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/icons') ||
    pathname === '/manifest.json' ||
    pathname === '/manifest-kiosk.json' ||
    pathname === '/sw.js' ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const cookieHeader = request.headers.get('cookie') || ''
  const authCandidates = cookieCandidates(cookieHeader, 'auth_token')
  if (!(await anyValid(authCandidates, verifyToken))) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  // Finance(원장 전용) 추가 게이팅 — admin 세션 통과 후에도 PIN HMAC 쿠키 필요
  // /finance/auth (PIN 입력 페이지) 와 /api/auth/finance (PIN 검증 API)는 통과 허용
  const isFinanceAuthPage = pathname === '/finance/auth'
  const isFinanceAuthApi = pathname === '/api/auth/finance'
  // 데이터 API도 PIN 게이트에 포함 — 페이지만 막으면 admin 세션으로 /api/expenses·teacher-bonuses를
  // 직접 호출해 지출/급여 데이터를 읽고 쓸 수 있어 2차 인증이 무력했음 (2026-07-10 전수점검 M1).
  // /teachers/[id](급여명세서)도 같은 데이터 클래스라 함께 게이트.
  // /api/teachers는 설정(반·선생 CRUD)·대시보드가 admin 세션으로 쓰는 공용이라 제외 (기존 설계 유지).
  const needsFinancePin =
    !isFinanceAuthPage &&
    !isFinanceAuthApi &&
    (pathname === '/finance' || pathname.startsWith('/finance/') || pathname.startsWith('/api/finance/') ||
      pathname.startsWith('/api/expenses') || pathname.startsWith('/api/teacher-bonuses') ||
      pathname.startsWith('/teachers/'))
  if (needsFinancePin) {
    const finCandidates = cookieCandidates(cookieHeader, 'finance_session')
    if (!(await anyValid(finCandidates, verifyFinanceToken))) {
      // API 호출은 401, 페이지는 /finance/auth 리다이렉트
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Finance PIN required' }, { status: 401 })
      }
      return NextResponse.redirect(new URL('/finance/auth', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
