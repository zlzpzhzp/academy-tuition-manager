/** 합성 데이터 전용. 다크 스킴 전후 대비·플래시·탭가림 실측(격리 빌드, CDP). */
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { fixture, token, openCase } from './support/dark-cases.mjs'
import catalog from './polish-cases.cjs'
import metrics from './dark-metrics.mjs'
import motion from './polish-metrics.cjs'

const cdp=process.env.POLISH_CDP||'http://127.0.0.1:9337'
assert(/^http:\/\/127\.0\.0\.1:93\d\d$/.test(cdp))
const builds=process.env.POLISH_BUILDS||'/tmp/tuition-polish-dark-20260914'
const out=process.env.POLISH_OUTPUT||'/tmp/tuition-polish-dark-evidence'
assert(out.startsWith('/tmp/tuition-polish-'))
const bases={before:'http://127.0.0.1:3381',after:'http://127.0.0.1:3382'}
const mode=process.env.DARK_MODE||'screens'
assert(['screens','flash','performance'].includes(mode))
await mkdir(out,{recursive:true})
const report={mode,bases,identities:{},screens:[],flash:[],transitions:[],header:[],failures:[],pending:[],requests:[],startedAt:new Date().toISOString()}
const viewports=[{width:412,height:915},{width:820,height:1180}]
const routes=['/dashboard','/payments','/billing','/special','/settings','/students','/students/paper-1','/attendance','/notice','/stats','/finance','/finance/auth','/agent','/teachers/paper-teacher','/login','/dark-not-found']
let browser
const safe=s=>s.replace(/[^a-zA-Z0-9_-]/g,'-')
async function check(label,fn){try{await fn()}catch(e){report.failures.push({label,error:e.message})}}
async function context(base,viewport,{scheme='dark',stored=scheme,os='light',reduced=false,delay=0,error=false,readFailure=false,writeFailure=false,inject=false}={}) {
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,isMobile:viewport.width<640,hasTouch:true,colorScheme:os,reducedMotion:reduced?'reduce':'no-preference',serviceWorkers:'block',timezoneId:'Asia/Seoul',locale:'ko-KR'})
  await ctx.addCookies([{name:'auth_token',value:token('synthetic-admin'),url:base},{name:'finance_session',value:token('finance'),url:base}])
  await ctx.addInitScript(({stored,readFailure,writeFailure,inject,observe})=>{
    const RealDate=Date
    window.Date=class extends RealDate {constructor(...args){super(...(args.length?args:['2026-09-14T04:00:00Z']))}static now(){return new RealDate('2026-09-14T04:00:00Z').getTime()}}
    if(stored===null)localStorage.removeItem('paper-scheme');else localStorage.setItem('paper-scheme',stored)
    localStorage.setItem('memo-dismiss:legacy-synthetic','1')
    if(readFailure)Storage.prototype.getItem=()=>{throw Error('synthetic denied')}
    if(writeFailure)Storage.prototype.setItem=()=>{throw Error('synthetic quota')}
    window.__darkFrames=[]; window.__darkObserving=true
    function frame(t){
      if(!window.__darkObserving)return
      if(document.documentElement) {
        const root=getComputedStyle(document.documentElement),body=document.body&&getComputedStyle(document.body)
        window.__darkFrames.push({t,root:root.backgroundColor,body:body?.backgroundColor,scheme:document.documentElement.dataset.paperScheme,ready:document.readyState})
      }
      requestAnimationFrame(frame)
    }
    if(observe)requestAnimationFrame(frame)
    if(inject)addEventListener('DOMContentLoaded',()=>{
      const style=document.createElement('style');style.textContent='html,body{background:#f4f1ea!important}'
      // 한 프레임 이상의 밝은 바탕 대조. rAF 순서가 바뀌어도 다음 프레임까지 유지.
      requestAnimationFrame(()=>{document.head.append(style);requestAnimationFrame(()=>requestAnimationFrame(()=>style.remove()))})
    })
  },{stored,readFailure,writeFailure,inject,observe:mode==='flash'})
  await ctx.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),p=url.pathname
    if(url.origin!==base){report.failures.push({label:'external blocked',origin:url.origin});return route.abort()}
    if(p.startsWith('/api/')) {
      report.requests.push({path:p,method:req.method()})
      if(req.method()!=='GET'){
        if(p==='/api/payssam/resettle'&&req.method()==='POST'&&req.postDataJSON()?.dryRun===true)return route.fulfill({json:{mode:'refund'}})
        report.failures.push({label:'unexpected write blocked',path:p,method:req.method()});return route.abort()
      }
      try {
        const json=fixture(url.href)
        if(delay)await new Promise(resolve=>setTimeout(resolve,delay))
        return route.fulfill({status:error&&p==='/api/grades'?500:200,json:error&&p==='/api/grades'?{error:'합성 오류'}:json})
      } catch(e){report.failures.push({label:'fixture missing',error:e.message});return route.abort()}
    }
    if(p==='/__polish/receipt.svg'||p==='/_next/image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="520"><rect width="400" height="520" fill="#fff"/><text x="20" y="40">Synthetic receipt</text></svg>'})
    if(p==='/sw.js')return route.abort()
    if(req.method()==='GET'&&(routes.includes(p)||p==='/kiosk'||p==='/'||p.startsWith('/_next/static/')||/^\/(icons|fonts)\//.test(p)||['/manifest.json','/manifest-kiosk.json','/favicon.ico'].includes(p)))return route.continue()
    report.failures.push({label:'request blocked',path:p});return route.abort()
  })
  const page=await ctx.newPage();page.setDefaultTimeout(7000)
  page.on('pageerror',e=>report.failures.push({label:'pageerror',error:e.message}))
  page.on('console',m=>{if(/hydration|hydrated|didn't match/i.test(m.text()))report.failures.push({label:'hydration',error:m.text()})})
  page.on('dialog',d=>d.dismiss())
  return {ctx,page}
}
async function settle(page){await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(700)}
async function capture(page,label){
  const scan=await page.evaluate(metrics.scanPage)
  const image=`${safe(label)}.png`;await page.screenshot({path:`${out}/${image}`,fullPage:true})
  report.screens.push({label,image,...scan})
  if(!scan.rows.length||scan.rows.some(r=>!r.pass)||scan.overflow||scan.blocked.length)report.failures.push({label,reason:'대비/탭가림/가로넘침',contrast:scan.rows.filter(r=>!r.pass),blocked:scan.blocked})
  if(scan.unmeasured.length)report.pending.push({label,reason:'실제 합성 미측정',rows:scan.unmeasured})
}
async function header(page,label){
  for(const y of [0,30,60,90,120]){
    await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);await page.waitForTimeout(100)
    const row=await page.evaluate(()=>{
      const h=document.querySelector('[data-payments-header]'),title=document.querySelector('[data-payments-title]'),bg=document.querySelector('[data-payments-nav-background]'),status=document.querySelector('[data-payments-sticky-status]')
      return {y:scrollY,mode:h?.getAttribute('data-payments-motion'),reserved:h?.offsetHeight,scale:new DOMMatrix(getComputedStyle(title).transform).a,height:bg?.getBoundingClientRect().height,statusY:new DOMMatrix(getComputedStyle(status).transform).f}
    })
    const u=y/120,p=row.mode==='reduced'?1:u*u*(3-2*u)
    report.header.push({label,...row,expected:{scale:1-.38*p,height:84-32*p,statusY:-32*p}})
    assert(Math.abs(row.y-y)<1&&row.reserved===84&&Math.abs(row.scale-(1-.38*p))<.015&&Math.abs(row.height-(84-32*p))<1&&Math.abs(row.statusY+32*p)<1,'헤더 값표')
  }
}
async function screens(){
  // before/light와 after/light 같은 상태를 먼저 대조하고 after/dark를 추가한다.
  for(const [phase,base] of Object.entries(bases))for(const scheme of phase==='before'?['light']:['light','dark'])for(const viewport of viewports){
    const {ctx,page}=await context(base,viewport,{scheme})
    try{
      for(const path of routes)await check(`${phase}-${scheme}-${viewport.width}-${path}`,async()=>{
        await page.goto(base+path);await settle(page);await capture(page,`${phase}-${scheme}-${viewport.width}-${path}`)
        if(path==='/payments')await header(page,`${phase}-${scheme}-${viewport.width}`)
      })
      for(const [id,path,,, ,states] of catalog.surfaces)await check(`${phase}-${scheme}-${viewport.width}-${id}`,async()=>{
        await page.goto(base+(id==='toast'?'/settings':path));await settle(page)
        if(id==='toast') {
          await page.route('**/api/audit-logs*',route=>route.fulfill({status:500,json:{error:'합성 토스트 대조'}}))
          await page.getByRole('button',{name:'변경 로그',exact:true}).click()
          await page.locator('[data-sonner-toast]').waitFor()
        } else await openCase(page,id)
        await settle(page)
        await capture(page,`${phase}-${scheme}-${viewport.width}-${id}-open`)
        report.pending.push({phase,scheme,viewport,id,states:states.filter(s=>!['open','form','idle','content'].includes(s)),reason:'추가 상태별 조작·계측 필요'})
      })
    }finally{await ctx.close()}
    for(const state of ['loading','error']) {
      const {ctx,page}=await context(base,viewport,{scheme,delay:state==='loading'?1800:0,error:state==='error'})
      try{await page.goto(base+'/payments',{waitUntil:'domcontentloaded'});if(state==='error')await settle(page);await capture(page,`${phase}-${scheme}-${viewport.width}-${state}`)}finally{await ctx.close()}
    }
  }
}
async function flash(){
  const matrix=[{stored:null,os:'dark'},{stored:'invalid',os:'dark'},{stored:'auto',os:'light'},{stored:'auto',os:'dark'},{stored:'light',os:'dark'},{stored:'dark',os:'light'},{stored:'dark',os:'dark',readFailure:true},{stored:'dark',os:'light',inject:true}]
  for(const viewport of viewports)for(const options of matrix){
    const expected=options.readFailure||!['light','dark'].includes(options.stored)?options.os:options.stored
    const label=`flash-${viewport.width}-${JSON.stringify(options)}`,{ctx,page}=await context(bases.after,viewport,{...options,delay:700})
    try{
      const session=await ctx.newCDPSession(page);await session.send('Page.enable')
      const png=[],writes=[]
      let visit='entry' // entry/reload 프레임 파일명을 분리한다(review-diff 210426 P2)
      session.on('Page.screencastFrame',event=>{
        // navigation 전 about:blank 프레임은 loader 문서 검증에 포함하지 않는다.
        const file=`${safe(label)}-${visit}-${png.length}.png`,buffer=Buffer.from(event.data,'base64')
        try{png.push({file,timestamp:event.metadata.timestamp,colors:metrics.pngSamples(buffer)})}catch(e){report.failures.push({label,error:e.message})}
        writes.push(writeFile(`${out}/${file}`,buffer));session.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{}) // 컨텍스트 종료 뒤 늦게 도착한 프레임 ack 는 무시(미처리 거절로 전체 실행이 죽던 것)
      })
      await session.send('Page.startScreencast',{format:'png',everyNthFrame:1})
      for(const step of ['entry','reload']){
        visit=step; png.length=0
        if(visit==='entry')await page.goto(bases.after+'/payments');else await page.reload()
        await settle(page)
        const data=await page.evaluate(()=>{window.__darkObserving=false;return{origin:performance.timeOrigin,paint:performance.getEntriesByType('paint').map(p=>({name:p.name,start:p.startTime})),frames:window.__darkFrames,finish:performance.now()}})
        const first=data.paint.find(p=>p.name==='first-paint')?.start
        assert(first!==undefined&&data.frames.length>1,'첫 페인트/연속 프레임 누락')
        const observed=png.filter(f=>f.timestamp*1000>=data.origin+first)
        const opposite=observed.filter(f=>metrics.oppositeFrame(f.colors,expected))
        const domOpposite=data.frames.filter(f=>f.t>=first&&[f.root,f.body].filter(Boolean).some(c=>{const rgb=c.match(/[\d.]+/g)?.slice(0,3).map(Number);return rgb&&metrics.oppositeFrame([rgb],expected)}))
        report.flash.push({label,visit,expected,...data,png:observed,opposite,domOpposite,inject:!!options.inject})
        assert(observed.length>0,'CDP 관측 PNG 0')
        assert(data.frames[0].t<=first+.1,'첫 페인트 이전 관측 시작 확인 실패')
        const gaps=data.frames.slice(1).filter((frame,i)=>frame.t-data.frames[i].t>34)
        if(gaps.length||observed[0].timestamp*1000>data.origin+first+34)report.pending.push({label,visit,reason:'연속 관측 공백: 프레임 0 보증 불가',gaps})
        if(options.inject)assert(opposite.length>0||domOpposite.length>0,'밝은 프레임 주입 대조를 검출하지 못함')
        else assert(opposite.length===0&&domOpposite.length===0,'선택 반대 프레임 검출')
      }
      await session.send('Page.stopScreencast');await Promise.all(writes)
    }catch(e){report.failures.push({label,error:e.message})}finally{await ctx.close()}
  }
}
async function performanceRuns(){
  for(const viewport of viewports)for(const reduced of [false,true])for(let repeat=1;repeat<=3;repeat++){
    const {ctx,page}=await context(bases.after,viewport,{scheme:'light',reduced})
    try{
      await page.goto(bases.after+'/settings');await settle(page)
      // 캡처·DOM 전수검사를 활성 구간에서 실행하지 않는다.
      await page.evaluate(()=>{window.__times=[];window.__windows=[];window.__running=true;function frame(t){if(!window.__running)return;window.__times.push(t);requestAnimationFrame(frame)}requestAnimationFrame(frame)})
      for(let flip=0;flip<8;flip++){
        await page.evaluate(value=>{const t=performance.now();window.__windows.push([t,t+220]);window.__paperScheme.set(value)},flip%2?'light':'dark')
        await page.waitForTimeout(280)
      }
      const raw=await page.evaluate(()=>{window.__running=false;return{times:window.__times,windows:window.__windows,selected:document.querySelector('[aria-label="화면 톤"] [aria-pressed="true"]')?.textContent,transitions:document.querySelectorAll('[data-paper-color-transition]').length}})
      const values=motion.frameMetrics(raw.times,raw.windows)
      report.transitions.push({viewport,reduced,repeat,...raw,...values})
      assert(values.samples>=60&&values.p95!==null&&values.p95<=20,'활성 구간 p95 ≤20ms/60표본 미충족')
      assert.equal(raw.transitions,0)
      const group=page.getByRole('group',{name:'화면 톤'}),button=group.getByRole('button',{name:'어둡게'})
      await button.focus();await page.keyboard.press('Enter');assert.equal(await button.getAttribute('aria-pressed'),'true')
      await group.getByRole('button',{name:'자동'}).focus();await page.keyboard.press('Space')
      await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(280)
      assert.equal(await page.getAttribute('html','data-paper-scheme'),'dark')
    }catch(e){report.failures.push({label:`performance-${viewport.width}-${reduced}-${repeat}`,error:e.message})}finally{await ctx.close()}
  }
}
try{
  // 접속 실패도 결과 파일에 남긴다. 검증 식별자가 없으면 실행하지 않는다.
  browser=await chromium.connectOverCDP(cdp,{timeout:5000})
  report.browser=browser.version()
  for(const kind of ['base','candidate']){
    report.identities[kind]=JSON.parse(await readFile(`${builds}/${kind}.json`,'utf8'))
    assert.equal(report.identities[kind].buildExit,0,`${kind} 빌드 미완료`)
  }
  if(mode==='screens')await screens();if(mode==='flash')await flash();if(mode==='performance')await performanceRuns()
}catch(e){report.failures.push({label:'run',error:e.message})}
finally{
  report.pending.push({label:'physical-PWA',reason:'OS 시작 화면은 정적 dark manifest. Android/iOS 콜드스타트 별도 실기기 결과 필요'})
  await writeFile(`${out}/${mode}.json`,JSON.stringify(report,null,2))
  if(browser)await browser.close()
}
console.log(JSON.stringify({mode,screens:report.screens.length,flash:report.flash.length,transitions:report.transitions.length,failures:report.failures.length,pending:report.pending.length}))
if(report.failures.length||report.pending.length)process.exitCode=1
