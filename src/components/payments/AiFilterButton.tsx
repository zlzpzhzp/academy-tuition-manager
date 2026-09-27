'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, ArrowRight } from 'lucide-react'
import { usePaperReducedMotion } from '@/components/paperMotion'

/** 요정 SVG — 날개 달린 실루엣 + 지팡이 */
function FairyIcon({ size = 20, color = 'var(--on-action)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill={color}>
      {/* 머리 */}
      <circle cx="16" cy="7.5" r="3" />
      {/* 몸 */}
      <path d="M16 10.5C16 10.5 13.5 16 12.5 22L16 20L19.5 22C18.5 16 16 10.5 16 10.5Z" />
      {/* 왼쪽 날개 */}
      <path d="M14.5 11C14.5 11 7 7 5.5 10C4 13 9 15 14 13.5Z" opacity="0.6" />
      <path d="M14 14C14 14 7 15 6.5 18C6 21 10 18.5 13.5 15.5Z" opacity="0.45" />
      {/* 오른쪽 날개 */}
      <path d="M17.5 11C17.5 11 25 7 26.5 10C28 13 23 15 18 13.5Z" opacity="0.6" />
      <path d="M18 14C18 14 25 15 25.5 18C26 21 22 18.5 18.5 15.5Z" opacity="0.45" />
      {/* 지팡이 */}
      <line x1="19" y1="12" x2="25" y2="4" stroke={color} strokeWidth="0.8" strokeLinecap="round" />
      {/* 지팡이 끝 별 */}
      <polygon points="25,1.5 25.7,3.3 27.5,3.5 26.1,4.7 26.5,6.5 25,5.5 23.5,6.5 23.9,4.7 22.5,3.5 24.3,3.3" opacity="0.9" />
    </svg>
  )
}

/** 4각 별 모양 좌표 */
function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = []
  for (let i = 0; i < 4; i++) {
    const aOuter = (Math.PI / 2) * i - Math.PI / 2
    const aInner = aOuter + Math.PI / 4
    pts.push(`${cx + Math.cos(aOuter) * outer},${cy + Math.sin(aOuter) * outer}`)
    pts.push(`${cx + Math.cos(aInner) * inner},${cy + Math.sin(aInner) * inner}`)
  }
  return pts.join(' ')
}

interface Props {
  aiFilterIds: Set<string> | null
  aiFilterDesc: string
  onFilter: (query: string) => Promise<void>
  onClear: () => void
  loading: boolean
}

interface Particle {
  x: number; y: number; vx: number; vy: number
  life: number; maxLife: number; size: number
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 입자 1개의 표시 값(모양·투명도)을 SVG 요소에 직접 쓴다. 값 공식은 예전 JSX 렌더와 같다. */
function paintParticle(p: Particle & { el: SVGPolygonElement }) {
  const fadeIn = Math.min(1, (p.maxLife - p.life) / 15)
  const fadeOut = p.life / p.maxLife
  const opacity = fadeIn * fadeOut
  p.el.setAttribute('points', starPoints(p.x, p.y, p.size, p.size * 0.4))
  p.el.style.fill = `rgba(var(--particle),${opacity * 0.5})`
}

export default function AiFilterButton({ aiFilterIds, aiFilterDesc, onFilter, onClear, loading }: Props) {
  const reduced = usePaperReducedMotion()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const [pos, setPos] = useState({ x: 0, y: 0 })
  // 입자는 React 상태가 아니다 — 프레임마다 커밋하던 것(C04)을 ref + SVG 속성 직접 쓰기로 바꿨다.
  const particlesRef = useRef<Array<Particle & { el: SVGPolygonElement }>>([])
  const svgRef = useRef<SVGSVGElement>(null)
  const velRef = useRef({ x: 0, y: 0 })
  const dragging = useRef(false)
  // 렌더에 쓰이는 값(커서 모양·관성 속도)은 ref 가 아니라 상태로 둔다 — 렌더 중 ref 읽기는 갱신이 누락된다.
  const [isDragging, setIsDragging] = useState(false)
  const [speed, setSpeed] = useState(0)
  const lastTouch = useRef({ x: 0, y: 0, t: 0 })
  const prevTouch = useRef({ x: 0, y: 0, t: 0 })
  const posRef = useRef({ x: 0, y: 0 })
  // 드래그 중에만 붙는 창 리스너 — 최신 핸들러를 가리키는 ref 와 떼는 함수
  const dragHandlers = useRef<{ move: (e: TouchEvent | MouseEvent) => void; end: () => void } | null>(null)
  const detachDrag = useRef<(() => void) | null>(null)
  const animFrame = useRef<number>(0)
  const idleFrame = useRef<number>(0)
  const btnRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (reduced) {
      cancelAnimationFrame(animFrame.current)
      velRef.current = { x: 0, y: 0 }
      setSpeed(0)
    }
  }, [reduced])

  const getBottomPad = () => (window.innerWidth < 640 ? 68 : 0)

  useEffect(() => {
    if (initialized.current) return
    const FAIRY = 36
    const GAP = 8
    const fallback = () => {
      // 재정 아이콘 DOM 없으면 우측 상단 기준
      const MAX_W = 896
      const contentRight = Math.min(window.innerWidth, window.innerWidth / 2 + MAX_W / 2)
      return { x: Math.max(12, contentRight - 52), y: 14 }
    }
    const tryPlace = () => {
      const el = document.querySelector('[data-finance-nav]') as HTMLElement | null
      if (!el) return false
      const rect = el.getBoundingClientRect()
      if (rect.width === 0) return false
      // 재정 아이콘 왼쪽에 붙임. fixed라 스크롤과 무관하게 뷰포트에 떠있음
      const x = Math.max(12, rect.left - FAIRY - GAP)
      const y = Math.max(12, rect.top + (rect.height - FAIRY) / 2)
      posRef.current = { x, y }
      setPos({ x, y })
      initialized.current = true
      return true
    }
    if (tryPlace()) return
    // DOM이 아직 없으면 MutationObserver로 추적 + 5초 timeout fallback
    const obs = new MutationObserver(() => {
      if (tryPlace()) obs.disconnect()
    })
    obs.observe(document.body, { childList: true, subtree: true })
    const timeoutId = window.setTimeout(() => {
      obs.disconnect()
      if (!initialized.current) {
        const p = fallback()
        posRef.current = p
        setPos(p)
        initialized.current = true
      }
    }, 5000)
    return () => {
      obs.disconnect()
      clearTimeout(timeoutId)
    }
  }, [])

  // 페이지 숨김 시 정지 / 복귀 시 재시작 토큰 증가 — 정지만 하면 탭 전환 후 스타더스트가
  // 영구 멈춤 (2026-07-10 전수점검 C12)
  const [visibleTick, setVisibleTick] = useState(0)
  useEffect(() => {
    const handler = () => {
      // 숨김·복귀 모두 스타더스트 effect 를 다시 돌린다 — 숨김이면 루프를 끊고 입자를 비운다
      setVisibleTick(t => t + 1)
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  // ─── 흰색 스타더스트 (경량) ───
  // 방출 중(버튼 대기 상태)에만 rAF 루프가 돈다. 열림·필터 적용·동작 줄이기·탭 숨김이면
  // 루프를 끊고(cancelAnimationFrame) 남은 입자를 지운다 — 그릴 게 없으면 프레임을 요청하지 않는다.
  // 프레임마다 React 커밋이 없다: 입자 배열은 ref, 표시는 SVG 요소 속성 직접 쓰기 (2026-09-26 C04).
  useEffect(() => {
    const clearParticles = () => {
      for (const p of particlesRef.current) p.el.remove()
      particlesRef.current = []
    }
    const svg = svgRef.current
    if (reduced || open || aiFilterIds !== null || !svg || document.hidden) {
      cancelAnimationFrame(idleFrame.current)
      clearParticles()
      return
    }

    let frameCount = 0
    const tick = () => {
      frameCount++
      const list = particlesRef.current
      if (frameCount % (5 + Math.floor(Math.random() * 3)) === 0) {
        const cx = posRef.current.x + 18
        const cy = posRef.current.y + 18
        const angle = Math.random() * Math.PI * 2
        const r = Math.random() * 8
        const life = 70 + Math.random() * 50
        const el = document.createElementNS(SVG_NS, 'polygon') as SVGPolygonElement
        svg.appendChild(el)
        list.push({
          x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r,
          vx: Math.cos(angle) * (0.1 + Math.random() * 0.25),
          vy: Math.sin(angle) * (0.1 + Math.random() * 0.25),
          life, maxLife: life,
          size: 1.2 + Math.random() * 2,
          el,
        })
        // 최대 25개 — 오래된 것부터 버린다(예전 .slice(-25)와 같다)
        while (list.length > 25) list.shift()!.el.remove()
      }

      let alive = 0
      for (const p of list) {
        p.x += p.vx; p.y += p.vy
        p.vx *= 0.995; p.vy *= 0.995
        p.life -= 0.6
        if (p.life > 0) { list[alive++] = p; paintParticle(p) }
        else p.el.remove()
      }
      list.length = alive

      idleFrame.current = requestAnimationFrame(tick)
    }
    idleFrame.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(idleFrame.current)
      clearParticles()
    }
  }, [open, aiFilterIds, visibleTick, reduced])

  // ─── 물리 시뮬레이션 ───
  // 관성 애니메이션. 다음 프레임 예약을 `simulate` 자기 자신이 아니라 내부 `step` 으로 한다 —
  // useCallback 안에서 자기 이름을 참조하면 선언 전 접근(TDZ)이 되고, 린트가 그걸 잡는다.
  const simulate = useCallback(() => {
    const step = () => {
      if (dragging.current || reduced) return
      velRef.current.x *= 0.96
      velRef.current.y *= 0.96

      let nx = posRef.current.x + velRef.current.x
      let ny = posRef.current.y + velRef.current.y
      const maxX = window.innerWidth - 48
      const maxY = window.innerHeight - 48 - getBottomPad()

      if (nx < 0) { nx = 0; velRef.current.x = Math.abs(velRef.current.x) * 0.6 }
      if (nx > maxX) { nx = maxX; velRef.current.x = -Math.abs(velRef.current.x) * 0.6 }
      if (ny < 0) { ny = 0; velRef.current.y = Math.abs(velRef.current.y) * 0.6 }
      if (ny > maxY) { ny = maxY; velRef.current.y = -Math.abs(velRef.current.y) * 0.6 }

      posRef.current = { x: nx, y: ny }
      setPos({ x: nx, y: ny })

      const sp = Math.sqrt(velRef.current.x ** 2 + velRef.current.y ** 2)
      setSpeed(sp)
      if (sp > 0.3) {
        animFrame.current = requestAnimationFrame(step)
      } else {
        velRef.current = { x: 0, y: 0 }
        setSpeed(0)
      }
    }
    step()
  }, [reduced])

  const getXY = (e: React.TouchEvent | React.MouseEvent) => {
    if ('touches' in e) {
      const t = e.touches[0] || (e as React.TouchEvent).changedTouches[0]
      return { x: t.clientX, y: t.clientY }
    }
    return { x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY }
  }

  const attachDragListeners = () => {
    detachDrag.current?.()
    const move = (e: TouchEvent | MouseEvent) => dragHandlers.current?.move(e)
    const end = () => { detachDrag.current?.(); dragHandlers.current?.end() }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', end)
    window.addEventListener('touchmove', move, { passive: false })
    window.addEventListener('touchend', end)
    window.addEventListener('touchcancel', end)
    detachDrag.current = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', end)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', end)
      detachDrag.current = null
    }
  }

  const handleStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (open || aiFilterIds !== null) return
    e.preventDefault()
    dragging.current = true
    setIsDragging(true)
    cancelAnimationFrame(animFrame.current)
    velRef.current = { x: 0, y: 0 }
    const { x, y } = getXY(e)
    const now = performance.now()
    lastTouch.current = { x, y, t: now }
    prevTouch.current = { x, y, t: now }
    attachDragListeners()
  }

  const handleMove = useCallback((e: TouchEvent | MouseEvent) => {
    if (!dragging.current) return
    e.preventDefault()
    const touch = 'touches' in e ? e.touches[0] : e
    const x = touch.clientX
    const y = touch.clientY
    const now = performance.now()

    prevTouch.current = { ...lastTouch.current }
    lastTouch.current = { x, y, t: now }

    const nx = Math.max(0, Math.min(window.innerWidth - 48, x - 24))
    const ny = Math.max(0, Math.min(window.innerHeight - 48 - getBottomPad(), y - 24))
    posRef.current = { x: nx, y: ny }
    setPos({ x: nx, y: ny })
  }, [])

  const handleEnd = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    setIsDragging(false)
    if (reduced) { velRef.current = { x: 0, y: 0 }; setSpeed(0); return }

    const dt = (performance.now() - prevTouch.current.t) || 1
    const dx = lastTouch.current.x - prevTouch.current.x
    const dy = lastTouch.current.y - prevTouch.current.y

    velRef.current = { x: (dx / dt) * 16, y: (dy / dt) * 16 }

    const maxVel = 35
    const sp = Math.sqrt(velRef.current.x ** 2 + velRef.current.y ** 2)
    if (sp > maxVel) {
      velRef.current.x = (velRef.current.x / sp) * maxVel
      velRef.current.y = (velRef.current.y / sp) * maxVel
    }
    setSpeed(Math.min(sp, maxVel))

    animFrame.current = requestAnimationFrame(simulate)
  }, [simulate, reduced])

  // 창 전체 move/end 리스너는 **드래그 중에만** 붙인다 (2026-09-26 C04).
  // 전에는 마운트 내내 비수동(passive:false) touchmove 를 달아 문서 전체 터치 스크롤이
  // 이 리스너를 거쳐야 했다(메인 스레드가 바쁘면 스크롤 시작이 막힘).
  useEffect(() => { dragHandlers.current = { move: handleMove, end: handleEnd } }, [handleMove, handleEnd])
  useEffect(() => () => {
    detachDrag.current?.()
    cancelAnimationFrame(animFrame.current)
  }, [])

  const handleFilter = async () => {
    if (!query.trim() || loading) return
    await onFilter(query)
    setOpen(false)
  }

  const handleClear = () => {
    setQuery('')
    onClear()
  }

  const BTN = 36

  if (typeof document === 'undefined') return null

  // 필터 적용 상태 (배지)
  if (aiFilterIds !== null) {
    return createPortal(
      <div className="fixed right-3 z-[60]" style={{ top: '38%' }}>
        <div data-paper-card="" className="flex items-center gap-1.5 bg-[var(--bg-card)] text-[var(--paid-text)] pl-2 pr-1.5 py-1.5 rounded-full shadow-[var(--paper-shadow-sm)] border border-[var(--border)]">
          <FairyIcon size={14} color="var(--paid-text)" />
          <span className="text-[10px] font-medium max-w-[100px] truncate">{aiFilterDesc}</span>
          <button onClick={handleClear} className="p-0.5 hover:bg-[var(--border-light)] rounded-full ml-0.5" aria-label="필터 해제">
            <X className="w-3.5 h-3.5 text-[var(--text-4)]" />
          </button>
        </div>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <>
      {/* 흰색 스타더스트 */}
      <svg ref={svgRef} className="fixed inset-0 pointer-events-none z-[55]" width="100%" height="100%" />

      {/* 메인 버튼 + 검색바 */}
      <div
        ref={btnRef}
        className="fixed z-[60] select-none touch-none"
        style={{
          left: open ? Math.max(8, Math.min(pos.x, (typeof window !== 'undefined' ? window.innerWidth : 400) - 272)) : pos.x,
          top: pos.y,
          cursor: open ? undefined : (isDragging ? 'grabbing' : 'grab'),
        }}
        onTouchStart={open ? undefined : handleStart}
        onMouseDown={open ? undefined : handleStart}
      >
        <div
          className="flex items-center rounded-full"
          style={{
            height: BTN,
            transition: 'width 0.35s cubic-bezier(0.4,0,0.2,1), box-shadow 0.35s ease, background-color 0.3s ease',
            width: open ? 260 : BTN,
            backgroundColor: open ? 'var(--paid-text)' : undefined,
            boxShadow: open
              ? 'var(--paper-shadow-md)'
              : 'none',
            overflow: open ? 'hidden' : 'visible',
          }}
        >
          {/* 검색 입력 */}
          <div
            style={{
              overflow: 'hidden',
              transition: 'width 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease',
              width: open ? 260 - BTN - 32 : 0,
              opacity: open ? 1 : 0,
            }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleFilter()
                if (e.key === 'Escape') { setOpen(false); setQuery('') }
              }}
              placeholder="15일 이후 미납, 7일이상 미납..."
              className="text-xs w-full outline-none bg-transparent pl-3 pr-1 text-[var(--on-action)] placeholder:text-[var(--on-action)]"
              style={{ height: BTN }}
              aria-label="AI 필터 검색어"
            />
          </div>

          {/* 닫기 버튼 */}
          {open && (
            <button
              onClick={() => { setOpen(false); setQuery('') }}
              className="shrink-0 flex items-center justify-center text-[var(--on-action)] hover:text-[var(--on-action)]"
              style={{ width: 28, height: BTN }}
              aria-label="닫기"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* 메인 원형 버튼 */}
          <button
            onClick={() => {
              if (open) {
                handleFilter()
              } else if (speed < 1) {
                setOpen(true)
                setTimeout(() => inputRef.current?.focus(), 150)
              }
            }}
            disabled={open && loading}
            className={`shrink-0 flex items-center justify-center rounded-full disabled:opacity-50 ${
              open ? 'bg-[var(--blue-hover)] text-[var(--on-action)]' : ''
            }`}
            style={{ width: BTN, height: BTN }}
            aria-label={open ? 'AI 필터 실행' : 'AI 필터 열기'}
          >
            {open
              ? (loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />)
              : <FairyIcon size={28} color="var(--paid-text)" />
            }
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}
