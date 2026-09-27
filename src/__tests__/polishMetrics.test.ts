import { describe, it, expect } from 'vitest'
import metrics from '../../tests/e2e/polish-metrics.cjs'
import catalog from '../../tests/e2e/polish-cases.cjs'

const data = (radius: string[], bottom = 600, top = 200) => ({ radius, rect:{top,bottom}, viewport:{height:915}, leaks:[] })
describe('모서리·프레임 검출기의 양성/음성 대조 (브라우저 결함 주입은 별도)', () => {
  it('중앙창의 한쪽 radius 누락을 검출하고 정상 네 모서리는 허용', () => {
    expect(metrics.cornerFailures(data(['20px','20px','20px','20px']),'center')).toEqual([])
    expect(metrics.cornerFailures(data(['0px','0px','20px','20px']),'center').length).toBeGreaterThan(0)
    expect(metrics.cornerFailures({ ...data(['20px','20px','20px','20px']), leaks:[{corner:0}] },'center').length).toBeGreaterThan(0)
  })
  it('부착/부유/확장 시트를 구별하고 투명 래퍼에 카드 규칙을 강제하지 않는다', () => {
    expect(metrics.cornerFailures(data(['16px','16px','0px','0px'],915),'sheet')).toEqual([])
    expect(metrics.cornerFailures(data(['16px','16px','0px','0px'],900),'sheet').length).toBeGreaterThan(0)
    expect(metrics.cornerFailures(data(['0px','0px','0px','0px'],915,0),'sheet')).toEqual([])
    expect(metrics.cornerFailures(data(['0px','0px','0px','0px']),'transparent')).toEqual([])
  })
  it('활성 구간 사이 대기 시간을 긴 프레임으로 합산하거나 표본으로 채우지 않는다', () => {
    const result = metrics.frameMetrics([0,16.7,33.4,1000,1016.7,1066.7], [[0,34],[1000,1070]])
    expect(result.samples).toBe(4)
    expect(result.p50).toBeCloseTo(16.7)
    expect(result.p95).toBeCloseTo(50)
    expect(result.longRatio).toBe(.25)
  })
  it('빈 표본과 전체 미검증 표를 PASS로 세지 않는다', () => {
    expect(metrics.frameMetrics([]).p95).toBeNull()
    const matrix = catalog.pendingMatrix()
    expect(matrix.length).toBeGreaterThan(200)
    expect(matrix.every(row => row.before.status==='미검증' && row.after.status==='미검증')).toBe(true)
    expect(matrix.every(row => row.after.radius.every(value => value===null))).toBe(true)
  })
})
