#!/usr/bin/env node
/**
 * e2e: /finance PIN HMAC 인증 흐름 (audit Phase 1)
 * - 비PIN /finance → /finance/auth 리다이렉트
 * - 위조 쿠키 (HMAC 미서명) 차단
 * - 잘못된 PIN → 401
 * - 올바른 PIN → finance_session 발급 + /finance 진입
 */
const BASE = 'http://localhost:3001'
const TOKEN = process.env.TOKEN
const PIN = process.env.FINANCE_PIN // 하드코딩 폴백 금지 — scrub은 회전이 아니다 (2026-08-13 라인리뷰)
if (!TOKEN || !PIN) {
  console.error('TOKEN, FINANCE_PIN env 필요 (.env.local 참조)')
  process.exit(1)
}

let pass = 0, fail = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`✓ ${name}`)
    pass++
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`)
    fail++
  }
}

const adminCookie = `auth_token=${TOKEN}`

// 1) 비PIN 상태 /finance → 307 리다이렉트
await check('비PIN /finance → 307', async () => {
  const r = await fetch(`${BASE}/finance`, {
    headers: { cookie: adminCookie },
    redirect: 'manual',
  })
  if (r.status !== 307) throw new Error(`status ${r.status}`)
})

// 2) 위조 쿠키 (raw 값) → 307 리다이렉트
await check('위조 finance_session → 307', async () => {
  const r = await fetch(`${BASE}/finance`, {
    headers: { cookie: `${adminCookie}; finance_session=fake.signature` },
    redirect: 'manual',
  })
  if (r.status !== 307) throw new Error(`status ${r.status}`)
})

// 3) 잘못된 PIN → 401
await check('잘못된 PIN → 401', async () => {
  const r = await fetch(`${BASE}/api/auth/finance`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '000000' }),
  })
  if (r.status !== 401) throw new Error(`status ${r.status}`)
})

// 4) 올바른 PIN → 200 OK + Set-Cookie finance_session
let financeCookie = ''
await check('올바른 PIN → 쿠키 발급', async () => {
  const r = await fetch(`${BASE}/api/auth/finance`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: PIN }),
  })
  if (r.status !== 200) throw new Error(`status ${r.status}`)
  const setCookie = r.headers.get('set-cookie') ?? ''
  const m = setCookie.match(/finance_session=([^;]+)/)
  if (!m) throw new Error('finance_session 쿠키 미발급')
  financeCookie = m[1]
})

// 5) 발급된 쿠키로 /finance 진입 200
await check('발급 쿠키로 /finance → 200', async () => {
  const r = await fetch(`${BASE}/finance`, {
    headers: { cookie: `${adminCookie}; finance_session=${financeCookie}` },
    redirect: 'manual',
  })
  if (r.status !== 200) throw new Error(`status ${r.status}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
