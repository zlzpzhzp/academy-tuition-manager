'use client'

/**
 * 월별 누적 막대 — 선생님별/과목별/결제수단별 분해용 인라인 SVG (2026-09-03).
 * TrendChart 와 같은 좌표계 규칙(viewBox 고정 + width:100%).
 */

export interface StackSeries {
  key: string
  label: string
  color: string
  /** months 와 같은 길이 */
  values: number[]
}

interface StackedBarsProps {
  months: string[]
  series: StackSeries[]
  activeIndex?: number | null
  onSelect?: (index: number) => void
  height?: number
}

const VW = 360

function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1
  const exp = Math.floor(Math.log10(v))
  const pow = Math.pow(10, exp)
  const norm = v / pow
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return step * pow
}

const monthLabel = (m: string) => `${Number(m.slice(5, 7))}월`

export default function StackedBars({
  months,
  series,
  activeIndex = null,
  onSelect,
  height = 190,
}: StackedBarsProps) {
  const n = months.length
  const VH = height
  const padL = 38
  const padR = 10
  const padT = 12
  const padB = 24
  const innerW = VW - padL - padR
  const innerH = VH - padT - padB

  if (n === 0 || series.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-[13px] text-[var(--text-4)]">
        표시할 데이터가 없습니다
      </div>
    )
  }

  const totals = months.map((_, i) => series.reduce((sum, s) => sum + (Number(s.values[i]) || 0), 0))
  const yMax = niceCeil(Math.max(0, ...totals))
  const slot = innerW / n
  const barW = Math.min(26, slot * 0.62)
  const cx = (i: number) => padL + slot * i + slot / 2
  const hOf = (v: number) => (Math.max(0, Number(v) || 0) / yMax) * innerH

  const gridValues = [0, yMax / 2, yMax]
  const labelStep = n > 12 ? 3 : n > 8 ? 2 : 1

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      width="100%"
      role="img"
      aria-label={`월별 누적 막대 (${months[0]}~${months[n - 1]})`}
      style={{ display: 'block', overflow: 'visible', touchAction: 'manipulation' }}
    >
      {gridValues.map((v, i) => (
        <g key={`g${i}`}>
          <line x1={padL} x2={VW - padR} y1={padT + innerH - hOf(v)} y2={padT + innerH - hOf(v)} stroke="var(--border)" strokeWidth={1} />
          <text
            x={padL - 6} y={padT + innerH - hOf(v) + 3}
            textAnchor="end" fontSize={9} fill="var(--text-4)"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {Math.round(v / 10000).toLocaleString('ko-KR')}
          </text>
        </g>
      ))}

      {months.map((m, i) => {
        let acc = 0
        const dim = activeIndex != null && activeIndex !== i
        return (
          <g key={m} opacity={dim ? 0.85 : 1} style={{ transition: 'opacity 0.2s ease' }}>
            {series.map((s, si) => {
              const h = hOf(s.values[i] ?? 0)
              if (h <= 0) return null
              const yTop = padT + innerH - acc - h
              acc += h
              return (
                <rect
                  key={s.key}
                  className="trend-bar"
                  x={cx(i) - barW / 2}
                  y={yTop}
                  width={barW}
                  height={h}
                  fill={s.color}
                  stroke="var(--bg-card)"
                  strokeWidth={1}
                  rx={2}
                  style={{ animationDelay: `${i < 8 ? i * 0.04 + Math.min(si, 7) * 0.02 : 0}s` }}
                />
              )
            })}
          </g>
        )
      })}

      {months.map((m, i) => {
        if (i % labelStep !== 0 && i !== n - 1) return null
        return (
          <text
            key={`x${m}`}
            x={cx(i)}
            y={VH - 6}
            textAnchor="middle"
            fontSize={10}
            fontWeight={activeIndex === i ? 700 : 500}
            fill={activeIndex === i ? 'var(--text-1)' : 'var(--text-4)'}
          >
            {monthLabel(m)}
          </text>
        )
      })}

      {onSelect && months.map((m, i) => (
        <rect
          key={`hit${m}`}
          x={padL + slot * i}
          y={0}
          width={slot}
          height={VH}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onClick={() => onSelect(i)}
          onMouseEnter={() => onSelect(i)}
        />
      ))}
    </svg>
  )
}
