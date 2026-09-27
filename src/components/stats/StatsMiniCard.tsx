'use client'

/**
 * 대시보드용 '월별 매출 추이' 미니 카드 (2026-09-03).
 * 자기 데이터는 자기가 불러온다 — 대시보드 본체 skeleton(loading)에는 절대 섞지 않는다.
 * (섞으면 통계 한 방 때문에 대시보드 전체가 늦게 뜬다. 카드 안에서만 스켈레톤)
 */

import Link from 'next/link'
import useSWR from 'swr'
import { TrendingUp } from 'lucide-react'
import { swrFetcher, getCurrentMonth } from '@/lib/utils'
import { formatNumber } from '@/lib/format'
import { addMonths, type MonthStat } from '@/lib/monthlyStats'
import TrendChart from '@/components/stats/TrendChart'

interface StatsResponse {
  currentMonth: string
  months: MonthStat[]
}

const SPAN = 6

export default function StatsMiniCard() {
  const to = getCurrentMonth()
  const from = addMonths(to, -(SPAN - 1))
  const { data, error } = useSWR<StatsResponse>(`/api/stats/monthly?from=${from}&to=${to}`, swrFetcher)

  const months = data?.months ?? []
  const n = months.length
  // rule.swr_loading_guard — data 도착 전엔 '데이터 없음'을 그리지 않는다
  const loading = data === undefined && !error

  const partialIndex = months.findIndex(m => m.month === (data?.currentMonth ?? to))
  // 이번 달은 진행중(부분 수납)이라 지난달과 비교하면 항상 '↓ 수천만'으로 보인다 — 증감은
  // 마지막 '완결된 달' 끼리 비교하고, 진행중 달은 별도 한 줄로 보여준다 (2026-09-03 캡처 검수)
  const lastIsPartial = n > 0 && partialIndex === n - 1
  const partial = lastIsPartial ? months[n - 1] : null
  const completeEnd = lastIsPartial ? n - 2 : n - 1
  const last = completeEnd >= 0 ? months[completeEnd] : null
  const prev = completeEnd >= 1 ? months[completeEnd - 1] : null
  const deltaMan = last && prev ? Math.round((last.paid - prev.paid) / 10000) : 0
  const monthLabel = (m: string) => `${Number(m.slice(5, 7))}월`

  return (
    <Link
      href="/stats"
      className="card p-5 block hover:bg-[var(--bg-card-hover)] transition-colors"
      aria-label="월별 매출 추이 자세히 보기"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4 text-[var(--blue)]" />
          <h2 className="text-[17px] font-bold text-[var(--text-1)]">월별 매출 추이</h2>
        </div>
        {!loading && !error && last && (
          <span className="text-[12px] text-[var(--text-4)] tabular-nums">최근 {n}개월</span>
        )}
      </div>

      {loading && (
        <div className="space-y-2">
          <div className="skeleton-shimmer h-[120px] rounded-xl" />
          <div className="skeleton-shimmer h-3 w-32 rounded-md" />
        </div>
      )}

      {!loading && error && (
        <p className="text-[13px] text-[var(--text-4)] py-6 text-center">추이를 불러오지 못했습니다</p>
      )}

      {!loading && !error && n > 0 && (
        <>
          <TrendChart
            compact
            months={months.map(m => m.month)}
            series={[{ key: 'paid', label: '수납', color: 'var(--blue)', values: months.map(m => m.paid) }]}
            partialIndex={partialIndex >= 0 ? partialIndex : null}
            ariaLabel="최근 6개월 수납액 추이"
          />
          {last && (
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-[13px] text-[var(--text-4)]">{monthLabel(last.month)} 수납</span>
              <span className="text-[15px] font-bold text-[var(--text-1)] tabular-nums">
                {formatNumber(Math.round(last.paid / 10000))}만원
              </span>
              {prev && deltaMan !== 0 && (
                <span className={`text-[11px] font-bold tabular-nums ${deltaMan > 0 ? 'text-[var(--paid-text)]' : 'text-[var(--unpaid-text)]'}`}>
                  {deltaMan > 0 ? '↑' : '↓'} {Math.abs(deltaMan).toLocaleString('ko-KR')}만
                  <span className="font-medium text-[var(--text-4)] ml-1">{monthLabel(prev.month)} 대비</span>
                </span>
              )}
            </div>
          )}
          {partial && (
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-[12px] text-[var(--text-4)]">{monthLabel(partial.month)} 진행중</span>
              <span className="text-[13px] font-semibold text-[var(--text-2)] tabular-nums">
                {formatNumber(Math.round(partial.paid / 10000))}만원
              </span>
            </div>
          )}
        </>
      )}

      {!loading && !error && n === 0 && (
        <p className="text-[13px] text-[var(--text-4)] py-6 text-center">표시할 데이터가 없습니다</p>
      )}
    </Link>
  )
}
