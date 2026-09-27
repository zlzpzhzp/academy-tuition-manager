'use client'

import { useCallback, useRef } from 'react'
import type { PullFrame } from '@/lib/usePullToRefresh'

/** 컨테이너가 쉬고 있을 때 돌아가는 곡선 — 예전 높이 스프링(300/30)과 비슷한 체감 */
export const PULL_RELEASE_TRANSITION = 'transform 0.25s cubic-bezier(0.22,1,0.36,1)'

/**
 * 당겨서 새로고침의 **표시 전용** 부분 (2026-09-26 동작품질 C07).
 *
 * 예전(납부·결제선생)에는 인디케이터를 `height: pullDistance` 로 키워 아래 내용을 문서 흐름에서
 * 밀어냈다 — touchmove 마다 페이지 전체 재렌더 + 레이아웃. 지금은 **보이는 결과가 같도록**
 * 컨테이너를 `translateY(거리)` 로 내리고, 그렇게 생긴 위쪽 틈 한가운데에 아이콘을 둔다.
 * 거리·회전·크기·투명도는 rAF 안에서 DOM 에 직접 쓴다(React 커밋 없음).
 * 쉴 때 컨테이너 transform 은 비운다('') — 안쪽 position:fixed 요소(다중선택 툴바 등)의
 * 기준 상자가 바뀌지 않게.
 */
export function usePullRefreshIndicator(threshold: number) {
  const indicatorRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef<HTMLDivElement>(null)
  const rotateRef = useRef<HTMLDivElement>(null)

  const onPull = useCallback((distance: number, { container, dragging }: PullFrame) => {
    container.style.transition = dragging ? 'none' : PULL_RELEASE_TRANSITION
    container.style.transform = distance > 0 ? `translateY(${distance}px)` : ''
    const indicator = indicatorRef.current
    if (indicator) {
      indicator.style.transition = dragging ? 'none' : `${PULL_RELEASE_TRANSITION}, opacity 0.2s ease`
      // 컨테이너가 distance 만큼 내려가 생긴 틈의 한가운데(아이콘 24px 의 중심)
      indicator.style.transform = `translateY(${-distance / 2 - 12}px)`
      indicator.style.opacity = distance > 0 ? '1' : '0'
    }
    if (scaleRef.current) scaleRef.current.style.transform = `scale(${distance >= threshold ? 1.15 : 0.9})`
    if (rotateRef.current) rotateRef.current.style.transform = `rotate(${(distance / threshold) * 360}deg)`
  }, [threshold])

  return { onPull, indicatorRef, scaleRef, rotateRef }
}

/** 컨테이너 맨 위에 두는 0 높이 인디케이터. 레이아웃을 차지하지 않는다. */
export function PullRefreshIndicator({ indicatorRef, scaleRef, rotateRef, refreshing }: {
  indicatorRef: React.RefObject<HTMLDivElement | null>
  scaleRef: React.RefObject<HTMLDivElement | null>
  rotateRef: React.RefObject<HTMLDivElement | null>
  refreshing: boolean
}) {
  return (
    <div aria-hidden className="relative h-0 pointer-events-none">
      <div
        ref={indicatorRef}
        className="absolute left-1/2 top-0 -ml-3 w-6 h-6 flex items-center justify-center"
        style={{ opacity: 0, transform: 'translateY(-12px)' }}
      >
        {/* 크기(임계 넘김)는 짧게 전환, 회전은 손가락을 그대로 따른다 */}
        <div ref={scaleRef} style={{ transform: 'scale(0.9)', transition: 'transform 0.2s cubic-bezier(0.22,1,0.36,1)' }}>
          <div ref={rotateRef}>
            <div className={refreshing ? 'animate-spin' : undefined} style={refreshing ? { animationDuration: '0.8s' } : undefined}>
              <svg className="w-6 h-6 text-[var(--text-4)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
