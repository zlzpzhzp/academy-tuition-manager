'use client'

/**
 * 매출 추이 (/stats) — 2026-09-03 운영자님 지시
 *
 * 읽기 전용 화면. 데이터는 /api/stats/monthly 하나만 본다(계산은 서버 순수함수).
 * 🔴 귀속 주의: 학생-반 이력 테이블이 없어 선생님별/과목별은 **현재 반** 기준으로 과거 달을
 *    귀속한다. 반을 옮긴 학생의 과거 매출은 지금 반 쪽에 잡힌다 — 화면에도 그대로 밝힌다.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ChevronLeft, Info } from 'lucide-react'
import { swrFetcher, getCurrentMonth, formatMonth } from '@/lib/utils'
import { formatWon, formatNumber } from '@/lib/format'
import { addMonths, type MonthStat } from '@/lib/monthlyStats'
import { PAYMENT_METHOD_LABELS } from '@/types'
import { FadeInUp, TButton } from '@/components/motion'
import TrendChart, { type TrendSeries } from '@/components/stats/TrendChart'
import StackedBars, { type StackSeries } from '@/components/stats/StackedBars'
import { colorAt } from '@/components/stats/palette'

interface StatsResponse {
  from: string
  to: string
  currentMonth: string
  months: MonthStat[]
}

/** 운영 데이터 시작월 — '전체' 범위의 하한 (2026-03 이전 데이터 없음) */
const DATA_START_MONTH = '2026-03'

type RangeKey = '6' | '12' | 'all'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: '6', label: '6개월' },
  { key: '12', label: '12개월' },
  { key: 'all', label: '전체' },
]

type BreakdownKey = 'teacher' | 'subject' | 'method'
const BREAKDOWNS: { key: BreakdownKey; label: string }[] = [
  { key: 'teacher', label: '선생님별' },
  { key: 'subject', label: '과목별' },
  { key: 'method', label: '결제수단별' },
]

/** 범례가 길어지면 못 읽으니 상위 N개 + '기타'로 접는다 */
const MAX_BREAKDOWN_SERIES = 6
const OTHERS_LABEL = '기타'

const shortMonth = (m: string) => `${Number(m.slice(5, 7))}월`
const man = (v: number) => Math.round(v / 10000)

function Segmented<T extends string>({
  options, value, onChange, ariaLabel,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex gap-1 p-1 rounded-xl bg-[var(--bg-card-hover)]">
      {options.map(o => (
        <TButton
          key={o.key}
          role="tab"
          aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
          className={`flex-1 px-3 py-1.5 rounded-lg text-[13px] font-bold transition-colors ${
            value === o.key
              ? 'bg-[var(--bg-elevated)] text-[var(--text-1)]'
              : 'text-[var(--text-4)] hover:text-[var(--text-2)]'
          }`}
        >
          {o.label}
        </TButton>
      ))}
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div className="space-y-4">
      <div className="skeleton-shimmer h-10 rounded-xl" />
      <div className="card p-5 space-y-3">
        <div className="skeleton-shimmer h-4 w-24 rounded-lg" />
        <div className="skeleton-shimmer h-[200px] rounded-xl" />
        <div className="skeleton-shimmer h-16 rounded-xl" />
      </div>
      <div className="card p-5 space-y-3">
        <div className="skeleton-shimmer h-4 w-20 rounded-lg" />
        <div className="skeleton-shimmer h-[190px] rounded-xl" />
      </div>
    </div>
  )
}

export default function StatsPage() {
  const [range, setRange] = useState<RangeKey>('12')
  const [breakdown, setBreakdown] = useState<BreakdownKey>('teacher')
  const [selected, setSelected] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())

  const currentMonth = getCurrentMonth()
  // 데이터 시작(2026-03) 이전 달은 전부 0이라 선이 바닥에서 솟는 모양이 된다 — 시작월로 잘라낸다 (2026-09-03 캡처 검수)
  const rawFrom = range === 'all' ? DATA_START_MONTH : addMonths(currentMonth, -(Number(range) - 1))
  const from = rawFrom < DATA_START_MONTH ? DATA_START_MONTH : rawFrom

  const { data, error, isLoading, mutate } = useSWR<StatsResponse>(
    `/api/stats/monthly?from=${from}&to=${currentMonth}`,
    swrFetcher,
  )

  // rule.swr_loading_guard — data 가 undefined 인 동안은 빈 상태('데이터 없음')를 그리지 않는다
  const loading = isLoading || (data === undefined && !error)
  const months = useMemo(() => data?.months ?? [], [data])
  const n = months.length
  const partialIndex = useMemo(
    () => months.findIndex(m => m.month === (data?.currentMonth ?? currentMonth)),
    [months, data?.currentMonth, currentMonth],
  )
  const activeIndex = n === 0 ? 0 : Math.min(selected ?? n - 1, n - 1)
  const activeMonth: MonthStat | undefined = months[activeIndex]

  const toggleSeries = (key: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const trendDefs: { key: string; label: string; color: string; dashed?: boolean; pick: (m: MonthStat) => number }[] = [
    { key: 'paid', label: '수납', color: 'var(--blue)', pick: m => m.paid },
    { key: 'fee', label: '예정', color: 'var(--text-4)', dashed: true, pick: m => m.fee },
    { key: 'special', label: '특강', color: 'var(--orange)', pick: m => m.special },
  ]
  const trendSeries: TrendSeries[] = trendDefs
    .filter(d => !hidden.has(d.key))
    .map(d => ({ key: d.key, label: d.label, color: d.color, dashed: d.dashed, values: months.map(d.pick) }))

  /** 분해 시리즈 — 전체 기간 합계 상위 N개 + 기타 */
  const stackSeries: StackSeries[] = useMemo(() => {
    if (n === 0) return []
    const totals = new Map<string, { label: string; total: number }>()
    const valueOf = new Map<string, number[]>()
    const bump = (key: string, label: string, i: number, v: number) => {
      if (!valueOf.has(key)) valueOf.set(key, new Array(n).fill(0))
      valueOf.get(key)![i] += v
      const t = totals.get(key) ?? { label, total: 0 }
      t.total += v
      t.label = label
      totals.set(key, t)
    }
    months.forEach((m, i) => {
      if (breakdown === 'teacher') {
        for (const t of m.byTeacher) bump(t.teacher_id ?? `none:${t.name}`, t.name, i, t.paid)
      } else if (breakdown === 'subject') {
        for (const s of m.bySubject) bump(s.subject, s.subject, i, s.paid)
      } else {
        for (const [method, amount] of Object.entries(m.byMethod)) {
          bump(method, PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS] ?? method, i, amount)
        }
      }
    })
    const ranked = [...totals.entries()]
      .sort((a, b) => b[1].total - a[1].total || a[1].label.localeCompare(b[1].label))
      .filter(([, v]) => v.total > 0)
    const head = ranked.slice(0, MAX_BREAKDOWN_SERIES)
    const tail = ranked.slice(MAX_BREAKDOWN_SERIES)
    const out: StackSeries[] = head.map(([key, v], i) => ({
      key,
      label: v.label,
      color: colorAt(i),
      values: valueOf.get(key)!,
    }))
    if (tail.length > 0) {
      const merged = new Array(n).fill(0)
      for (const [key] of tail) valueOf.get(key)!.forEach((v, i) => { merged[i] += v })
      out.push({ key: '__others__', label: OTHERS_LABEL, color: colorAt(head.length), values: merged })
    }
    return out
  }, [months, breakdown, n])

  const totalPaid = months.reduce((s, m) => s + m.paid, 0)
  const totalSpecial = months.reduce((s, m) => s + m.special, 0)

  return (
    <div className="space-y-4">
      <FadeInUp>
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            대시보드
          </Link>
          <h1 className="text-[15px] font-bold text-[var(--text-1)]">매출 추이</h1>
          <span className="w-12" />
        </div>
      </FadeInUp>

      <FadeInUp delay={0.04}>
        <Segmented options={RANGES} value={range} onChange={v => { setRange(v); setSelected(null) }} ariaLabel="기간 선택" />
      </FadeInUp>

      {error && (
        <div className="card p-5 text-center space-y-3">
          <p className="text-[14px] text-[var(--unpaid-text)] font-bold">매출 데이터를 불러오지 못했습니다</p>
          <p className="text-[12px] text-[var(--text-4)] break-all">{String((error as Error)?.message ?? error)}</p>
          <TButton onClick={() => mutate()} className="btn btn-primary mx-auto">다시 시도</TButton>
        </div>
      )}

      {!error && loading && <ChartSkeleton />}

      {!error && !loading && n === 0 && (
        <div className="card p-8 text-center text-[13px] text-[var(--text-4)]">표시할 데이터가 없습니다</div>
      )}

      {!error && !loading && n > 0 && (
        <>
          {/* ── 추이 차트 ── */}
          <FadeInUp delay={0.08} className="card p-5 space-y-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[17px] font-bold text-[var(--text-1)]">월별 수납</h2>
              <p className="text-[12px] text-[var(--text-4)] tabular-nums">
                기간 합계 {formatNumber(man(totalPaid))}만원
              </p>
            </div>

            {/* 시리즈 토글 */}
            <div className="flex flex-wrap gap-2">
              {trendDefs.map(d => {
                const on = !hidden.has(d.key)
                return (
                  <TButton
                    key={d.key}
                    onClick={() => toggleSeries(d.key)}
                    aria-pressed={on}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-bold transition-colors ${
                      on ? 'bg-[var(--bg-elevated)] text-[var(--text-1)]' : 'bg-[var(--bg-card-hover)] text-[var(--text-4)]'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: on ? d.color : 'var(--text-4)', opacity: on ? 1 : 0.5 }}
                    />
                    {d.label}
                  </TButton>
                )
              })}
            </div>

            <TrendChart
              months={months.map(m => m.month)}
              series={trendSeries}
              activeIndex={activeIndex}
              onSelect={setSelected}
              partialIndex={partialIndex >= 0 ? partialIndex : null}
              ariaLabel={`월별 수납 추이 ${months[0].month}~${months[n - 1].month}`}
            />

            {/* 선택 월 상세 — 폰이라 hover 가 아니라 탭 상태로 그린다 */}
            {activeMonth && (
              <div
                key={activeMonth.month}
                className="animate-fade-in-up rounded-2xl bg-[var(--bg-card-hover)] p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[14px] font-bold text-[var(--text-1)]">{formatMonth(activeMonth.month)}</p>
                  {partialIndex === activeIndex && (
                    <span className="badge badge-scheduled">진행중</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-4)]">수납</span>
                    <span className="font-bold text-[var(--text-1)] tabular-nums">{formatWon(activeMonth.paid)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-4)]">예정</span>
                    <span className="font-bold text-[var(--text-2)] tabular-nums">{formatWon(activeMonth.fee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-4)]">수납률</span>
                    <span className="font-bold text-[var(--text-1)] tabular-nums">
                      {activeMonth.fee > 0 ? Math.round((activeMonth.paid / activeMonth.fee) * 100) : 0}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-4)]">특강</span>
                    <span className="font-bold text-[var(--scheduled-text)] tabular-nums">{formatWon(activeMonth.special)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-4)]">학생수</span>
                    <span className="font-bold text-[var(--text-1)] tabular-nums">
                      {formatNumber(activeMonth.studentCount)}명
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-4)]">납부인원</span>
                    <span className="font-bold text-[var(--text-2)] tabular-nums">
                      {formatNumber(activeMonth.paidCount)}명
                    </span>
                  </div>
                </div>
              </div>
            )}
          </FadeInUp>

          {/* ── 분해 ── */}
          <FadeInUp delay={0.12} className="card p-5 space-y-4">
            <h2 className="text-[17px] font-bold text-[var(--text-1)]">매출 분해</h2>
            <Segmented options={BREAKDOWNS} value={breakdown} onChange={setBreakdown} ariaLabel="분해 기준 선택" />

            <StackedBars
              months={months.map(m => m.month)}
              series={stackSeries}
              activeIndex={activeIndex}
              onSelect={setSelected}
            />

            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {stackSeries.map(s => (
                <span key={s.key} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-2)]">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>

            {breakdown !== 'method' && (
              /* 아이콘+본문은 반드시 2개 플렉스 아이템으로 — 본문을 span 으로 안 감싸면
                 <b> 가 별도 플렉스 아이템이 돼서 문장이 좌우로 쪼개진다(2026-09-03 캡처로 발견) */
              <p className="flex items-start gap-1.5 text-[11px] text-[var(--text-4)] leading-relaxed">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  반 이동 이력이 없어 <b className="font-bold text-[var(--text-3)]">현재 소속 반</b> 기준으로 과거 달을
                  귀속합니다. 반을 옮긴 학생의 과거 매출은 지금 반 쪽에 잡힙니다.
                </span>
              </p>
            )}

            {/* 월 × 항목 표 — 좁은 화면에선 이 안에서만 가로 스크롤 (body 는 절대 안 밀림) */}
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full min-w-max text-[12px] tabular-nums border-collapse">
                <thead>
                  <tr className="text-[var(--text-4)]">
                    <th className="text-left font-medium py-1.5 pr-3 sticky left-0 bg-[var(--bg-card)]">월</th>
                    {stackSeries.map(s => (
                      <th key={s.key} className="text-right font-medium py-1.5 px-2 whitespace-nowrap">{s.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {months.map((m, i) => (
                    <tr
                      key={m.month}
                      onClick={() => setSelected(i)}
                      className={`border-t border-[var(--border)] cursor-pointer ${
                        i === activeIndex ? 'bg-[var(--bg-card-hover)]' : ''
                      }`}
                    >
                      <td className={`text-left py-1.5 pr-3 font-bold whitespace-nowrap sticky left-0 ${
                        i === activeIndex ? 'bg-[var(--bg-card-hover)]' : 'bg-[var(--bg-card)]'
                      } text-[var(--text-2)]`}>
                        {shortMonth(m.month)}
                      </td>
                      {stackSeries.map(s => (
                        <td key={s.key} className="text-right py-1.5 px-2 text-[var(--text-2)] whitespace-nowrap">
                          {s.values[i] > 0 ? `${formatNumber(man(s.values[i]))}만` : '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FadeInUp>

          {/* ── 월별 요약 ── */}
          <FadeInUp delay={0.16} className="card p-5 space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[17px] font-bold text-[var(--text-1)]">월별 요약</h2>
              <p className="text-[12px] text-[var(--text-4)] tabular-nums">특강 합계 {formatNumber(man(totalSpecial))}만원</p>
            </div>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full min-w-max text-[12px] tabular-nums border-collapse">
                <thead>
                  <tr className="text-[var(--text-4)]">
                    <th className="text-left font-medium py-1.5 pr-3">월</th>
                    <th className="text-right font-medium py-1.5 px-2">학생수</th>
                    <th className="text-right font-medium py-1.5 px-2">예정</th>
                    <th className="text-right font-medium py-1.5 px-2">수납</th>
                    <th className="text-right font-medium py-1.5 px-2">수납률</th>
                    <th className="text-right font-medium py-1.5 pl-2">특강</th>
                  </tr>
                </thead>
                <tbody>
                  {/* 최신 월이 위 — 인덱스를 뒤집어 순회한다(months 원본은 오름차순 유지) */}
                  {months.map((_, i) => i).reverse().map(i => {
                    const m = months[i]
                    const prev = i > 0 ? months[i - 1] : null
                    const deltaMan = prev ? Math.round((m.paid - prev.paid) / 10000) : 0
                    const rate = m.fee > 0 ? Math.round((m.paid / m.fee) * 100) : 0
                    return (
                      <tr
                        key={m.month}
                        onClick={() => setSelected(i)}
                        className={`border-t border-[var(--border)] cursor-pointer ${i === activeIndex ? 'bg-[var(--bg-card-hover)]' : ''}`}
                      >
                        <td className="text-left py-2 pr-3 font-bold text-[var(--text-1)] whitespace-nowrap">
                          {shortMonth(m.month)}
                          {partialIndex === i && (
                            <span className="ml-1 text-[10px] font-bold text-[var(--scheduled-text)]">진행중</span>
                          )}
                        </td>
                        <td className="text-right py-2 px-2 text-[var(--text-3)]">{formatNumber(m.studentCount)}</td>
                        <td className="text-right py-2 px-2 text-[var(--text-3)]">{formatNumber(man(m.fee))}만</td>
                        <td className="text-right py-2 px-2 text-[var(--text-1)] font-bold whitespace-nowrap">
                          {formatNumber(man(m.paid))}만
                          {prev && deltaMan !== 0 && (
                            <span className={`ml-1.5 text-[10px] font-bold ${deltaMan > 0 ? 'text-[var(--paid-text)]' : 'text-[var(--unpaid-text)]'}`}>
                              {deltaMan > 0 ? '↑' : '↓'}{Math.abs(deltaMan).toLocaleString('ko-KR')}만
                            </span>
                          )}
                        </td>
                        <td className={`text-right py-2 px-2 font-bold ${rate >= 95 ? 'text-[var(--paid-text)]' : rate >= 70 ? 'text-[var(--text-2)]' : 'text-[var(--unpaid-text)]'}`}>
                          {rate}%
                        </td>
                        <td className="text-right py-2 pl-2 text-[var(--text-3)]">
                          {m.special > 0 ? `${formatNumber(man(m.special))}만` : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-[var(--text-4)] leading-relaxed">
              예정 = 그 달 요금 스냅샷 합계, 수납 = 청구월(billing_month) 기준 납부 합계.
              특강은 특강 직접납부(별도 청구)라 수납에 포함되지 않습니다.
            </p>
          </FadeInUp>
        </>
      )}
    </div>
  )
}
