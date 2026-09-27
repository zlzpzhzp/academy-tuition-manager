'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** 당김 거리 1프레임 알림. `dragging`=손가락이 화면에 있음(전환 없이 따라가야 함). */
export interface PullFrame {
  /** 이 훅이 리스너를 단 컨테이너 */
  container: HTMLDivElement
  /** 손가락이 닿아 있는 동안 true — 이때는 전환 없이 즉시 따라간다 */
  dragging: boolean
  /** 새로고침 진행 중(유지 거리로 멈춰 있음) */
  refreshing: boolean
}

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
  /**
   * 당김 거리 표시 콜백 — rAF 안에서 **최신 거리 1회**로 불린다.
   * 인디케이터·컨테이너의 transform/opacity 를 여기서 DOM 에 직접 쓴다(React 상태 아님).
   */
  onPull?: (distance: number, frame: PullFrame) => void
}

interface Result {
  /** 컨테이너 ref. fixed/scrollable 영역에 attach */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 당기는 중(거리 > 0) 여부 — 경계를 넘을 때만 바뀐다. */
  isPulling: boolean
  /** 새로고침 진행 중 여부. */
  isRefreshing: boolean
  /** threshold 도달 여부 — 경계를 넘을 때만 바뀐다. */
  willTrigger: boolean
}

/**
 * iOS 스타일 pull-to-refresh.
 *
 * 2026-09-26 동작품질(C07): touchmove 마다 setState 로 페이지 전체를 다시 그리던 구조를 버렸다.
 * 거리는 ref 에만 두고 rAF 에서 `onPull(distance)` 으로 넘긴다 — 호출부가 transform/opacity 를 직접 쓴다.
 * React 상태는 경계(당김 시작/끝, 임계 넘김, 새로고침 시작/끝)에서만 바뀐다. 임계·유지 거리·
 * 새로고침 흐름(임계 이상에서 손을 떼면 onRefresh → 0.5초 유지 → 닫힘)은 예전과 같다.
 *
 * 다음 페이지에서 사용 중: billing, dashboard, payments.
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 60,
  maxDistance = 120,
  refreshingHoldDistance = 40,
  disabled = false,
  onPull,
}: Options): Result {
  const [isPulling, setIsPulling] = useState(false)
  const [willTrigger, setWillTrigger] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 이벤트 리스너는 한 번만 붙이고, 바뀌는 값은 ref 로 읽는다(값이 바뀔 때마다 리스너 4개를
  // 떼었다 붙이던 것 제거).
  const latest = useRef({ onRefresh, threshold, maxDistance, refreshingHoldDistance, disabled, onPull })
  useEffect(() => {
    latest.current = { onRefresh, threshold, maxDistance, refreshingHoldDistance, disabled, onPull }
  })

  const pullRef = useRef<{ startY: number; pulling: boolean } | null>(null)
  const distanceRef = useRef(0)
  const refreshingRef = useRef(false)
  const phaseRef = useRef({ pulling: false, armed: false })
  const frameRef = useRef<number | null>(null)
  const framePendingRef = useRef(false)
  const draggingRef = useRef(false)

  const flush = useCallback(() => {
    framePendingRef.current = false
    frameRef.current = null
    const el = containerRef.current
    if (!el) return
    latest.current.onPull?.(distanceRef.current, { container: el, dragging: draggingRef.current, refreshing: refreshingRef.current })
  }, [])

  /** 거리 갱신 — 표시는 다음 프레임에 1회, React 상태는 경계를 넘을 때만. */
  const setDistance = useCallback((distance: number, dragging: boolean) => {
    distanceRef.current = distance
    draggingRef.current = dragging
    if (!framePendingRef.current) {
      framePendingRef.current = true
      const id = requestAnimationFrame(flush)
      if (framePendingRef.current) frameRef.current = id
    }
    const pulling = distance > 0
    const armed = distance >= latest.current.threshold
    if (pulling !== phaseRef.current.pulling) { phaseRef.current.pulling = pulling; setIsPulling(pulling) }
    if (armed !== phaseRef.current.armed) { phaseRef.current.armed = armed; setWillTrigger(armed) }
  }, [flush])

  // 리스너를 단 요소. 컨테이너가 늦게 붙는 화면(로딩 중 조기 반환)이 있어 커밋마다 요소만 확인하고,
  // 같은 요소면 아무것도 하지 않는다.
  const attachedRef = useRef<{ el: HTMLDivElement; detach: () => void } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (attachedRef.current?.el === el) return
    attachedRef.current?.detach()
    attachedRef.current = null
    if (!el) return

    const handleStart = (e: TouchEvent) => {
      if (refreshingRef.current || latest.current.disabled) return
      const scrollTop = window.scrollY || document.documentElement.scrollTop
      if (scrollTop > 0) return
      pullRef.current = { startY: e.touches[0].clientY, pulling: false }
    }

    const handleMove = (e: TouchEvent) => {
      if (!pullRef.current || refreshingRef.current || latest.current.disabled) return
      const dy = e.touches[0].clientY - pullRef.current.startY
      if (dy > 0) {
        pullRef.current.pulling = true
        setDistance(Math.min(latest.current.maxDistance, dy * 0.4), true)
      } else {
        pullRef.current.pulling = false
        setDistance(0, true)
      }
    }

    // 당김 중 터치 취소(전화 수신·시스템 제스처) 시 거리가 안 돌아오던 것 복구용 (2026-08-13 라인리뷰)
    const handleCancel = () => {
      pullRef.current = null
      setDistance(0, false)
    }

    const handleEnd = async () => {
      if (!pullRef.current?.pulling || refreshingRef.current) {
        pullRef.current = null
        return
      }
      pullRef.current = null
      const { threshold: limit, refreshingHoldDistance: hold } = latest.current
      if (distanceRef.current >= limit) {
        refreshingRef.current = true
        setIsRefreshing(true)
        setDistance(hold, false)
        try {
          await latest.current.onRefresh()
        } catch (err) {
          // onRefresh 실패가 unhandled rejection으로 사라지던 것 — 로그로 남긴다 (표시는 호출부 몫)
          console.error('[pullToRefresh] 새로고침 실패:', err)
        } finally {
          // 완료 후 살짝 보여주고 닫기 (UX 안정감)
          await new Promise(r => setTimeout(r, 500))
          refreshingRef.current = false
          setIsRefreshing(false)
        }
      }
      setDistance(0, false)
    }

    el.addEventListener('touchstart', handleStart, { passive: true })
    el.addEventListener('touchmove', handleMove, { passive: true })
    el.addEventListener('touchend', handleEnd)
    el.addEventListener('touchcancel', handleCancel)
    attachedRef.current = {
      el,
      detach: () => {
        el.removeEventListener('touchstart', handleStart)
        el.removeEventListener('touchmove', handleMove)
        el.removeEventListener('touchend', handleEnd)
        el.removeEventListener('touchcancel', handleCancel)
      },
    }
  })

  useEffect(() => () => {
    attachedRef.current?.detach()
    attachedRef.current = null
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    framePendingRef.current = false
  }, [])

  return { containerRef, isPulling, isRefreshing, willTrigger }
}
