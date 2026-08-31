'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  /** 새로고침 트리거 — 보통 SWR mutate 또는 fetcher 호출. */
  onRefresh: () => Promise<unknown>
  /** 트리거되는 거리(px). 기본 60. */
  threshold?: number
  /** 최대 당김 거리(px). 기본 120. */
  maxDistance?: number
  /** 새로고침 중 유지 거리(px). 기본 40. */
  refreshingHoldDistance?: number
  /** 비활성화 (예: 로딩 중) */
  disabled?: boolean
}

interface Result {
  /** 컨테이너 ref. fixed/scrollable 영역에 attach */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 현재 당김 거리. 인디케이터 표시용. */
  pullDistance: number
  /** 새로고침 진행 중 여부. */
  isRefreshing: boolean
  /** threshold 도달 여부. 인디케이터 색상 변경 등에 활용. */
  willTrigger: boolean
}

/**
 * iOS 스타일 pull-to-refresh.
 *
 * 사용:
 * const { containerRef, pullDistance, isRefreshing } = usePullToRefresh({ onRefresh: () => mutate() })
 * <div ref={containerRef} style={{ transform: `translateY(${pullDistance}px)` }}>
 *   {isRefreshing && <Spinner />}
 *   ...
 * </div>
 *
 * 다음 페이지에서 사용 중: billing(원본 추출), dashboard, payments, attendance.
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 60,
  maxDistance = 120,
  refreshingHoldDistance = 40,
  disabled = false,
}: Options): Result {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const pullRef = useRef<{ startY: number; pulling: boolean } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleStart = useCallback((e: TouchEvent) => {
    if (isRefreshing || disabled) return
    const scrollTop = window.scrollY || document.documentElement.scrollTop
    if (scrollTop > 0) return
    pullRef.current = { startY: e.touches[0].clientY, pulling: false }
  }, [isRefreshing, disabled])

  const handleMove = useCallback((e: TouchEvent) => {
    if (!pullRef.current || isRefreshing || disabled) return
    const dy = e.touches[0].clientY - pullRef.current.startY
    if (dy > 0) {
      pullRef.current.pulling = true
      const distance = Math.min(maxDistance, dy * 0.4)
      setPullDistance(distance)
    } else {
      pullRef.current.pulling = false
      setPullDistance(0)
    }
  }, [isRefreshing, disabled, maxDistance])

  // 당김 중 터치 취소(전화 수신·시스템 제스처) 시 pullDistance가 안 돌아오던 것 복구용 (2026-08-13 라인리뷰)
  const handleCancel = useCallback(() => {
    pullRef.current = null
    setPullDistance(0)
  }, [])

  const handleEnd = useCallback(async () => {
    if (!pullRef.current?.pulling || isRefreshing) {
      pullRef.current = null
      return
    }
    pullRef.current = null
    if (pullDistance >= threshold) {
      setIsRefreshing(true)
      setPullDistance(refreshingHoldDistance)
      try {
        await onRefresh()
      } catch (e) {
        // onRefresh 실패가 unhandled rejection으로 사라지던 것 — 로그로 남긴다 (표시는 호출부 몫)
        console.error('[pullToRefresh] 새로고침 실패:', e)
      } finally {
        // 완료 후 살짝 보여주고 닫기 (UX 안정감)
        await new Promise(r => setTimeout(r, 500))
        setIsRefreshing(false)
      }
    }
    setPullDistance(0)
  }, [pullDistance, isRefreshing, threshold, refreshingHoldDistance, onRefresh])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('touchstart', handleStart, { passive: true })
    el.addEventListener('touchmove', handleMove, { passive: true })
    el.addEventListener('touchend', handleEnd)
    el.addEventListener('touchcancel', handleCancel)
    return () => {
      el.removeEventListener('touchstart', handleStart)
      el.removeEventListener('touchmove', handleMove)
      el.removeEventListener('touchend', handleEnd)
      el.removeEventListener('touchcancel', handleCancel)
    }
  }, [handleStart, handleMove, handleEnd, handleCancel])

  return {
    containerRef,
    pullDistance,
    isRefreshing,
    willTrigger: pullDistance >= threshold,
  }
}
