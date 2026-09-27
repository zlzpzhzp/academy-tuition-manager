/** 격리 후보에서만 실행(합성 데이터·127.0.0.1:33xx 후보 두 개). 모션 원칙은 docs/design/GUIDE-scroll-motion.md 참조. */
import { chromium } from 'playwright'
import { createHash, createHmac } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import fixtures from './payments-header-fixtures.cjs'

const origins = { before: process.env.PAYMENTS_BEFORE, after: process.env.PAYMENTS_AFTER }
for (const origin of Object.values(origins)) assert(/^http:\/\/127\.0\.0\.1:33\d\d$/.test(origin ?? ''), '운영 자격증명 없는 격리 127.0.0.1:33xx 후보 두 개가 필요합니다')
const out = process.env.PAYMENTS_OUTPUT || '/tmp/tuition-header-evidence/browser'
await mkdir(out, { recursive: true })
const report = { cases: [], frames: [], failures: [], blockedExternal: [], unknownApi: [], sends: [], parity: [], geometry: [], touches: [], trace: [], builds: {} }
assert.notEqual(origins.before, origins.after, '전후 후보는 서로 다른 서버여야 한다')
assert(process.env.PAYMENTS_CANDIDATES, '이번 소스의 후보 manifest를 명시하세요')
const candidates = JSON.parse(await readFile(process.env.PAYMENTS_CANDIDATES, 'utf8'))
assert(candidates.before.ref.startsWith('0cd3f05'), 'before는 화살표 변경을 포함한 0cd3f05 실행 코드여야 한다')
for (const phase of ['before', 'after']) {
  assert.equal(candidates[phase].env_files, 0, '후보에 운영 .env를 복사하지 마세요')
  assert.equal(candidates[phase].officialBuild, 'passed', '설정/타입 검사를 우회하지 않은 정식 후보 빌드 통과가 필요합니다')
  assert.deepEqual(candidates[phase].configDifferences, [], '후보 설정은 원본 그대로여야 합니다')
  assert(Object.keys(candidates[phase].sourceFiles).length > 0, '빌드 입력 소스 해시가 필요합니다')
  for (const [path, hash] of Object.entries(candidates[phase].sourceFiles)) {
    assert.equal(createHash('sha256').update(await readFile(`${candidates[phase].path}/${path}`)).digest('hex'), hash, `빌드 이후 소스 변경: ${phase}/${path}`)
  }
  report.builds[phase] = { ...candidates[phase], buildId: (await readFile(`${candidates[phase].path}/.next/BUILD_ID`, 'utf8')).trim(), scripts: [] }
}
const browser = await chromium.launch({ args: ['--no-sandbox'] }).catch(async error => {
  report.failures.push({name:'Chromium launch',message:error.message})
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))
  throw error
})
report.browser = browser.version()
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function check(name, fn) {
  try { await fn(); report.cases.push(name); console.log(`PASS ${name}`) }
  catch (error) { report.failures.push({ name, message: error.message }); console.error(`FAIL ${name}: ${error.message}`) }
}
function token() {
  const body = `synthetic-admin|${Math.floor(Date.now() / 1000) + 3600}`
  return `${Buffer.from(body).toString('base64url')}.${createHmac('sha256', 'paper-redesign-synthetic-session-only').update(body).digest('base64url')}`
}
async function context(phase, { width = 412, dpr = 2, driver = 'css', video = false, reduced = false, missingMedia = false, long = false, short = false, empty = false } = {}) {
  const base = origins[phase]
  const startedAt=Date.now()
  const ctx = await browser.newContext({ viewport: { width, height: 915 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, timezoneId: 'Asia/Seoul', locale: 'ko-KR', reducedMotion: reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block', ...(video ? { recordVideo: { dir: `${out}/videos`, size: { width, height: 915 } } } : {}) })
  const state = { data: fixtures.scenario(), memoStatus: 200, memoReadStatus: 200, delay: 0, monthDelay: 0, sends: [], releases: [], unknown: [], external: [], memos: new Map() }
  if (short) state.data.grades[0].classes[0].students = state.data.students.slice(0, 1)
  if (empty) state.data.grades = []
  if (!short && !empty) {
    // 모든 전후 측정은 같은 132명, 같은 긴 학년명, 같은 메모를 쓴다.
    const cls = state.data.grades[0].classes[0]
    cls.students = [...cls.students, ...Array.from({ length: 120 }, (_, i) => ({ ...state.data.students[0], id: `scroll-${i}`, name: `합성스크롤${i}` }))]
  }
  const initialMemo = long ? Array.from({ length: 24 }, (_, i) => `긴 합성 메모 ${i + 1}`).join('\n') : '합성 월 메모\n둘째 줄 검수'
  await ctx.addCookies([{ name: 'auth_token', value: token(), url: base }])
  await ctx.addInitScript(({ driver, missingMedia }) => {
    // 제품용 우회 스위치 없이 브라우저의 미지원 환경만 재현한다. CSS 경로는 실제 지원을 사용한다.
    if (driver === 'fallback') {
      const supports = CSS.supports.bind(CSS)
      CSS.supports = (...args) => args[0] === 'animation-timeline' ? false : supports(...args)
    }
    if (missingMedia) window.matchMedia = undefined
    window.__headerSample = () => {
      const memo=document.querySelector('textarea[aria-label="월 메모"]'),list=document.querySelector('[data-payments-content]'),title=document.querySelector('[data-payments-title]'),nav=document.querySelector('[data-payments-nav]'),background=document.querySelector('[data-payments-nav-background]')
      const rect = el => { const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height} }
      const range=document.createRange();range.selectNodeContents(title)
      const text=range.getBoundingClientRect(), previous=document.querySelector('button[aria-label="이전 달"]'),next=document.querySelector('button[aria-label="다음 달"]'),status=document.querySelector('[data-payments-sticky-status]')
      return {time:performance.now(),timeOrigin:performance.timeOrigin,y:scrollY,height:document.documentElement.scrollHeight,documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,maxY:Math.max(0,document.documentElement.scrollHeight-innerHeight),memoDocumentTop:memo.getBoundingClientRect().top+scrollY,listDocumentTop:list.getBoundingClientRect().top+scrollY,titleHeight:title.getBoundingClientRect().height,titleTop:title.getBoundingClientRect().top,titleRatio:title.getBoundingClientRect().height/title.offsetHeight,navHeight:nav.getBoundingClientRect().height,backgroundHeight:background.getBoundingClientRect().height,nav:rect(nav),previous:rect(previous),next:rect(next),status:rect(status),text:{left:text.left,right:text.right,width:text.width},driver:document.querySelector('[data-payments-header]').dataset.paymentsMotion}
    }
    const RealDate = Date
    window.__fixtureDate = '2026-09-13T04:00:00Z'
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [window.__fixtureDate])) }
      static now() { return new RealDate(window.__fixtureDate).getTime() }
    }
  }, { driver, missingMedia })
  await ctx.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== base) { state.external.push(url.origin); return route.abort() }
    if (!url.pathname.startsWith('/api/')) {
      // Navbar가 미리 읽는 페이지와 로컬 정적 자산만 실제 격리 서버로 보낸다.
      const pages=['/payments','/dashboard','/special','/billing','/settings','/finance','/finance/auth']
      const asset=url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || ['/manifest.json','/favicon.ico','/sw.js'].includes(url.pathname)
      const localImage=url.pathname==='/_next/image' && /^\/icons\/[\w.-]+$/.test(url.searchParams.get('url')??'')
      if(req.method()==='GET' && (pages.includes(url.pathname) || asset || localImage)) return route.continue()
      state.unknown.push(`${req.method()} ${url.pathname}`);return route.abort()
    }
    const body = req.method() === 'GET' ? null : req.postDataJSON()
    if (url.pathname === '/api/monthly-memo') {
      const month = body?.month ?? url.searchParams.get('month')
      const old = state.memos.get(month) ?? { content: initialMemo, updated_at: 'v0' }
      if (req.method() === 'GET') return route.fulfill({ status: state.memoReadStatus, json: state.memoReadStatus === 200 ? old : {error:'합성 조회 실패'} })
      if (req.method() === 'PUT') {
        await pause(state.delay)
        if (state.memoStatus === 409 || body.baseUpdatedAt !== old.updated_at) return route.fulfill({ status: 409, json: { code: 'MEMO_CONFLICT', ...old } })
        if (state.memoStatus !== 200) return route.fulfill({ status: state.memoStatus, json: { error: '합성 저장 실패' } })
        const next = { content: body.content, updated_at: `v${Number(old.updated_at.slice(1)) + 1}` }
        state.memos.set(month, next)
        return route.fulfill({ json: { ok: true, ...next } })
      }
    }
    if (req.method() === 'POST' && ['/api/payssam/send', '/api/payssam/resend'].includes(url.pathname)) {
      state.sends.push({ path: url.pathname, body }); await new Promise(resolve => state.releases.push(resolve))
      return route.fulfill({ json: { code: '0000' } })
    }
    if (req.method() === 'POST' && url.pathname === '/api/agent/filter') return route.fulfill({ json: { student_ids: ['header-2', 'header-4', 'header-8'], description: '합성 교집합' } })
    if (req.method() === 'GET') {
      try {
        if (url.pathname === '/api/payments') await pause(state.monthDelay)
        return route.fulfill({ json: fixtures.fixture(state.data, req.url()) })
      } catch { /* 아래에서 미정의 API 실패 */ }
    }
    state.unknown.push(`${req.method()} ${url.pathname}`)
    return route.fulfill({ status: 501, json: { error: '미정의 합성 API' } })
  })
  const page = await ctx.newPage()
  page.on('pageerror', error => report.failures.push({ name: `${phase} pageerror`, message: error.message }))
  const close = async () => {
    report.blockedExternal.push(...state.external); report.unknownApi.push(...state.unknown)
    report.sends.push(...state.sends)
    state.releases.splice(0).forEach(release => release())
    const timeOrigin=video?await page.evaluate(()=>performance.timeOrigin).catch(()=>null):null
    await ctx.close()
    if(video) (report.recordings??=[]).push({phase,driver,width,dpr,reduced,startedAt,timeOrigin,path:await page.video().path()})
    assert.equal(state.external.length, 0, '외부 요청 시도가 있음(차단됨)')
    assert.equal(state.unknown.length, 0, '미정의 API가 있음(실패 처리됨)')
  }
  return { page, state, close, base, driver, reduced: reduced || missingMedia }
}
async function settle(page) { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(350) }
async function visit(env, route = '/payments') {
  await env.page.goto(env.base + route, { waitUntil: 'networkidle' }); await settle(env.page)
  if (route === '/payments') {
    await env.page.getByRole('textbox', { name: '월 메모' }).waitFor()
    if (env.state.data.grades.length) await env.page.locator('[data-student-row]').first().waitFor()
    if (env.base === origins.after) await assertDriver(env.page, env.reduced ? 'reduced' : env.driver)
    // 사본에서 빌드한 JS/CSS와 실제 서버가 전달한 바이트를 대조한다.
    const phase = env.base === origins.before ? 'before' : 'after'
    if (!report.builds[phase].scripts.length) {
      const scripts = await env.page.locator('script[src], link[rel="stylesheet"][href]').evaluateAll(nodes => nodes.map(n => n.src || n.href).filter(src => src.includes('/_next/static/')))
      assert(scripts.length > 0)
      for (const src of scripts) {
        const url = new URL(src); assert.equal(url.origin, env.base)
        const response = await env.page.request.get(src); assert(response.ok())
        const actual = await response.body()
        const expected = await readFile(`${candidates[phase].path}/.next/${url.pathname.slice('/_next/'.length)}`)
        const hash = bytes => createHash('sha256').update(bytes).digest('hex')
        assert.equal(hash(actual), hash(expected), `후보/실행 JS/CSS 불일치: ${url.pathname}`)
        report.builds[phase].scripts.push({ path: url.pathname, sha256: hash(actual) })
      }
    }
  }
}
async function overdue(page) {
  await page.getByRole('button', { name: '결제일 선택', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^청구지연 \d/ }).click()
  await page.getByRole('button', { name: '적용', exact: true }).click(); await settle(page)
}
async function screenshot(page, name) { await page.screenshot({ path: `${out}/${name}.png` }) }
async function titleCaptures(page, name) {
  const nav=page.locator('[data-payments-nav]'),box=await nav.boundingBox()
  const png=await nav.screenshot({path:`${out}/${name}-actual.png`})
  // 원래 DPR로 얻은 래스터를 확대한다. 제목의 font-size/배율을 바꿔 다시 래스터화하지 않는다.
  const enlarged=await page.context().newPage()
  try {
    await enlarged.setContent(`<img alt="" src="data:image/png;base64,${png.toString('base64')}" style="display:block;width:${box.width*4}px;image-rendering:pixelated">`)
    await enlarged.locator('img').screenshot({path:`${out}/${name}-4x.png`,scale:'css'})
  } finally {await enlarged.close()}
}
async function rowContract(page) {
  return page.evaluate(() => ({
    normal: [...document.querySelectorAll('[data-section-key] [data-student-row]')].map(el => el.dataset.studentRow).sort(),
    all: [...document.querySelectorAll('[data-student-row]')].map(el => el.dataset.studentRow).sort(),
    badges: [...document.querySelectorAll('button')].filter(el => el.title.includes('조건의 미발송') || el.title.includes('카톡 알림 재발송')).map(el => ({ text: el.textContent, disabled: el.disabled })).sort((a, b) => a.text.localeCompare(b.text)),
  }))
}
async function controlsInOneRow(page) {
  const result = await page.locator('[data-payments-filters]').evaluate(el => {
    const buttons = [...el.querySelectorAll('button')], rect = el.getBoundingClientRect()
    return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, height: rect.height, scrollWidth: el.scrollWidth, width: el.clientWidth, centers: buttons.filter(b => b.getAttribute('aria-label') !== '직접 입력 해제').map(b => { const r=b.getBoundingClientRect();return r.top+r.height/2 }) }
  })
  assert(result.pageWidth <= result.viewport + 1, '문서 전체 가로 넘침')
  assert(Math.max(...result.centers) - Math.min(...result.centers) <= 3, '필터 컨트롤 두 줄')
  // 모든 칩과 ×는 내부 스크롤로 실제 포커스 및 hit-test가 가능해야 한다.
  const buttons = page.locator('[data-payments-filters] button')
  for (let i = 0; i < await buttons.count(); i++) {
    const b=buttons.nth(i)
    await b.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'nearest'}))
    const hit=await b.evaluate(el=>{const r=el.getBoundingClientRect();const p=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return p===el||el.contains(p)})
    assert(hit, `필터 ${i} 잘림/가림`)
    if (await b.isEnabled()) { await b.focus(); assert(await b.evaluate(el=>el===document.activeElement)) }
  }
  return result
}
async function at(page, y) { await page.evaluate(y=>scrollTo(0,y),y); await settle(page) }
async function geometry(page) { return page.evaluate(() => window.__headerSample()) }
function curve(y) { const u=Math.min(1,Math.max(0,y/120));return u*u*(3-2*u) }
function motion(sample, reduced = false) {
  const p=reduced?1:curve(sample.y), near=(actual,expected,label)=>assert(Math.abs(actual-expected)<=1,`${label}: ${actual} != ${expected} (실제 y=${sample.y})`)
  assert(sample.documentWidth<=sample.viewport+1,'화살표 wrapper로 문서 가로 넘침')
  assert(Math.abs(sample.titleRatio-(1-.38*p))<=.005, `제목 비율 ${sample.titleRatio}, p=${p}`)
  near(sample.backgroundHeight,84-32*p,'배경 높이'); near(sample.navHeight,84,'고정 문서 공간')
  near(sample.previous.left,sample.nav.left+12+p*(sample.nav.width/2-138),'이전 x')
  near(sample.next.left,sample.nav.right-56-p*(sample.nav.width/2-138),'다음 x')
  for(const button of [sample.previous,sample.next]) {
    near(button.top,sample.nav.top+4+16*(1-p),'화살표 y')
    near(button.width,44,'버튼 폭');near(button.height,44,'버튼 높이')
  }
  near(sample.status.top,sample.nav.top+84-32*p,'상태줄 y')
  assert(sample.previous.right<=sample.text.left && sample.text.right<=sample.next.left,'화살표와 제목 텍스트 겹침')
  if(p===1) for(const gap of [sample.text.left-sample.previous.right,sample.next.left-sample.text.right]) assert(gap>=12 && gap<=21,`축소 텍스트 간격 ${gap}`)
}
async function assertDriver(page, expected) {
  const actual=await page.evaluate(()=>{
    const header=document.querySelector('[data-payments-header]')
    const layers=[document.querySelector('[data-payments-title]'),document.querySelector('[data-payments-nav-background]'),document.querySelector('button[aria-label="이전 달"]').parentElement,document.querySelector('button[aria-label="다음 달"]').parentElement,document.querySelector('[data-payments-sticky-status]')]
    return {driver:header.dataset.paymentsMotion,maxY:document.documentElement.scrollHeight-innerHeight,inline:header.style.getPropertyValue('--payments-scroll-progress'),layers:layers.map(el=>({animations:el.getAnimations().map(a=>a.timeline?.constructor.name),name:getComputedStyle(el).animationName,range:getComputedStyle(el).animationRange,timeline:getComputedStyle(el).animationTimeline}))}
  })
  assert.equal(actual.driver,expected, 'CSS/폴백의 실제 선택')
  if(expected==='css') {
    assert.equal(actual.inline,'','CSS 경로에 폴백 쓰기 없음')
    for(const layer of actual.layers) {
      if(actual.maxY>0) assert.deepEqual(layer.animations,['ScrollTimeline'])
      else assert(layer.animations.every(name=>name==='ScrollTimeline')) // inactive timeline은 in-effect animation이 없을 수 있다.
      assert.notEqual(layer.name,'none');assert.equal(layer.range,'0px 120px');assert.match(layer.timeline,/scroll\(/)
    }
  } else for(const layer of actual.layers) {assert.equal(layer.name,'none');assert.deepEqual(layer.animations,[])}
}
async function captureStart(page) { await page.evaluate(() => {
  window.__headerFrames=[]; window.__headerRecording=true
  const capture=()=>{ if(!window.__headerRecording)return;window.__headerFrames.push(window.__headerSample());window.__headerFrame=requestAnimationFrame(capture) };capture()
}) }
async function captureEnd(page) { return page.evaluate(() => { window.__headerRecording=false;cancelAnimationFrame(window.__headerFrame);return window.__headerFrames }) }
function stable(initial, sample) {
  assert.equal(sample.height,initial.height,'일반 스크롤에서 scrollHeight 변화')
  for(const key of ['memoDocumentTop','listDocumentTop']) assert(Math.abs(sample[key]-initial[key])<=1,`${key} 문서 좌표 이동`)
}
async function memoBelowHeader(page) {
  await settle(page)
  assert(await page.evaluate(()=>{
    const memo=document.querySelector('textarea[aria-label="월 메모"]').getBoundingClientRect()
    const status=document.querySelector('[data-payments-sticky-status]').getBoundingClientRect()
    return memo.top>=status.bottom+7 && memo.top<innerHeight-40
  }), '메모 확인 후 다시 커진 네비/상태줄에 메모가 가려짐')
}
async function hitFive(page, locator, minSize = 0) {
  const result = await locator.evaluate((el,minSize)=>{
    const r=el.getBoundingClientRect(), points=[[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]]
    return {width:r.width,height:r.height,inViewport:r.top>=56&&r.bottom<=innerHeight,large:r.width>=minSize&&r.height>=minSize,hits:points.map(([x,y])=>{const hit=document.elementFromPoint(r.x+r.width*x,r.y+r.height*y);return hit===el||el.contains(hit)})}
  },minSize)
  assert(result.inViewport && result.large && result.hits.every(Boolean), `5점 hit-test 실패 ${JSON.stringify(result)}`)
}
async function clickCenter(page, locator) { const r=await locator.boundingBox();assert(r);await page.mouse.click(r.x+r.width/2,r.y+r.height/2) }

try {
  for (const width of [360, 412, 430]) await check(`${width} 기본/범위/지연/개별/발송진행 한 줄과 실제 입력`, async () => {
    const env=await context('after',{width,video:true}), {page,state}=env
    try {
      await visit(env); await controlsInOneRow(page); await screenshot(page,`${width}-default`)
      await page.getByRole('button',{name:'전체',exact:true}).click()
      await page.getByRole('button',{name:'결제일 선택',exact:true}).click()
      await page.locator('[data-day="1"]').click();await page.locator('[data-day="30"]').click();await page.getByRole('button',{name:'적용',exact:true}).click();await settle(page)
      await controlsInOneRow(page);await screenshot(page,`${width}-range`)
      await page.getByRole('button',{name:'직접 입력 해제',exact:true}).click()
      await overdue(page);await controlsInOneRow(page);await screenshot(page,`${width}-overdue`)
      await page.locator('button[title*="조건의 미발송"]').click();await page.getByRole('button',{name:'일괄 발송',exact:true}).click();await page.getByRole('button',{name:'확인, 발송합니다',exact:true}).click()
      await controlsInOneRow(page);await screenshot(page,`${width}-sending`)
      await page.evaluate(()=>scrollTo(0,300));await settle(page)
      await page.getByRole('button',{name:'중단',exact:true}).click();const atStop=state.sends.length;state.releases.splice(0).forEach(release=>release());await page.waitForTimeout(1200);assert.equal(state.sends.length,atStop)
      await page.evaluate(()=>scrollTo(0,0));await page.mouse.wheel(0,-80);await settle(page)
      state.data.grades[0].classes[0].students=[state.data.students[1]];await visit(env);await overdue(page)
      await controlsInOneRow(page);await page.getByRole('button',{name:/개별 발송 필요/}).click();await screenshot(page,`${width}-electives-only`)
    } finally {await env.close()}
  })
  for (const width of [360, 412, 430]) await check(`${width}: 0/150/400 캡처와 자연 흐름 불변`, async () => {
    const env = await context('after', { width, video: true }), { page } = env
    try {
      await visit(env)
      const initial = await geometry(page)
      assert(initial.maxY >= 400, '충분히 긴 합성 목록 필요')
      for (const y of [0, 150, 400, 150, 0]) {
        await at(page, y); const sample = await geometry(page)
        stable(initial, sample); report.geometry.push({ kind: 'width-roundtrip', width, requested: y, ...sample })
        await screenshot(page, `${width}-${y}`)
      }
    } finally { await env.close() }
  })
  for(const driver of ['css','fallback']) await check(`${driver} 축소 뒤 투명 네비 공간은 뒤 콘텐츠 hit-test를 통과`, async () => {
    const env=await context('after',{driver,long:true}), {page}=env
    try {
      await visit(env);await at(page,150)
      const result=await page.evaluate(()=>{
        const nav=document.querySelector('[data-payments-nav]').getBoundingClientRect(),x=innerWidth/2,y=nav.top+70
        const hit=document.elementFromPoint(x,y),memo=document.querySelector('textarea[aria-label="월 메모"]')
        return {hitMemo:hit===memo, y, memoTop:memo.getBoundingClientRect().top,memoBottom:memo.getBoundingClientRect().bottom}
      })
      assert(result.y>=result.memoTop && result.y<=result.memoBottom,'투명 공간 아래에 메모가 있는 합성 배치 필요')
      assert(result.hitMemo,'투명 네비가 메모 입력을 가로챔')
    } finally {await env.close()}
  })
  await check('412×915: 원문 휠 시퀀스의 입력~정지 전체 프레임', async () => {
    const env = await context('after'), { page } = env
    try {
      await visit(env); await at(page, 0); const initial = await geometry(page)
      await page.mouse.move(390, 700) // textarea 밖의 페이지 스크롤
      for (const delta of [120, 60, -30, -30, 200, -40]) {
        const before = await geometry(page)
        await captureStart(page); await page.mouse.wheel(0, delta); await settle(page)
        const samples = await captureEnd(page)
        for (const sample of samples) stable(initial, sample)
        const after = await geometry(page)
        assert(Math.abs(after.y - (before.y + delta)) <= 1, `휠 ${delta}가 되돌려짐: ${before.y}→${after.y}`)
        const direction = Math.sign(delta)
        for (let i = 1; i < samples.length; i++) assert(direction * (samples[i].y - samples[i - 1].y) >= -1, '입력 도중 역방향 튕김')
        report.geometry.push({ kind: 'wheel', delta, before, after, samples })
      }
    } finally { await env.close() }
  })
  for (const driver of ['css','fallback']) for (const reduced of [false, true]) await check(`${driver} 축소 곡선/정지/복원/최하단 네비 reduced=${reduced}`, async () => {
    const env = await context('after', { driver, reduced, video:true }), { page } = env
    try {
      await visit(env); const heights = new Map(), initial = await geometry(page)
      await captureStart(page)
      for (const y of [0,15,30,45,60,75,90,105,120,150,120,105,90,75,60,45,30,15,0,-10,37.3,60.1,59.9,60.1,37.3]) {
        await at(page, y); const sample = await geometry(page)
        stable(initial, sample)
        motion(sample,reduced)
        if (heights.has(y)) assert(Math.abs(heights.get(y) - sample.titleHeight) < 1, '왕복 비대칭')
        heights.set(y, sample.titleHeight)
        await page.waitForTimeout(250); const stopped = await geometry(page)
        assert(Math.abs(stopped.titleHeight - sample.titleHeight) < .1, '정지 후 크기 변화')
        report.geometry.push({ kind: 'curve', driver, reduced, requested: y, ...sample })
      }
      report.geometry.push({kind:'timestamped-curve-frames',driver,reduced,samples:await captureEnd(page)})
      for (const y of [400, initial.maxY / 2, initial.maxY]) {
        await at(page, y)
        for (const label of ['이전 달', '다음 달']) {
          const nav = page.getByRole('button', { name: label, exact: true })
          await hitFive(page, nav, 44)
        }
        assert((await geometry(page)).titleTop >= 56 - 1, '제목 sticky 해제')
        // 실제 좌표로 월을 바꾼 뒤 반대 버튼으로 복귀. 버튼 DOM과 크기는 그대로다.
        await clickCenter(page, page.getByRole('button', { name: '다음 달', exact: true }))
        await settle(page); assert.match(await page.locator('[data-payments-title]').innerText(), /10월/)
        await clickCenter(page, page.getByRole('button', { name: '이전 달', exact: true })); await settle(page)
      }
      await at(page, 75)
      await page.reload({ waitUntil: 'networkidle' }); await settle(page)
      const restored = await geometry(page)
      assert(Math.abs(restored.y - 75) < 1, 'reload 스크롤 복원 미성립')
      motion(restored,reduced);await assertDriver(page,reduced?'reduced':driver)
      await page.evaluate(() => { scrollTo(0, 60); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) }); await settle(page)
      motion(await geometry(page),reduced)
    } finally { await env.close() }
  })
  for (const driver of ['css','fallback']) for(const width of [360,412,430]) await check(`${driver} ${width} 9~12월 텍스트 간격/입력/폭 변경`,async()=>{
    const env=await context('after',{driver,width,video:true}),{page}=env
    try {
      await visit(env)
      for(const month of [9,10,11,12]) {
        assert.match(await page.locator('[data-payments-title]').innerText(),new RegExp(`${month}월`))
        for(const y of [0,15,30,45,60,75,90,105,120,150]) {
          await at(page,y);const sample=await geometry(page);motion(sample)
          report.geometry.push({kind:'month-gap',driver,width,month,requested:y,...sample})
        }
        for(const label of ['이전 달','다음 달']) await hitFive(page,page.getByRole('button',{name:label,exact:true}),44)
        await clickCenter(page,page.getByRole('button',{name:'이전 달',exact:true}));await settle(page)
        assert.match(await page.locator('[data-payments-title]').innerText(),new RegExp(`${month-1}월`));motion(await geometry(page))
        await clickCenter(page,page.getByRole('button',{name:'다음 달',exact:true}));await settle(page)
        assert.match(await page.locator('[data-payments-title]').innerText(),new RegExp(`${month}월`));motion(await geometry(page))
        if(month<12) {await clickCenter(page,page.getByRole('button',{name:'다음 달',exact:true}));await settle(page)}
      }
      // 같은 마운트에서 너비가 달라져도 두 wrapper의 % 좌표는 새 헤더 폭을 사용한다.
      for(const nextWidth of [430,360,412]) {await page.setViewportSize({width:nextWidth,height:915});await settle(page);motion(await geometry(page))}
      const button=page.getByRole('button',{name:'다음 달',exact:true}),box=await button.boundingBox()
      const position=await button.evaluate(el=>el.parentElement.getBoundingClientRect().toJSON())
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(150)
      const pressed=await button.boundingBox()
      assert(pressed.width<box.width && pressed.width>box.width*.95,'기존 누름 피드백')
      const whilePressed=await button.evaluate(el=>el.parentElement.getBoundingClientRect().toJSON())
      assert.equal(whilePressed.x,position.x);assert.equal(whilePressed.y,position.y)
      await page.mouse.move(1,900);await page.mouse.up();await settle(page);motion(await geometry(page))
    } finally {await env.close()}
  })
  for(const driver of ['css','fallback']) for(const dpr of [2,3]) await check(`${driver} DPR${dpr} will-change 양쪽 실제/확대 래스터`,async()=>{
    const env=await context('after',{driver,dpr}),{page}=env
    try {
      await visit(env)
      for(const promoted of [false,true]) {
        await page.evaluate(promoted=>{
          for(const el of [document.querySelector('[data-payments-title]'),document.querySelector('[data-payments-nav-background]'),document.querySelector('button[aria-label="이전 달"]').parentElement,document.querySelector('button[aria-label="다음 달"]').parentElement,document.querySelector('[data-payments-sticky-status]')]) el.style.willChange=promoted?'transform':'auto'
        },promoted)
        for(const p of [0,.25,.5,.75,1]) {
          // smoothstep 역함수를 수치로 풀어 p 자체의 샘플을 얻는다.
          let low=0,high=120
          for(let i=0;i<40;i++){const mid=(low+high)/2;if(curve(mid)<p)low=mid;else high=mid}
          await at(page,p===0?0:p===1?120:(low+high)/2)
          const sample=await geometry(page);motion(sample)
          report.geometry.push({kind:'text-clarity',driver,dpr,p,promoted,...sample})
          await titleCaptures(page,`text-${driver}-${dpr}-${promoted}-${p}`)
        }
        await at(page,37.3);await page.waitForTimeout(500);motion(await geometry(page))
        await titleCaptures(page,`text-${driver}-${dpr}-${promoted}-stopped`)
        assert.equal(await page.getByRole('heading',{level:1}).count(),1)
      }
    } finally {await env.close()}
  })
  for(const driver of ['css','fallback']) await check(`${driver} 동적 reduced/조회 미지원/실제 짧은 scroll 범위`,async()=>{
    const env=await context('after',{driver}),{page,state}=env
    try {
      await visit(env);await at(page,60)
      for(const reduced of [true,false,true,false]) {
        await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await settle(page)
        await assertDriver(page,reduced?'reduced':driver);motion(await geometry(page),reduced)
      }
      // 목록 길이를 바꾸며 scrollY가 clamp된 뒤의 상태를 검사한다.
      state.data.grades=[];await visit(env);await at(page,150)
      let sample=await geometry(page);motion(sample);report.geometry.push({kind:'empty',driver,requested:150,...sample})
      // 빈 목록의 실제 문서 높이로 viewport를 정해 0px/60px scroll 범위를 만든다.
      for(const maxY of [0,60,0]) {
        await at(page,0);const height=await page.locator('main').evaluate(el=>Math.ceil(el.getBoundingClientRect().bottom+scrollY))
        await page.setViewportSize({width:412,height:height-maxY});await settle(page);await at(page,150)
        sample=await geometry(page)
        assert(Math.abs(sample.maxY-maxY)<=1,`실제 scroll 범위 ${sample.maxY} != ${maxY}`)
        assert(Math.abs(sample.y-maxY)<=1);motion(sample)
        report.geometry.push({kind:'finite-scroll-range',driver,requested:150,...sample})
      }
    } finally {await env.close()}
    const missing=await context('after',{driver,missingMedia:true})
    try {await visit(missing);await at(missing.page,0);motion(await geometry(missing.page),true);await at(missing.page,120);motion(await geometry(missing.page),true)} finally {await missing.close()}
  })
  for (const options of [{long:true}, {long:true,short:true}, {short:true}, {empty:true}]) await check(`메모/짧은·빈 목록/월 로딩 ${JSON.stringify(options)}`, async () => {
    const env = await context('after', { ...options, video: true }), { page, state } = env
    try {
      await visit(env)
      const textarea = page.getByRole('textbox', { name: '월 메모' })
      if (options.long) assert.equal(Math.round((await textarea.boundingBox()).height), 400)
      const initial = await geometry(page)
      for (const y of [0, 150, 400, 0]) {
        await at(page, y); const sample = await geometry(page); stable(initial, sample)
        report.geometry.push({ kind: 'reachable', options, requested: y, ...sample })
        assert(Math.abs(sample.y - Math.min(y, initial.maxY)) <= 1)
        await screenshot(page, `memo-${JSON.stringify(options).replace(/[^a-z]/g, '')}-${y}`)
      }
      await textarea.focus(); await textarea.evaluate(el => { el.setSelectionRange(2, 8); el.scrollTop = 40; window.__memo = el; window.__memoScroll = el.scrollTop })
      await at(page, 150)
      assert(await textarea.evaluate(el => el === document.activeElement && el === window.__memo && el.selectionStart === 2 && el.selectionEnd === 8 && el.scrollTop === window.__memoScroll))
      await at(page, 0); await page.getByRole('button', { name:'결제일 선택', exact:true }).click(); await page.keyboard.press('Escape'); await settle(page)
      assert(await page.getByRole('button',{name:'결제일 선택',exact:true}).evaluate(el=>el===document.activeElement))
      state.monthDelay = 1200; await page.getByRole('button',{name:'다음 달',exact:true}).click(); await page.waitForTimeout(100)
      assert(await textarea.evaluate(el=>el===window.__memo)); assert.equal(await page.locator('[data-student-row]').count(), 0)
      await screenshot(page, `loading-${options.short ? 'short' : options.empty ? 'empty' : 'long'}`)
      await page.waitForTimeout(1400)
    } finally { await env.close() }
  })
  for (const driver of ['css','fallback']) for (const path of ['filter-unpaid', 'filter', 'resend']) for (const position of ['300', 'middle']) await check(`${driver}/${path}/${position}: 보류 요청 중 단일 sticky 중단·5점 hit-test`, async () => {
    const env = await context('after',{driver}), { page, state } = env
    try {
      await visit(env)
      // 발송과 저장 오류가 겹쳐도 두 안내가 각각 남는다.
      state.memoStatus = position === 'middle' ? 409 : 500
      await page.getByRole('textbox', {name:'월 메모'}).fill('합성 보존 초안'); await page.waitForTimeout(700)
      // 제거된 반 버튼의 중단 검증은 미납 필터 일괄로 이관한다.
      if (path === 'filter-unpaid') await page.getByRole('button', {name:'전체',exact:true}).click()
      else await overdue(page)
      assert.equal(await page.locator('button[aria-label$="일괄 청구서 발송"]').count(), 0)
      if (path !== 'resend') await page.locator('button[title*="조건의 미발송"]').click()
      else await page.locator('button[title*="카톡 알림 재발송"]').click()
      await page.getByRole('button',{name:path === 'resend' ? '일괄 재발송' : '일괄 발송',exact:true}).click()
      await page.getByRole('button',{name:path === 'resend' ? '확인, 재발송합니다' : '확인, 발송합니다',exact:true}).click()
      const stop = page.getByRole('button', {name:'중단',exact:true}); await stop.waitFor()
      await stop.evaluate(el=>{window.__stop=el})
      await page.waitForFunction(()=>document.querySelector('[data-payments-sticky-status]')?.textContent.includes('0/'))
      for (let retry=0;state.sends.length===0 && retry<100;retry++) await pause(20)
      assert.equal(state.sends.length, 1)
      for (const y of [300, (await geometry(page)).maxY / 2, 0,30,60,90,120]) {
        await at(page, y); assert.equal(await stop.count(), 1); assert(await stop.evaluate(el=>el===window.__stop))
        const sample=await geometry(page);motion(sample)
        report.geometry.push({kind:'progress-and-error',driver,path,requested:y,...sample})
      }
      await at(page, position === 'middle' ? (await geometry(page)).maxY / 2 : 300)
      await hitFive(page, stop); await clickCenter(page, stop)
      assert.equal(state.sends.length, 1); state.releases.shift()(); await page.waitForTimeout(1100)
      assert.equal(state.sends.length, 1, '중단 뒤 다음 요청 발생')
      assert.equal(await page.getByRole('button',{name:'중단중',exact:true}).count(), 0)
      const warning = page.locator('[data-payments-sticky-status]').getByRole('status').filter({hasText:position === 'middle' ? '다른 기기' : '저장 실패'})
      assert(await warning.isVisible()); await warning.getByRole('button',{name:'메모 확인'}).click(); await memoBelowHeader(page)
      assert(await page.getByRole('textbox',{name:'월 메모'}).evaluate(el=>el===document.activeElement && el.value==='합성 보존 초안'))
    } finally { await env.close() }
  })
  await check('터치: 페이지/textarea 내부/상단 당겨 새로고침 분리', async () => {
    const env = await context('after', {long:true}), {page} = env
    try {
      await visit(env); const cdp = await page.context().newCDPSession(page)
      const gesture = async (kind, x, from, to) => {
        const before = await geometry(page), memoBefore = await page.getByRole('textbox',{name:'월 메모'}).evaluate(el=>el.scrollTop)
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:from}]})
        for (let step=1;step<=10;step++) { await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:from+(to-from)*step/10}]}); await page.waitForTimeout(20) }
        const during = await geometry(page)
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await page.waitForTimeout(1000)
        const after = await geometry(page), memoAfter = await page.getByRole('textbox',{name:'월 메모'}).evaluate(el=>el.scrollTop)
        report.touches.push({kind,start:{x,y:from},end:{x,y:to},fingerDirection:to>from?'down':'up',actualDeltaY:after.y-before.y,before,during,after,memoBefore,memoAfter})
        return {before,during,after,memoBefore,memoAfter}
      }
      await at(page,300)
      const pageTouch = await gesture('page', 390, 760, 540)
      assert(pageTouch.after.y > pageTouch.before.y); stable(pageTouch.before,pageTouch.after)
      await at(page,0)
      const box = await page.getByRole('textbox',{name:'월 메모'}).boundingBox()
      const internal = await gesture('textarea', box.x+box.width/2, box.y+300, box.y+100)
      assert(internal.memoAfter > internal.memoBefore); assert(Math.abs(internal.after.y-internal.before.y)<1)
      await at(page,0)
      const refresh = await gesture('pull-to-refresh', 390, 690, 870)
      assert(refresh.during.height > refresh.before.height, '공용 당겨 새로고침 인디케이터 높이 변화 없음')
      assert.equal(refresh.after.y,0) // 당김 구간은 일반 스크롤 높이 불변에서 제외
      await cdp.detach()
    } finally { await env.close() }
  })
  await check('발송 없는 메모 조회 500 안내·접근', async () => {
    const env=await context('after'), {page,state}=env
    try {
      state.memoReadStatus=500; await visit(env); await at(page,300)
      const warning=page.locator('[data-payments-sticky-status]').getByRole('status').filter({hasText:'메모 로드 실패'})
      assert(await warning.isVisible());await warning.getByRole('button',{name:'메모 확인'}).click(); await memoBelowHeader(page)
      assert(await page.getByRole('textbox',{name:'월 메모'}).evaluate(el=>el===document.activeElement && el.readOnly))
    } finally {await env.close()}
  })
  for(const status of [200,500,409]) await check(`메모 대역 버전/지연/실패 ${status}`,async()=>{
    const env=await context('after'),{page,state}=env
    try{
      await visit(env);state.memoStatus=status;state.delay=600
      await page.getByRole('textbox',{name:'월 메모'}).fill('첫 합성 편집');await page.waitForTimeout(550)
      await page.getByRole('textbox',{name:'월 메모'}).fill('최신 합성 편집');await page.waitForTimeout(1400)
      await page.getByRole('button',{name:'이전 달',exact:true}).focus();await page.evaluate(()=>scrollTo(0,300));await settle(page)
      if(status===200) assert.equal(state.memos.get('2026-09')?.content,'최신 합성 편집')
      else {const alert=page.getByRole('status').filter({hasText:status===409?'다른 기기':'저장 실패'});assert(await alert.isVisible());await alert.getByRole('button',{name:'메모 확인'}).click();await memoBelowHeader(page);assert.equal(await page.getByRole('textbox',{name:'월 메모'}).inputValue(),'최신 합성 편집')}
    }finally{await env.close()}
  })
  for(const phase of ['before','after']) await check(`${phase} 업무 결과/그레인 톤`,async()=>{
    const env=await context(phase),{page}=env
    try{
      await visit(env);await overdue(page);report.parity.push({phase,...await rowContract(page)})
      await screenshot(page,`${phase}-payments`);await visit(env,'/dashboard');await screenshot(page,`${phase}-dashboard`)
    }finally{await env.close()}
  })
  await check('브라우저 일반 명단/퇴원/배지 전후 대조',async()=>{
    assert.equal(report.parity.length,2)
    assert.deepEqual({...report.parity[1],phase:'compared'},{...report.parity[0],phase:'compared'})
  })
  // 영상/좌표 수집과 분리. CSS/폴백 각각 같은 환경에서 before→after를 3회 교대한다.
  for(const driver of ['css','fallback']) for(let run=1;run<=3;run++) for(const phase of ['before','after']) {
    const env=await context(phase,{driver}),{page}=env
    try{
      await visit(env)
      for(const path of ['roundtrip','active-range']) {
        await page.evaluate(()=>scrollTo(0,0));await page.mouse.wheel(0,-80);await settle(page)
        const frame=await page.evaluate(async peak=>{
          const gaps=[];let last,start
          await new Promise(resolve=>requestAnimationFrame(function tick(now){
            start??=now;if(last!==undefined)gaps.push(now-last);last=now
            const elapsed=now-start
            const p=Math.min(1,elapsed/2400);scrollTo(0,p<.5?p*2*peak:(1-p)*2*peak)
            if(elapsed<2400)requestAnimationFrame(tick);else resolve()
          }))
          const sorted=[...gaps].sort((a,b)=>a-b),q=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]
          return {total:gaps.length,over33:gaps.filter(x=>x>33).length,ratio:gaps.filter(x=>x>33).length/gaps.length,p50:q(.5),p95:q(.95),max:Math.max(...gaps),duration:gaps.reduce((a,b)=>a+b,0),gaps}
        },path==='active-range'?120:400)
        report.frames.push({phase,driver,run,path,route:'/payments',width:412,dpr:2,...frame})
      }
      // 별도 전환 경로. 접힘의 성능 기준에 섞지 않는다.
      const start=performance.now();await page.locator('a[href="/dashboard"]').first().click();await settle(page)
      report.frames.push({phase,driver,run,path:'payments→dashboard',elapsed:performance.now()-start})
    }finally{await env.close()}
  }
  for(const driver of ['css','fallback']) await check(`${driver} 별도 trace: Layout/Paint/가속 근거 수집`, async () => {
    const env=await context('after',{driver}), {page}=env
    try {
      await visit(env); await at(page,0)
      const cdp=await page.context().newCDPSession(page), events=[]
      let layers=[]
      cdp.on('LayerTree.layerTreeDidChange',event=>{layers=event.layers??[]})
      await cdp.send('LayerTree.enable')
      cdp.on('Tracing.dataCollected', chunk=>events.push(...chunk.value))
      await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,blink.animations,cc,disabled-by-default-devtools.timeline.stack,disabled-by-default-devtools.timeline.layers',transferMode:'ReportEvents'})
      await page.evaluate(async()=>{
        await new Promise(resolve=>requestAnimationFrame(function tick(now){
          window.__traceStart??=now;const elapsed=now-window.__traceStart
          scrollTo(0,60+60*Math.sin(elapsed/2400*Math.PI*4))
          if(elapsed<2400)requestAnimationFrame(tick);else resolve()
        }))
      })
      const done=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve))
      await cdp.send('Tracing.end');await done
      const layouts=events.filter(event=>event.name==='Layout')
      const reasons=[]
      for(const layer of layers) {
        try {reasons.push({layerId:layer.layerId,backendNodeId:layer.backendNodeId,...await cdp.send('LayerTree.compositingReasons',{layerId:layer.layerId})})}
        catch(error) {reasons.push({layerId:layer.layerId,unavailable:error.message})}
      }
      const root=await cdp.send('DOM.getDocument'),nodes=[]
      for(const selector of ['[data-payments-title]','[data-payments-nav-background]','[data-payments-nav] > div:has(button[aria-label="이전 달"])','[data-payments-nav] > div:has(button[aria-label="다음 달"])','[data-payments-sticky-status]']) {
        const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.root.nodeId,selector})
        const {node}=await cdp.send('DOM.describeNode',{nodeId});nodes.push({selector,backendNodeId:node.backendNodeId})
      }
      report.trace.push({driver,layouts:layouts.length,withStack:layouts.filter(e=>e.args?.beginData?.stackTrace).length,paints:events.filter(e=>e.name==='Paint').length,reasons,nodes,accelerationVerdict:'trace/레이어 이유를 Owner가 판독할 것; 문법 지원과 rAF 간격으로 대체 불가'})
      await writeFile(`${out}/title-${driver}-trace.json`,JSON.stringify({traceEvents:events}))
      await cdp.detach()
      assert.equal(layouts.length,0,'안정된 제목 축소 구간에 Layout 발생: trace 원인 검수 필요')
    } finally {await env.close()}
  })
  for(const driver of ['css','fallback']) for(const path of ['roundtrip','active-range']) await check(`${driver} ${path} 동일 기준선 대비 성능 완료 조건`,async()=>{
    const comparisons = [1,2,3].map(run => {
      const before=report.frames.find(f=>f.phase==='before'&&f.driver===driver&&f.path===path&&f.run===run), after=report.frames.find(f=>f.phase==='after'&&f.driver===driver&&f.path===path&&f.run===run)
      assert(before && after, '전후 3회 모두 필요')
      // 런별 잡음은 기록. 반복적인 p95/33ms 비율 악화는 미해결로 실패시킨다.
      return {run, p50Worse:after.p50>before.p50+1, p95Worse:after.p95>before.p95+1, over33Worse:after.ratio>before.ratio+.01}
    })
    ;(report.performanceComparison??=[]).push({driver,path,comparisons})
    assert(comparisons.filter(c=>c.p50Worse || c.p95Worse || c.over33Worse).length < 2, '3회 중 2회 이상 성능 악화 — 미해결')
  })
}finally{
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close()
}
console.log(`${report.cases.length} passed; ${report.failures.length} failed; artifacts: ${out}`)
if(report.failures.length||report.blockedExternal.length||report.unknownApi.length)process.exitCode=1
