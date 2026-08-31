#!/usr/bin/env node
/**
 * e2e: 로그인 흐름
 * - 비인증 /dashboard → /login 리다이렉트
 * - 인증 쿠키로 /dashboard 진입 200 OK
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:3001'
const TOKEN = process.env.TOKEN
if (!TOKEN) {
  console.error('TOKEN env 필요 (curl 로그인 후 auth_token 쿠키)')
  process.exit(1)
}

const browser = await chromium.launch({ args: ['--no-sandbox'] })
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

// 1) 비인증 /dashboard → /login 리다이렉트
await check('비인증 → /login 리다이렉트', async () => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const res = await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 10000 })
  if (!page.url().endsWith('/login')) throw new Error(`expected /login, got ${page.url()}`)
  if (res.status() !== 200) throw new Error(`status ${res.status()}`)
  await ctx.close()
})

// 2) 인증 쿠키로 /dashboard 진입
await check('인증 → /dashboard 200', async () => {
  const ctx = await browser.newContext()
  await ctx.addCookies([{ name: 'auth_token', value: TOKEN, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])
  const page = await ctx.newPage()
  const res = await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 20000 })
  if (res.status() !== 200) throw new Error(`status ${res.status()}`)
  if (!page.url().endsWith('/dashboard')) throw new Error(`url ${page.url()}`)
  // 대시보드 헤더 텍스트 검증
  const has = await page.locator('text=원비관리').count()
  if (has === 0) throw new Error('대시보드 헤더 누락')
  await ctx.close()
})

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
