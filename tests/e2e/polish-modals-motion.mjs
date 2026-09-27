/** 시스템 Chrome --headless=new + CDP 전용. 재실행법·미자동화 상태는 인계서 참조. */
import { chromium } from 'playwright'
import { createHmac } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import fixtures from './paper-fixtures.cjs'
import catalog from './polish-cases.cjs'
import metrics from './polish-metrics.cjs'

const endpoint = process.env.POLISH_CDP || 'http://127.0.0.1:9337'
assert(/^http:\/\/127\.0\.0\.1:93\d\d$/.test(endpoint), '전용 loopback CDP만 허용')
const bases = { before: process.env.POLISH_BASE || 'http://127.0.0.1:3381', after: process.env.POLISH_CANDIDATE || 'http://127.0.0.1:3382' }
for (const base of Object.values(bases)) assert(/^http:\/\/127\.0\.0\.1:33\d\d$/.test(base), '격리 33xx만 허용')
assert.notEqual(bases.before, bases.after)
const mode = process.env.POLISH_MODE || 'geometry'
assert(['geometry','performance'].includes(mode))
const out = process.env.POLISH_OUTPUT || `/tmp/tuition-polish-evidence/${mode}`
await mkdir(out, { recursive: true })
const report = { mode, browser: null, bases, startedAt: new Date().toISOString(), matrix: catalog.pendingMatrix(), surfaces: [], frames: [], scroll: [], touches: [], loading: [], header: [], requests: [], failures: [], pending: [], external: [] }
let browser
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="520"><rect width="400" height="520" fill="#eee8dd"/><text x="40" y="80" font-size="24">Synthetic receipt</text></svg>'
const pagePaths = ['/dashboard','/payments','/special','/billing','/settings','/students','/attendance','/notice','/stats','/login','/finance','/finance/auth','/agent','/students/paper-1','/teachers/paper-teacher','/kiosk','/']
const clone = value => structuredClone(value)
function fixture(url) {
  const p = new URL(url).pathname
  if (p === '/api/special/pay/polish-special-payment/receipt' || p === '/api/payments/payment-0/receipt') return { signed: [{ stored: 'polish-receipt', url: '/__polish/receipt.svg' }] }
  if (p === '/api/audit-logs') return Array.from({ length: 45 }, (_, i) => ({ id: `polish-log-${i}`, action: 'update', summary: `합성 검수 변경 ${i}`, created_at: '2026-09-01T00:00:00Z' }))
  const data = clone(fixtures.fixture(url))
  if (p === '/api/grades') {
    const cls = data[0].classes[0]
    cls.students = Array.from({ length: 72 }, (_, i) => ({ ...clone(fixtures.students[i % 12]), id: `paper-${i + 1}`, name: `합성학생${String(i + 1).padStart(2,'0')}`, memo: i === 3 ? '9월 합성 긴 메모 '.repeat(40) : '', withdrawal_date: i === 71 ? '2026-09-10' : null }))
  }
  if (p === '/api/special') data.payments = [{ id: 'polish-special-payment', student_id: 'paper-1', amount: 100000, method: 'card', paid_at: '2026-09-01T00:00:00Z', receipt_images: ['polish-receipt'] }]
  if (p === '/api/payments') for (const payment of data) if (payment.id === 'payment-0') payment.receipt_images = ['polish-receipt']
  return data
}
function token(who) {
  const body = `${who}|${Math.floor(Date.now()/1000) + 3600}`
  return `${Buffer.from(body).toString('base64url')}.${createHmac('sha256','polish-synthetic-session-only').update(body).digest('base64url')}`
}
async function context(base, viewport, reduced, faults = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: viewport.width < 640, hasTouch: true, reducedMotion: reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block', timezoneId: 'Asia/Seoul', locale: 'ko-KR' })
  await ctx.addCookies([{ name:'auth_token', value:token('synthetic-admin'), url:base },{ name:'finance_session', value:token('finance'), url:base }])
  await ctx.addInitScript(() => {
    const RealDate = Date
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : ['2026-09-14T04:00:00Z'])) }
      static now() { return new RealDate('2026-09-14T04:00:00Z').getTime() }
    }
  })
  // 탐색 이전에 전 요청 가로채기. 미정의 API는 메서드와 무관하게 abort+실패.
  await ctx.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname
    if (url.origin !== base) { report.external.push(url.origin); report.failures.push(`외부 요청 차단: ${url.origin}`); return route.abort() }
    if (p.startsWith('/api/')) {
      const method = request.method(), entry = { path:p, method, at:Date.now(), result:null }
      report.requests.push(entry)
      try {
        if (method !== 'GET') {
          const body = request.postDataJSON()
          // 퇴원 메뉴를 여는 순간 호출되는 미리보기만 명시적으로 허용한다.
          if (p === '/api/payssam/resettle' && method === 'POST' && body.dryRun === true && /^paper-\d+$/.test(body.studentId)) {
            entry.result = 'synthetic-dryRun'; return route.fulfill({ json:{ mode:'refund' } })
          }
          // 성공/실패 전환은 별도 시험이 예약한 단 한 요청에만 응답한다.
          const expected = faults.write
          assert(expected && !expected.used && expected.path === p && expected.method === method && expected.match(body), `미정의 쓰기 ${method} ${p}`)
          expected.used = true; entry.result = 'synthetic-transition'
          await new Promise(resolve => setTimeout(resolve, expected.delay ?? 600))
          return route.fulfill({ status:expected.status ?? 200, json:expected.json })
        }
        const data = fixture(url.href)
        if (faults.delay) await new Promise(resolve => setTimeout(resolve, faults.delay))
        entry.result = faults.error === p ? 500 : 200
        return route.fulfill({ status:entry.result, json:entry.result === 500 ? { error:'합성 검수 오류' } : data })
      } catch (error) { entry.result = 'blocked'; report.failures.push(error.message); return route.abort() }
    }
    if (p === '/__polish/receipt.svg') return route.fulfill({ contentType:'image/svg+xml', body:svg })
    if (p === '/sw.js') return route.abort()
    if (request.method() === 'GET' && (pagePaths.includes(p) || /^\/(students|teachers)\/[\w-]+$/.test(p) || p.startsWith('/_next/static/') || /^\/(icons|fonts)\//.test(p) || ['/favicon.ico','/manifest.json'].includes(p))) return route.continue()
    if (p === '/_next/image' && /^\/(?!\/)/.test(url.searchParams.get('url') || '')) return route.fulfill({ contentType:'image/svg+xml', body:svg })
    report.failures.push(`미정의 비API 요청 차단: ${request.method()} ${p}`); return route.abort()
  })
  const page = await ctx.newPage()
  page.on('pageerror', error => report.failures.push(`브라우저: ${error.message}`))
  page.on('dialog', dialog => dialog.dismiss())
  return { ctx, page, faults }
}
async function settle(page) { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(650) }
const button = (page, name) => page.getByRole('button', { name, exact: true }).first()
const row = (page, id = 'paper-5') => page.locator(`[data-student-row="${id}"]`).first()
async function expandRow(page) { await row(page).locator('[data-swipe-row] > div').first().click({ position:{x:4,y:4} }); await page.waitForTimeout(350) }
async function openCase(page, id) {
  if (id === 'student-edit') return page.getByRole('button', { name:/학생 추가/ }).first().click()
  if (id === 'student-detail') return row(page,'paper-1').getByRole('button').filter({ hasText:'합성학생01' }).first().click()
  if (id === 'payment') return button(page,'납부 기록').click()
  if (id === 'bill-send') return row(page).getByRole('button', { name:/카톡 청구서 발송/ }).first().click()
  if (id === 'bill-action') return row(page,'paper-4').getByRole('button', { name:/발송됨.*탭하여 파기/ }).click()
  if (id === 'bulk-send') {
    await page.getByRole('button', { name:'결제일 선택', exact:true }).first().click()
    await page.getByRole('button', { name:/청구지연 \d+명/ }).click(); await button(page,'적용').click()
    return page.locator('button[title*="조건의 미발송"]').click()
  }
  if (id === 'bulk-resend') return page.locator('button[title*="카톡 알림 재발송"]').click()
  if (id === 'quick' || id.startsWith('quick-')) {
    await page.getByRole('button', { name:/^청구서 발송(하기)?$/ }).first().click()
    if (id === 'quick') return
    await button(page,'과목').click()
    if (id === 'quick-subject') return
    await button(page,'수학').click(); await button(page,'학년').click()
    if (id === 'quick-grade') return
    await button(page,'중1').click(); return button(page,'반').click()
  }
  if (id === 'payment-days') return page.getByRole('button', { name:'결제일 선택', exact:true }).first().click()
  if (id === 'day-of-month') { await openCase(page,'student-detail'); return button(page,'정규 결제일 선택').click() }
  if (id === 'date' || id === 'method-pills') { await expandRow(page); return row(page).getByRole('button', { name:id === 'date' ? '결제일 선택' : '결제수단 선택', exact:true }).click() }
  if (id === 'withdrawal') return row(page,'paper-72').getByRole('button').filter({ hasText:'합성학생72' }).first().click()
  if (id === 'settings-transfer') {
    const control = page.getByRole('button', { name:'학생 반이동', exact:true }).first()
    if (!await control.isVisible()) await page.getByRole('button').filter({ hasText:'중1' }).first().click()
    return control.click()
  }
  if (id === 'settings-logs') return button(page,'변경 로그').click()
  if (id === 'student360-withdraw') return button(page,'퇴원 처리').click()
  if (id === 'special-receipt' || id === 'special-zoom') {
    await page.locator('button[title*="장 보기"]').first().click()
    if (id === 'special-zoom') return page.getByRole('img', { name:'영수증', exact:true }).first().click()
    return
  }
  if (id === 'install') return page.evaluate(() => { const event = new Event('beforeinstallprompt'); event.prompt = async () => {}; event.userChoice = Promise.resolve({ outcome:'dismissed' }); dispatchEvent(event) })
  if (id === 'notice-covers') {
    const covers = button(page,'교재 표지')
    if (!await covers.isVisible()) await page.getByRole('button').filter({ hasText:/이미지/ }).first().click()
    return covers.click()
  }
  // 아래 상태는 인계서의 수동 CDP 절차로만 채운다. 미실행을 PASS로 승격하지 않는다.
  throw new Error(`수동 상태 경로 필요: ${id}`)
}
async function markSurface(page, id) {
  return page.evaluate(id => {
    document.querySelectorAll('[data-polish-surface]').forEach(el => el.removeAttribute('data-polish-surface'))
    let surface
    if (id.startsWith('quick-')) surface = document.querySelector('[data-picker-portal] [data-paper-card]')
    else if (id === 'method-pills') surface = document.querySelector('[role="option"]')
    else if (id === 'special-zoom') surface = document.querySelector('img[alt="영수증 확대"]')
    else if (id === 'install') surface = document.querySelector('[aria-label="앱 설치 안내"] > div')
    else if (id === 'date') surface = document.querySelector('[aria-label="날짜 선택"]')
    else if (id === 'day-of-month') surface = [...document.querySelectorAll('[data-paper-card]')].filter(el => getComputedStyle(el.parentElement).position === 'fixed').at(-1)
    else {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1)
      if (dialog) {
        // 중앙형 래퍼에는 배경이 없다. 표시면인 직접 자식 카드를 골라 측정한다.
        surface = dialog.matches('[data-paper-card]') || getComputedStyle(dialog).backgroundColor !== 'rgba(0, 0, 0, 0)' ? dialog : dialog.querySelector('[data-paper-card]') || dialog
      } else surface = [...document.querySelectorAll('[data-paper-card]')].filter(el => getComputedStyle(el.parentElement).position === 'fixed').at(-1)
    }
    if (!surface) return false
    surface.setAttribute('data-polish-surface', '')
    return true
  }, id)
}
async function readSurface(page) {
  return page.locator('[data-polish-surface]').evaluate(el => {
    const c = getComputedStyle(el), rect = el.getBoundingClientRect()
    const radius = [c.borderTopLeftRadius,c.borderTopRightRadius,c.borderBottomRightRadius,c.borderBottomLeftRadius]
    const leaks = []
    // 각 곡률 밖 16개 표본. 한 픽셀 색상 대신 실제 자식의 곡률 밖 돌출을 검사한다.
    radius.forEach((value, corner) => {
      const r = Math.min(parseFloat(value),rect.width/2,rect.height/2)
      for (const fx of [.08,.2,.35,.5]) for (const fy of [.08,.2,.35,.5]) {
        // 곡률 경계 1.5px 안쪽 표본은 히트테스트 반올림으로 오탐이 난다(합성 대조군 r=24 에서 1점) → 1.15(≈1.07r) 밖만 표본. 직각(1.41r)은 여전히 잡힌다.
        if ((1-fx)**2 + (1-fy)**2 <= 1.15 || r < 2) continue
        const x = corner === 0 || corner === 3 ? rect.left + r*fx : rect.right-r*fx
        const y = corner < 2 ? rect.top + r*fy : rect.bottom-r*fy
        const hit = document.elementFromPoint(x,y)
        if (hit && el.contains(hit)) leaks.push({ corner,x,y,hit:hit.tagName })
      }
    })
    const clips = [], scrolls = []
    for (let node=el; node && node!==document.body; node=node.parentElement) {
      const style=getComputedStyle(node)
      if (style.overflowX!=='visible' || style.overflowY!=='visible') clips.push({ tag:node.tagName, overflowX:style.overflowX, overflowY:style.overflowY, radius:style.borderRadius })
    }
    for (const node of [el,...el.querySelectorAll('*')]) if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) scrolls.push({ tag:node.tagName, scrollTop:node.scrollTop, scrollHeight:node.scrollHeight, clientHeight:node.clientHeight })
    return { radius, rect:rect.toJSON(), dpr:devicePixelRatio, viewport:{width:innerWidth,height:innerHeight}, clips, scrolls, leaks }
  })
}
async function corners(page, label, rule) {
  const data = await readSurface(page), files = []
  for (let i=0; i<4; i++) {
    const {rect} = data, size = Math.min(48,rect.width/2,rect.height/2)
    const x = i===0 || i===3 ? rect.left : rect.right-size, y = i<2 ? rect.top : rect.bottom-size
    if (x<0 || y<0 || x+size>data.viewport.width || y+size>data.viewport.height) { files.push(null); continue }
    const path = `${out}/${label}-corner-${i}.png`; await page.screenshot({ path, clip:{x,y,width:size,height:size} }); files.push(path)
  }
  const failures=metrics.cornerFailures(data,rule)
  if (!['transparent','fullscreen'].includes(rule) && files.some(file=>file===null)) failures.push('표시 면 모서리가 뷰포트 밖에 있음')
  return { ...data, corners:files, failures }
}
function recordSurface(value) {
  report.surfaces.push(value)
  if (value.phase==='after' && value.failures.length) report.failures.push({label:value.label,failures:value.failures})
  // A 기준 표는 일반 모션의 정착 표시면을 기록. reduced 결과는 surfaces 원자료에 따로 보존.
  if (value.reduced) return
  const meta=catalog.surfaces.find(([id])=>id===value.id)
  const state=value.state==='open' ? (meta[5][0]==='loading' ? 'content' : meta[5][0]) : value.state
  const row=report.matrix.find(row=>row.id===value.id && row.state===state && row.viewport.width===value.viewport.width)
  if (row) row[value.phase]={status:value.failures.length?'실패':'통과(geometry)',radius:value.radius,corners:value.corners,rect:value.rect,dpr:value.dpr,clips:value.clips,rawLabel:value.label}
}
async function instrument(page, geometry = false) {
  await page.evaluate(geometry => {
    const run = { times:[], samples:[], inputs:[], mutations:[], done:false }
    window.__polishRun = run
    const input = event => run.inputs.push({type:event.type,time:performance.now()})
    document.addEventListener('pointerdown',input,true)
    document.addEventListener('click',input,true)
    document.addEventListener('wheel',input,{capture:true,passive:true})
    const observer = new MutationObserver(() => run.mutations.push(performance.now()))
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true})
    function tick(time) {
      if (run.done) { observer.disconnect(); document.removeEventListener('pointerdown',input,true); document.removeEventListener('click',input,true); document.removeEventListener('wheel',input,true); return }
      run.times.push(time)
      if (geometry) run.samples.push({time, scrollY, panels:[...document.querySelectorAll('[role="dialog"], [data-picker-portal] [data-paper-card]')].map(el => ({rect:el.getBoundingClientRect().toJSON(),opacity:getComputedStyle(el).opacity,transform:getComputedStyle(el).transform})), active:document.activeElement?.tagName, overflow:document.body.style.overflow})
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, geometry)
}
async function stopInstrumentation(page) { return page.evaluate(() => { window.__polishRun.done=true; return window.__polishRun }) }
async function scrollCheck(page, label) {
  await page.evaluate(() => scrollTo(0,0))
  const max = await page.evaluate(() => document.documentElement.scrollHeight-innerHeight)
  assert(max>=600, `스크롤 범위 부족 ${max}: 유효 시퀀스 검사 불가`)
  let requested=0
  for (const delta of [120,60,-30,-30,200,-40]) {
    requested+=delta
    const actual = await page.evaluate(y => { window.scrollTo({top:y,behavior:'instant'}); return scrollY }, requested)
    await page.waitForTimeout(180)
    const settled = await page.evaluate(() => scrollY)
    report.scroll.push({label,delta,requested,actual,settled,max})
    assert(Math.abs(actual-requested)<1 && Math.abs(settled-requested)<1, `${label} 스크롤 튕김 ${requested}/${actual}/${settled}`)
  }
}
async function headerCheck(page, label) {
  for (const y of [0,30,60,90,120]) {
    await page.evaluate(y => scrollTo({top:y,behavior:'instant'}),y); await page.waitForTimeout(80)
    const data = await page.evaluate(() => {
      const header=document.querySelector('[data-payments-header]'), title=document.querySelector('[data-payments-title]')
      const background=document.querySelector('[data-payments-nav-background]'), status=document.querySelector('[data-payments-sticky-status]')
      return { y:scrollY, mode:header?.getAttribute('data-payments-motion'), reserved:header?.offsetHeight, scale:new DOMMatrix(getComputedStyle(title).transform).a, bgHeight:background?.getBoundingClientRect().height, statusY:new DOMMatrix(getComputedStyle(status).transform).f }
    })
    const u=y/120, p=data.mode==='reduced' ? 1 : u*u*(3-2*u)
    report.header.push({label,...data,expected:{scale:1-.38*p,bgHeight:84-32*p,statusY:-32*p}})
    assert(Math.abs(data.scale-(1-.38*p))<.015 && Math.abs(data.bgHeight-(84-32*p))<1 && Math.abs(data.statusY+32*p)<1, `${label} 헤더 값표 ${y}`)
    assert.equal(data.reserved,84)
  }
}
async function defectControls(page) {
  await page.evaluate(() => {
    const el=document.createElement('div'); el.dataset.polishSurface=''; el.style.cssText='position:fixed;left:80px;top:180px;width:160px;height:160px;border-radius:24px;background:#ddd;z-index:9999'
    document.body.append(el)
  })
  const valid = metrics.cornerFailures(await readSurface(page),'center'); assert.equal(valid.length,0)
  await page.locator('[data-polish-surface]').evaluate(el => el.style.borderTopLeftRadius='0px')
  assert(metrics.cornerFailures(await readSurface(page),'center').length>0,'radius 결함 주입 검출 실패')
  await page.locator('[data-polish-surface]').evaluate(el => {
    el.style.borderTopLeftRadius='24px'
    const child=document.createElement('div');child.style.cssText='position:absolute;inset:0;background:#333';el.append(child)
  })
  assert(metrics.cornerFailures(await readSurface(page),'center').length>0,'자식 배경 돌출 결함 검출 실패')
  await page.locator('[data-polish-surface]').evaluate(el => { el.style.overflow='hidden' })
  assert.equal(metrics.cornerFailures(await readSurface(page),'center').length,0)
  await page.locator('[data-polish-surface]').evaluate(el => el.remove())
}
async function geometryRun(base, phase, viewport, reduced) {
  for (const [id,path,source,entry,rule] of catalog.surfaces) {
    if (['notice-confirm','payment-image','toast','floating-toolbar'].includes(id)) { report.pending.push({phase,id,reason:'추가 수동 상태 경로 필요: 인계서 참조'}); continue }
    const {ctx,page} = await context(base,viewport,reduced)
    const label=`${phase}-${viewport.width}-${reduced?'reduced':'normal'}-${id}`
    try {
      await page.goto(base+path); await settle(page)
      await instrument(page,true); await openCase(page,id); await page.waitForTimeout(650)
      assert(await markSurface(page,id),`${id} 표시 면 없음`)
      const data = await corners(page,label,rule)
      recordSurface({label,id,source,entry,phase,reduced,state:'open',...data})
      recordSurface({label,id,source,entry,phase,reduced,state:'scroll-top',...data})
      if (rule==='sheet' && viewport.width<640) {
        await page.getByRole('button',{name:'풀스크린으로 펼치기',exact:true}).last().click(); await page.waitForTimeout(400)
        recordSurface({label,id,phase,reduced,state:'expanded',...await corners(page,`${label}-expanded`,rule)})
        await page.getByRole('button',{name:'시트 축소',exact:true}).last().click(); await page.waitForTimeout(400)
      }
      await page.locator('[data-polish-surface]').evaluate(el => { for (const n of [el,...el.querySelectorAll('*')]) if (/(auto|scroll)/.test(getComputedStyle(n).overflowY)) n.scrollTop=n.scrollHeight })
      await page.waitForTimeout(100)
      recordSurface({label,id,phase,reduced,state:'scroll-bottom',...await corners(page,`${label}-bottom`,rule)})
      await page.emulateMedia({reducedMotion:'reduce'})
      await page.keyboard.press('Escape'); await page.waitForTimeout(500)
      report.frames.push({label,kind:'geometry-only',...await stopInstrumentation(page)})
    } catch(error) { report.failures.push({label,error:error.message}) }
    finally { await ctx.close() }
  }
}
async function performanceRun(base, phase, repetition) {
  for (const viewport of catalog.viewports) for (const reduced of [false,true]) {
    for (const path of ['/payments','/dashboard','/billing','/special','/attendance','/students/paper-1','/stats']) {
      const {ctx,page} = await context(base,viewport,reduced,{delay:500})
      const label=`${phase}-${repetition}-${viewport.width}-${reduced}-${path}`
      try {
        const requestStart=report.requests.length
        await page.goto(base+path,{waitUntil:'domcontentloaded'})
        await instrument(page,false); await page.waitForTimeout(750)
        const loading=await stopInstrumentation(page)
        report.loading.push({label,phase,path,viewport,reduced,repetition,requestCount:report.requests.length-requestStart,raw:loading,...metrics.frameMetrics(loading.times)})
        await settle(page)
        await instrument(page,false)
        if (path==='/payments') {
          // 실제 SPA 이동·카운트업·로딩·잉크 밑줄. 성능 실행엔 스크린샷/좌표 읽기 없음.
          for (let i=0;i<6;i++) {
            await page.getByRole('link',{name:'대시보드',exact:true}).first().click(); await page.waitForTimeout(300)
            await page.getByRole('link',{name:'납부',exact:true}).first().click(); await page.waitForTimeout(300)
          }
        } else {
          const cdp=await ctx.newCDPSession(page)
          for (let i=0;i<30;i++) { await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:180,y:300,deltaX:0,deltaY:i<15?35:-35}); await page.waitForTimeout(17) }
          await cdp.detach()
        }
        const raw=await stopInstrumentation(page), windows=raw.inputs.map(input=>[input.time,input.time+300]), values=metrics.frameMetrics(raw.times,windows)
        const responses=raw.inputs.map(input=>({input,firstDOMMutationMs:raw.mutations.find(time=>time>=input.time)-input.time}))
        report.frames.push({label,phase,path,viewport,reduced,repetition,...values,responses,raw})
      } catch(error) { report.failures.push({label,error:error.message}) }
      finally { await ctx.close() }
    }
  }
}
async function touchChecks(base, phase, path, reduced) {
  const {ctx,page,faults}=await context(base,catalog.viewports[0],reduced,{delay:850})
  const label=`${phase}-${path}-touch-${reduced}`
  try {
    await page.goto(base+path); await page.waitForTimeout(1400)
    const cdp=await ctx.newCDPSession(page)
    const gesture=async (distance,cancel=false) => {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:390,y:180}]})
      for(let i=1;i<=12;i++) {
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:390,y:180+distance*i/12}]})
        await page.waitForTimeout(16)
      }
      await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]})
    }
    for(const [name,distance,cancel] of [['below',100,false],['cancel',200,true],['above',200,false],['failure',200,false],['retry',200,false]]) {
      faults.error=name==='failure'?'/api/grades':undefined
      await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}))
      const start=report.requests.length
      await instrument(page,true); await gesture(distance,cancel)
      if(name==='above') await gesture(200) // 대기 중 재진입
      await page.waitForTimeout(1600)
      const requests=report.requests.slice(start), raw=await stopInstrumentation(page)
      report.touches.push({label,name,distance,expectedDistance:Math.min(120,distance*.4),cancel,requests,raw})
      if(name==='below'||name==='cancel') assert.equal(requests.length,0,`${label}/${name} 임계 미만/취소 후 요청`)
      else assert(requests.length>0,`${label}/${name} 임계 초과 후 요청 없음`)
    }
    await cdp.detach()
  } catch(error) { report.failures.push({label,error:error.message}) }
  finally { await ctx.close() }
}
async function sendTransitions(base,phase,reduced,result) {
  const expected={path:'/api/payssam/send',method:'POST',delay:800,status:result==='error'?500:200,json:result==='success'?{code:'0000'}:result==='scheduled'?{code:'SCHEDULED',scheduled_at_kst:'2026-09-15 11:00'}:{error:'합성 전환 실패'},match:body=>body.studentId==='paper-1'&&body.billingMonth==='2026-09'&&body.amount===300000}
  const {ctx,page}=await context(base,catalog.viewports[0],reduced,{write:expected})
  const label=`${phase}-quick-${result}-${reduced}`
  try {
    await page.goto(base+'/billing'); await settle(page); await openCase(page,'quick')
    const input=page.getByPlaceholder('이름 또는 반으로 검색...')
    await input.fill('합성학생01')
    await page.getByRole('button').filter({hasText:'합성학생01'}).last().click()
    const dialog=page.getByRole('dialog').last()
    await dialog.getByRole('button',{name:'청구서 발송',exact:true}).click()
    await settle(page); await markSurface(page,'quick')
    recordSurface({label,id:'quick',phase,reduced,state:'confirming',...await corners(page,`${label}-confirming`,'center')})
    await instrument(page,true)
    await button(page,'확인, 발송합니다').click()
    await page.waitForTimeout(80)
    recordSurface({label,id:'quick',phase,reduced,state:'sending',...await corners(page,`${label}-sending`,'center')})
    await page.waitForTimeout(800)
    recordSurface({label,id:'quick',phase,reduced,state:result,...await corners(page,`${label}-${result}`,'center')})
    assert.equal(expected.used,true,'합성 발송 요청 횟수 1회 필요')
    await page.waitForTimeout(result==='scheduled'?3800:2200)
    report.frames.push({label,kind:'geometry-only',...await stopInstrumentation(page)})
  } catch(error) { report.failures.push({label,error:error.message}) }
  finally { await ctx.close() }
}
async function kioskCheck(base,phase) {
  const size=process.env.POLISH_KIOSK_VIEWPORT
  if (!size) { report.pending.push({id:'kiosk-size',phase,reason:'사용 중인 태블릿의 실제 CSS viewport를 POLISH_KIOSK_VIEWPORT=가로x세로로 지정'}); return }
  assert(/^\d{3,4}x\d{3,4}$/.test(size))
  const [width,height]=size.split('x').map(Number)
  const {ctx,page}=await context(base,{width,height},false)
  try {
    await page.goto(base+'/kiosk'); await settle(page)
    const values=await page.evaluate(()=>({paper:document.querySelector('[data-ui-theme="paper"]')!==null,bg:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),grain:getComputedStyle(document.body,'::before').content}))
    assert.equal(values.paper,false); assert.equal(values.bg,'#17171c'); assert.equal(values.grain,'none')
    await page.screenshot({path:`${out}/${phase}-kiosk-${size}.png`})
    report.surfaces.push({id:'kiosk-inline',phase,viewport:{width,height},status:'비대상: 인라인 안내/전체화면',values})
  } finally { await ctx.close() }
}
try {
  browser=await chromium.connectOverCDP(endpoint)
  report.browser=browser.version()
  if (mode==='geometry') {
    for (const [phase,base] of Object.entries(bases)) {
      for (const viewport of catalog.viewports) for (const reduced of [false,true]) await geometryRun(base,phase,viewport,reduced)
      const {ctx,page}=await context(base,catalog.viewports[0],false)
      try {
        await page.goto(base+'/payments'); await settle(page)
        const guarded = async (stage, fn) => { try { await fn() } catch (error) { report.failures.push({ stage, phase, error: error.message }) } }
        await guarded('defectControls', () => defectControls(page)); await guarded('scrollCheck', () => scrollCheck(page,phase)); await guarded('headerCheck', () => headerCheck(page,phase))
        await page.emulateMedia({reducedMotion:'reduce'}); await guarded('headerCheck-reduced', () => headerCheck(page,`${phase}-reduced`))
      } finally { await ctx.close() }
      const guardedRun = async (stage, fn) => { try { await fn() } catch (error) { report.failures.push({ stage, phase, error: error.message }) } }
      for(const reduced of [false,true]) {
        for(const path of ['/dashboard','/payments','/billing']) await guardedRun(`touch:${path}:${reduced}`, () => touchChecks(base,phase,path,reduced))
        for(const result of ['success','scheduled','error']) await guardedRun(`send:${result}:${reduced}`, () => sendTransitions(base,phase,reduced,result))
      }
      await guardedRun('kiosk', () => kioskCheck(base,phase))
    }
  } else {
    // 같은 조건 before→after를 3회 교대. 모든 raw를 보존하고 p95 중앙 실행을 채택.
    for (let repeat=1;repeat<=3;repeat++) for (const [phase,base] of Object.entries(bases)) await performanceRun(base,phase,repeat)
    const groups=new Map()
    for (const run of report.frames) { const key=JSON.stringify([run.phase,run.path,run.viewport,run.reduced]); if(!groups.has(key))groups.set(key,[]);groups.get(key).push(run) }
    for (const [key,runs] of groups) {
      assert.equal(runs.length,3)
      const selected=[...runs].sort((a,b)=>a.p95-b.p95)[1]; selected.medianRun=true
      if (selected.phase==='after' && (selected.samples<60 || selected.p95>20 || selected.longRatio>.01)) report.failures.push({key,reason:'프레임 목표 미충족',p95:selected.p95,longRatio:selected.longRatio,samples:selected.samples})
    }
  }
} catch(error) { report.failures.push({stage:'run',error:error.message}) }
finally {
  // raw는 행별로 기록한다. 미자동화 상태·실기기 검증은 별도 미완료로 남는다.
  report.pending.push({id:'physical-device',reason:'관성·실제 키보드·safe-area·사용 태블릿 실측 별도'})
  const remaining=report.matrix.filter(row=>row.before.status==='미검증'||row.after.status==='미검증').length
  report.pending.push({id:'A-matrix',remaining,reason:'기본/확장/스크롤/Quick 전환 외 세부 상태는 미검증으로 유지'})
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))
  if (browser) await browser.close()
}
console.log(JSON.stringify({mode,frames:report.frames.length,surfaces:report.surfaces.length,failures:report.failures.length,pending:report.pending.length,out}))
if (report.failures.length || report.pending.length) process.exitCode=1
