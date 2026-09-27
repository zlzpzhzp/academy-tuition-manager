/** 운영으로 연결하지 않는 D3 전후 검수. 합성 데이터·격리 127.0.0.1:33xx 서버에서만 실행 */
import { chromium } from 'playwright'
import { createHmac } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import fixtures from './paper-fixtures.cjs'

const BASE = process.env.PAPER_BASE
assert(BASE && /^http:\/\/127\.0\.0\.1:(33\d\d)$/.test(BASE), '격리된 127.0.0.1:33xx 대역 서버만 허용')
const phase = process.env.PAPER_PHASE || 'after'
const out = process.env.PAPER_OUTPUT || `/tmp/tuition-paper-evidence/${phase}`
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const report = { phase, screens: [], failures: [], requests: [], unknownRoutes: [], external: [], timings: [] }
const routes = ['/dashboard','/payments','/special','/billing','/settings','/students','/attendance','/notice','/stats','/login','/finance','/finance/auth','/agent','/students/paper-1','/teachers/paper-teacher']
function token(who) {
  const body = `${who}|${Math.floor(Date.now()/1000) + 3600}`
  return `${Buffer.from(body).toString('base64url')}.${createHmac('sha256','paper-redesign-synthetic-session-only').update(body).digest('base64url')}`
}
async function context({ width = 430, reduced = false, empty = false, errors = false, standalone = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 932 }, deviceScaleFactor: 2, isMobile: width < 640, hasTouch: true, reducedMotion: reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block', timezoneId: 'Asia/Seoul', locale: 'ko-KR' })
  await ctx.addCookies([{name:'auth_token',value:token('synthetic-admin'),url:BASE},{name:'finance_session',value:token('finance'),url:BASE}])
  await ctx.addInitScript(({ standalone }) => {
    const RealDate = Date
    window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-09-13T04:00:00.000Z'])) } static now() { return new RealDate('2026-09-13T04:00:00.000Z').getTime() } }
    if (standalone) { const match = window.matchMedia.bind(window); window.matchMedia = q => q === '(display-mode: standalone)' ? Object.assign(match(q), { matches: true }) : match(q) }
  }, { standalone })
  await ctx.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== BASE) { report.external.push(url.origin); return route.abort() }
    if (url.pathname.startsWith('/api/')) {
      if (req.method() !== 'GET') {
        report.requests.push({ path: url.pathname, method: req.method(), body: req.postDataJSON() })
        return route.fulfill({ json: { success: true, id: 'synthetic-result', result: { code: '0000' } } })
      }
      try { return route.fulfill({ status: errors && url.pathname === '/api/grades' ? 500 : 200, json: fixtures.fixture(req.url(), empty) }) }
      catch(e) { report.unknownRoutes.push(e.message); return route.fulfill({ status: 501, json: { error: 'fixture missing' } }) }
    }
    return route.continue()
  })
  return ctx
}
async function check(name, fn) { try { await fn(); console.log(`PASS ${name}`) } catch(e) { report.failures.push({ name, error: e.message }); console.error(`FAIL ${name}: ${e.message}`) } }
async function settle(page) { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(850) }
function fileName(route) { return route.slice(1).replaceAll('/','-') || 'root' }
async function capture(page, route, label) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' }); await settle(page)
  const data = await page.evaluate(() => ({ title: document.title, text: document.querySelector('main')?.innerText, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, bg: getComputedStyle(document.body).backgroundColor, rootTransform: getComputedStyle(document.querySelector('main')?.firstElementChild || document.body).transform, grain: getComputedStyle(document.body,'::before').content }))
  report.screens.push({ route, label, ...data })
  await page.screenshot({ path: `${out}/${label}-${fileName(route)}.png`, fullPage: true, animations: 'disabled' })
  if (phase === 'after' && route !== '/kiosk') { assert.equal(data.bg,'rgb(244, 241, 234)'); assert.equal(data.rootTransform, 'none') }
  assert(data.scrollWidth <= data.width + 1, `${route}: 가로 넘침 ${data.scrollWidth}/${data.width}`)
}
try {
  const ctx = await context(), page = await ctx.newPage()
  page.on('pageerror', e => report.failures.push({ name: 'browser error', error: e.message }))
  for (const route of routes) await check(`430 ${route}`, () => capture(page,route,'430'))
  await check('루트 리다이렉트', async () => { await page.goto(BASE); assert.equal(new URL(page.url()).pathname,'/dashboard') })
  await check('키오스크', async () => { await capture(page,'/kiosk','430'); const v=await page.evaluate(()=>({bg:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),grain:getComputedStyle(document.body,'::before').content,theme:document.querySelector('meta[name="theme-color"]')?.content}));assert.equal(v.bg,'#17171c');assert.equal(v.grain,'none');assert.equal(v.theme,'#070b14') })
  await check('없는 경로', () => capture(page,'/paper-not-found','430'))
  await ctx.close()
  for (const [label, options] of [['small',{width:360}],['tablet',{width:820}],['reduced',{reduced:true}],['standalone',{standalone:true}]]) {
    const ctx = await context(options), page = await ctx.newPage()
    for (const route of ['/dashboard','/payments','/stats','/login']) await check(`${label} ${route}`, () => capture(page,route,label))
    await ctx.close()
  }
  for (const [label, options] of [['empty',{empty:true}],['error',{errors:true}]]) {
    const ctx = await context(options), page = await ctx.newPage()
    for (const route of ['/dashboard','/payments']) await check(`${label} ${route}`, () => capture(page,route,label))
    await ctx.close()
  }
} finally {
  report.unknownRoutes = [...new Set(report.unknownRoutes)]
  await writeFile(`${out}/report.json`, JSON.stringify(report,null,2))
  await browser.close()
}
console.log(`${report.screens.length} screens, ${report.failures.length} failures, ${report.unknownRoutes.length} unknown routes`)
if (report.failures.length || report.unknownRoutes.length || report.external.length) process.exitCode = 1
