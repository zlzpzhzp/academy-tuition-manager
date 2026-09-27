function frameMetrics(times, activeWindows) {
  const intervals = times.slice(1).flatMap((time, i) => {
    if (activeWindows && !activeWindows.some(([start,end]) => times[i]>=start && time<=end)) return []
    return time>times[i] ? [time-times[i]] : []
  })
  const sorted = [...intervals].sort((a, b) => a - b)
  const percentile = p => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? null
  return { samples: intervals.length, p50: percentile(.5), p95: percentile(.95), longRatio: intervals.length ? intervals.filter(n => n > 33.4).length / intervals.length : null, intervals }
}
function cornerFailures(data, rule) {
  if (['transparent','fullscreen'].includes(rule)) return []
  const r = data.radius.map(Number.parseFloat)
  if (r.length!==4 || r.some(value => !Number.isFinite(value))) return ['computed radius 미확보']
  const attached = ['sheet','attached'].includes(rule) && Math.abs(data.rect.bottom - data.viewport.height) <= 1
  const full = rule === 'sheet' && data.rect.top <= 1 && attached
  const expected = full ? [0,0,0,0] : attached ? [r[0],r[0],0,0] : Array(4).fill(r[0])
  const failures = []
  if (!full && !(r[0] > 0)) failures.push('표시 면의 상단 radius 없음')
  if (r.some((v, i) => Math.abs(v - expected[i]) > .6)) failures.push(`모서리 불일치: ${r.join('/')}`)
  if (data.leaks.length) failures.push(`곡률 밖으로 자식 배경/히트영역 돌출 ${data.leaks.length}점`)
  return failures
}
module.exports = { frameMetrics, cornerFailures }
