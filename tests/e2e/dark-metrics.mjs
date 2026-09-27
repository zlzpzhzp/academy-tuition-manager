import { inflateSync } from 'node:zlib'
import tokens from './dark-tokens.cjs'
const { luminance, ratio } = tokens

/** CDP PNG RGB/RGBA 8bit, 모든 PNG scanline filter. 미지원 형식은 측정 실패. */
function pngSamples(buffer) {
  if (buffer.subarray(1,4).toString() !== 'PNG') throw Error('PNG 필요')
  let width, height, channels; const parts = []
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii',offset+4,offset+8), data = buffer.subarray(offset+8,offset+8+length)
    if (type === 'IHDR') {
      width=data.readUInt32BE(0); height=data.readUInt32BE(4)
      if (data[8]!==8 || ![2,6].includes(data[9]) || data[12]!==0) throw Error('미지원 PNG 형식')
      channels=data[9]===6?4:3
    }
    if (type==='IDAT') parts.push(data)
    offset+=length+12
  }
  if (!width || !height || !channels) throw Error('PNG 크기 누락')
  const raw=inflateSync(Buffer.concat(parts)), stride=width*channels, pixels=Buffer.alloc(height*stride)
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c}
  for(let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)]; if(filter>4)throw Error('PNG filter 오류')
    for(let x=0;x<stride;x++) {
      const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,b=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0
      pixels[i]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255
    }
  }
  return [[.01,.01],[.99,.01],[.01,.99],[.99,.99]].map(([x,y])=>{const i=(Math.min(height-1,Math.floor(y*height))*width+Math.min(width-1,Math.floor(x*width)))*channels;return Array.from(pixels.subarray(i,i+3))})
}
const oppositeFrame=(samples,scheme)=>samples.some(rgb=>scheme==='dark'?luminance(rgb)>.45:luminance(rgb)<.08)

/** 실제 DOM의 글자·조상 alpha 배경을 합성. 이미지/gradient 교차는 미측정으로 남긴다. */
function scanPage() {
  const rgb=color=>{
    const match=color.match(/^rgba?\(([^)]+)\)$/)
    if (!match) return null
    const values=match[1].split(/[, /]+/).map(Number)
    return [...values.slice(0,3),values[3]??1]
  }
  const lum=c=>c.reduce((s,v,i)=>s+(v/255<=.04045?v/255/12.92:((v/255+.055)/1.055)**2.4)*[.2126,.7152,.0722][i],0)
  const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05)
  const blend=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*fg[3]+bg[i]*(1-fg[3]))
  const root=getComputedStyle(document.documentElement), grain=parseFloat(root.getPropertyValue('--paper-grain-opacity'))*.12 || 0
  const rows=[], unmeasured=[], hits=[]
  for(const el of document.querySelectorAll('body *')) {
    const s=getComputedStyle(el), rect=el.getBoundingClientRect()
    if(!rect.width||!rect.height||rect.bottom<=0||rect.top>=innerHeight||rect.right<=0||rect.left>=innerWidth||s.visibility!=='visible'||el.closest('[aria-hidden="true"],:disabled'))continue
    if(el.matches('button,a,input,textarea,select,[role="button"],[role="option"]')) {
      const l=Math.max(0,rect.left),r=Math.min(innerWidth,rect.right),t=Math.max(0,rect.top),b=Math.min(innerHeight,rect.bottom)
      const points=[[.5,.5],[.2,.2],[.8,.2],[.2,.8],[.8,.8]].map(([x,y])=>{const target=document.elementFromPoint(l+(r-l)*x,t+(b-t)*y);return target===el||el.contains(target)})
      // 완전 가림(5점 전부 false)도 결과에 남긴다 — 제외하면 투명 차단층에 덮인 버튼이 통과로 보인다(review-diff 210426 P2)
      hits.push({tag:el.tagName,label:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,50),points})
    }
    const text=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()) || el.matches('input,textarea')&&el.value
    if(!text||el.closest('svg'))continue
    const chain=[];let partial=false
    for(let node=el;node;node=node.parentElement) {const style=getComputedStyle(node);chain.push(style); if(style.backgroundImage!=='none'||style.filter!=='none'||style.mixBlendMode!=='normal')partial=true}
    if(chain.some(style=>Number(style.opacity)===0))continue
    const label={tag:el.tagName,text:(el.textContent||el.value||'').trim().slice(0,50)}
    if(partial||chain.some(style=>Number(style.opacity)!==1)) {unmeasured.push({...label,reason:'image/gradient/filter/opacity compositing'});continue}
    let background=[255,255,255]
    for(const style of chain.reverse()) {const color=rgb(style.backgroundColor);if(color)background=blend(color,background)}
    const color=rgb(s.color)
    if(!color){unmeasured.push({...label,reason:`color ${s.color}`});continue}
    const foreground=blend(color,background)
    const extremes=c=>[0,255].map(g=>c.map(v=>v*(1-grain)+g*grain))
    const minimum=Math.min(...extremes(foreground).flatMap(f=>extremes(background).map(b=>contrast(f,b))))
    rows.push({...label,fg:s.color,bg:background,ratio:minimum,pass:minimum>=4.5})
  }
  return { rows,unmeasured,hits,blocked:hits.filter(h=>!h.points.every(Boolean)),bg:getComputedStyle(document.body).backgroundColor,scheme:document.documentElement.dataset.paperScheme,overflow:document.documentElement.scrollWidth>innerWidth+1 }
}
const metrics = {pngSamples,oppositeFrame,scanPage,ratio}
export default metrics
