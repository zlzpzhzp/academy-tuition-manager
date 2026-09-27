'use client'

/**
 * 매출 추이 라인차트 — 인라인 SVG (2026-09-03)
 *
 * npm 의존성 추가 금지라 차트 라이브러리를 쓰지 않는다. viewBox 고정 + width:100% 라
 * 좌표 계산은 항상 같은 좌표계에서 하고 브라우저가 스케일한다(반응형 계산 불필요 = NaN 여지 없음).
 * 애니메이션은 CSS(globals.css .trend-line/.trend-point) — SSR 인라인 style 함정 회피.
 */

export interface TrendSeries {
  key: string
  label: string
  /** CSS 변수 문자열 (globals.css 에 실재하는 토큰만) */
  color: string
  dashed?: boolean
  values: number[]
}

interface TrendChartProps {
  /** YYYY-MM 오름차순 */
  months: string[]
  series: TrendSeries[]
  /** 선택된 달 인덱스 (탭/클릭). null 이면 선택 없음 */
  activeIndex?: number | null
  onSelect?: (index: number) => void
  /** 진행중(당월) 인덱스 — 점을 비우고 라벨을 붙인다 */
  partialIndex?: number | null
  /** 대시보드 카드용 축약 모드 (축 라벨 최소, 낮은 높이) */
  compact?: boolean
  ariaLabel?: string
}

const VW = 360

/** 축 눈금 상한을 보기 좋은 수(1·2·5 × 10^n)로 올림 */
// 눈금 간격을 1·2·2.5·5×10^k 로 잡고 최댓값을 그 배수로 올린다 — 10,000/6,667/3,333 같은
// 3등분 눈금이 아니라 0/2,500/5,000/7,500/10,000 처럼 읽히는 눈금이 나온다 (2026-09-03 캡처 검수)
function niceStep(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1
  const exp = Math.floor(Math.log10(v))
  const pow = Math.pow(10, exp)
  const norm = v / pow
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  return step * pow
}
function niceScale(maxValue: number, divisions: number): { yMax: number; ticks: number[] } {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return { yMax: 1, ticks: [0, 1] }
  const step = niceStep(maxValue / divisions)
  const count = Math.max(1, Math.ceil(maxValue / step))
  const yMax = count * step
  return { yMax, ticks: Array.from({ length: count + 1 }, (_, i) => i * step) }
}

const monthLabel = (m: string) => `${Number(m.slice(5, 7))}월`

export default function TrendChart({
  months,
  series,
  activeIndex = null,
  onSelect,
  partialIndex = null,
  compact = false,
  ariaLabel,
}: TrendChartProps) {
  const n = months.length
  const VH = compact ? 120 : 200
  const padL = compact ? 6 : 38
  const padR = compact ? 6 : 10
  const padT = compact ? 8 : 14
  const padB = compact ? 18 : 24
  const innerW = VW - padL - padR
  const innerH = VH - padT - padB

  if (n === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-[13px] text-[var(--text-4)]">
        표시할 데이터가 없습니다
      </div>
    )
  }

  const maxValue = Math.max(0, ...series.flatMap(s => s.values.map(v => (Number.isFinite(v) ? v : 0))))
  const { yMax, ticks } = niceScale(maxValue, compact ? 1 : 4)
  const x = (i: number) => (n === 1 ? padL + innerW / 2 : padL + (i * innerW) / (n - 1))
  const y = (v: number) => {
    const safe = Number.isFinite(v) ? v : 0
    return padT + innerH - (Math.max(0, safe) / yMax) * innerH
  }

  const gridValues = compact ? [] : ticks

  // x축 라벨은 좁은 화면에서 겹치므로 개수가 많으면 건너뛰며 표시
  const labelStep = n > 12 ? 3 : n > 8 ? 2 : 1
  const colW = n === 1 ? innerW : innerW / (n - 1)

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      width="100%"
      role="img"
      aria-label={ariaLabel ?? `월별 추이 차트 (${months[0]}~${months[n - 1]})`}
      style={{ display: 'block', overflow: 'visible', touchAction: 'manipulation' }}
    >
      {/* y축 그리드 + 만원 라벨 */}
      {gridValues.map((v, i) => (
        <g key={`g${i}`}>
          <line
            x1={padL} x2={VW - padR} y1={y(v)} y2={y(v)}
            stroke="var(--border)" strokeWidth={1}
          />
          <text
            x={padL - 6} y={y(v) + 3}
            textAnchor="end" fontSize={9} fill="var(--text-4)"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {Math.round(v / 10000).toLocaleString('ko-KR')}
          </text>
        </g>
      ))}

      {/* 선택 컬럼 하이라이트 */}
      {activeIndex != null && activeIndex >= 0 && activeIndex < n && (
        <rect
          x={x(activeIndex) - colW / 2}
          y={padT}
          width={colW}
          height={innerH}
          fill="var(--bg-card-hover)"
          opacity={0.75}
          rx={6}
          style={{ transition: 'x 0.2s cubic-bezier(0.22,1,0.36,1)' }}
        />
      )}

      {/* 라인 — 실선은 드로우인(stroke-dashoffset), 점선은 dash 패턴이라 드로우인 대신 페이드인 */}
      {series.map(s => {
        const d = s.values
          .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`)
          .join(' ')
        if (s.dashed) {
          return (
            <path
              key={s.key}
              d={d}
              className="trend-point"
              fill="none"
              stroke={s.color}
              strokeWidth={compact ? 2 : 2.2}
              strokeDasharray="5 4"
              strokeLinecap="round"
              opacity={0.9}
            />
          )
        }
        return (
          <path
            key={s.key}
            d={d}
            pathLength={1}
            className="trend-line"
            fill="none"
            stroke={s.color}
            strokeWidth={compact ? 2 : 2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}

      {/* 점 */}
      {series.map(s =>
        s.values.map((v, i) => {
          const isPartial = partialIndex === i
          const isActive = activeIndex === i
          return (
            <circle
              key={`${s.key}-${i}`}
              className="trend-point"
              cx={x(i)}
              cy={y(v)}
              r={isActive ? 4.2 : compact ? 2.4 : 3.2}
              fill={isPartial ? 'var(--bg-card)' : s.color}
              stroke={s.color}
              strokeWidth={isPartial ? 1.8 : isActive ? 1.6 : 0}
              opacity={isPartial ? 0.9 : 1}
              style={{ transition: 'r 0.18s ease' }}
            />
          )
        }),
      )}

      {/* x축 월 라벨 */}
      {months.map((m, i) => {
        if (i % labelStep !== 0 && i !== n - 1) return null
        return (
          <text
            key={`x${m}`}
            x={x(i)}
            y={VH - 6}
            textAnchor="middle"
            fontSize={compact ? 9 : 10}
            fontWeight={activeIndex === i ? 700 : 500}
            fill={activeIndex === i ? 'var(--text-1)' : 'var(--text-4)'}
          >
            {monthLabel(m)}
          </text>
        )
      })}

      {/* 진행중(당월) 표식 */}
      {!compact && partialIndex != null && partialIndex >= 0 && partialIndex < n && (
        <text
          x={Math.min(x(partialIndex), VW - padR)}
          y={padT - 4}
          textAnchor="end"
          fontSize={9}
          fontWeight={700}
          fill="var(--scheduled-text)"
        >
          진행중
        </text>
      )}

      {/* 탭/호버 히트영역 — 손가락으로 눌러야 하므로 컬럼 전체를 잡는다 */}
      {onSelect && months.map((m, i) => (
        <rect
          key={`hit${m}`}
          x={x(i) - colW / 2}
          y={0}
          width={colW}
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
