import { deflateSync } from 'node:zlib'
import { describe, it, expect } from 'vitest'
import metrics from '../../tests/e2e/dark-metrics.mjs'
import motion from '../../tests/e2e/polish-metrics.cjs'

// 합성 PNG 스트림(측정기는 픽셀만 읽음). 저대비·밝은 프레임·활성구간 지연 양성대조.
function png(color: number[]) {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8); return out
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2); ihdr.writeUInt32BE(2,4); ihdr[8]=8; ihdr[9]=2
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,...color,...color,0,...color,...color]))),chunk('IEND',Buffer.alloc(0))])
}
describe('브라우저 재실행 측정기의 양성·음성 대조', () => {
  it('PNG 남색은 정상, 중간 밝은 프레임은 검출', () => {
    const dark = metrics.pngSamples(png([22,26,32])), light = metrics.pngSamples(png([244,241,234]))
    expect(dark).toEqual(Array(4).fill([22,26,32]))
    expect(metrics.oppositeFrame(dark,'dark')).toBe(false)
    expect(metrics.oppositeFrame(light,'dark')).toBe(true)
    expect(metrics.oppositeFrame(light,'light')).toBe(false)
    expect(metrics.oppositeFrame(dark,'light')).toBe(true)
    expect([dark,light,dark].filter(f=>metrics.oppositeFrame(f,'dark'))).toHaveLength(1)
    expect(()=>metrics.pngSamples(Buffer.from('invalid'))).toThrow()
  })
  it('idle 구간으로 전환 지연 p95가 희석되지 않고 계측 누락은 null', () => {
    const idle = Array.from({length:1000},(_,i)=>i*16)
    const active = Array.from({length:9},(_,i)=>16000+i*32)
    expect(motion.frameMetrics([...idle,...active],[[16000,16256]]).p95).toBe(32)
    expect(motion.frameMetrics([],[]).p95).toBeNull()
  })
})
