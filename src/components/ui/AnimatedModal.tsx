'use client'

import { AnimatePresence, motion, useDragControls, type PanInfo } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface AnimatedModalProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  maxWidth?: string
  fullscreen?: boolean
  closeOnBackdrop?: boolean
  /**
   * 'center'(기본): 가운데 fade+scale (데스크탑/태블릿).
   * 'sheet': 모바일 바텀시트 (slide-up from bottom + drag-to-dismiss).
   *           sm 이상에선 sheet도 가운데로 보여 자연스럽게.
   *           sheet는 2단계 snap point — 1차 88vh, 위로 더 드래그하면 100dvh 풀스크린.
   *           drag는 핸들에서만 시작 — 콘텐츠 영역은 자유 스크롤.
   */
  variant?: 'center' | 'sheet'
}

const SPRING_PANEL = { type: 'spring' as const, stiffness: 360, damping: 30 }
const DRAG_DISMISS_OFFSET = 100
const DRAG_DISMISS_VELOCITY = 500
const DRAG_EXPAND_OFFSET = 40

// 열린 모달 스택 — 중첩 모달(학생상세 → 납부기록)에서 Escape/포커스트랩이 최상단 모달만
// 처리하게 함. 없으면 Escape 한 번에 모달 전부 닫힘 (2026-07-10 전수점검 C4/C5)
const modalStack: symbol[] = []

export default function AnimatedModal({
  open,
  onClose,
  children,
  maxWidth = 'max-w-md',
  fullscreen = false,
  closeOnBackdrop = true,
  variant = 'center',
}: AnimatedModalProps) {
  const [mounted, setMounted] = useState(false)
  // sheet 2단계 snap: false = 1차(88vh), true = 풀스크린(100dvh)
  const [expanded, setExpanded] = useState(false)
  // dragControls — drag를 핸들에서만 시작하게 분리. 콘텐츠 영역의 overflow-y-auto와 충돌 안 함.
  const dragControls = useDragControls()
  // focus trap (Phase 3.2): 모달 내부에서 Tab 순환, 외부로 이동 차단
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  // onClose는 호출 시점 최신값을 ref로 참조 — 포커스 트랩 effect가 onClose 변경(인라인 함수)으로
  // 재실행되어 입력 중 포커스를 빼앗는 버그 방지 (deps를 [open]으로 좁히기 위함)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  useEffect(() => setMounted(true), [])

  // open 닫힐 때 expanded 상태 초기화
  useEffect(() => {
    if (!open) setExpanded(false)
  }, [open])

  // 이 모달 인스턴스 식별자 (스택 top 판정용)
  const stackIdRef = useRef<symbol | null>(null)

  useEffect(() => {
    if (!open) return
    // 스택 등록 — Escape/포커스트랩은 top 모달만 반응
    const stackId = Symbol('modal')
    stackIdRef.current = stackId
    modalStack.push(stackId)
    const isTop = () => modalStack[modalStack.length - 1] === stackId
    // 열기 직전 포커스 위치 저장
    previouslyFocused.current = document.activeElement as HTMLElement | null

    const getFocusable = () => {
      const root = panelRef.current
      if (!root) return [] as HTMLElement[]
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => el.offsetParent !== null || el === document.activeElement)
    }

    // 첫 focusable로 포커스 이동
    const t = setTimeout(() => {
      const focusable = getFocusable()
      focusable[0]?.focus()
    }, 50)

    const handleKey = (e: KeyboardEvent) => {
      if (!isTop()) return // 중첩 모달: 최상단만 키 처리
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const focusable = getFocusable()
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        // Shift+Tab — 첫 요소에서 마지막으로 순환
        if (active === first || !panelRef.current?.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        // Tab — 마지막에서 첫 요소로 순환
        if (active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', handleKey)
      // 스택 해제
      const i = modalStack.indexOf(stackId)
      if (i >= 0) modalStack.splice(i, 1)
      // body 스크롤 복원은 마지막 모달이 닫힐 때만 (중첩 모달 닫힘 순서 무관)
      if (modalStack.length === 0) document.body.style.overflow = prevOverflow
      // 닫힐 때 포커스 복원
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  if (!mounted) return null

  const isSheet = variant === 'sheet'

  // sheet variant: 모바일은 bottom-sheet drag, sm 이상은 center fade-scale
  // expanded 시 backdrop을 stretch로 → panel이 화면 위까지 닿게
  const backdropAlign = isSheet
    ? expanded
      ? 'items-stretch sm:items-center justify-center'
      : 'items-end sm:items-center justify-center'
    : 'items-center justify-center px-4'

  const panelInitial = fullscreen
    ? { opacity: 0, y: 24 }
    : isSheet
      ? { opacity: 0, y: '100%' as const }
      : { opacity: 0, scale: 0.96, y: 8 }
  const panelAnimate = fullscreen
    ? { opacity: 1, y: 0 }
    : isSheet
      ? { opacity: 1, y: 0 }
      : { opacity: 1, scale: 1, y: 0 }
  const panelExit = panelInitial

  // sheet expanded: 풀스크린 100dvh, 1차: 88vh
  // 콘텐츠 스크롤은 자식 컨테이너(.sheet-content)가 담당, 여기 max-h만 강제
  // bg-[var(--bg-card)]: 핸들 영역에 panel 배경 깔아 backdrop 비침 차단
  // `sm:${maxWidth}` 런타임 조합은 Tailwind가 스캔 못 한다 — 지금은 다른 파일의 리터럴 덕에
  // 우연히 동작. 미리 정의된 리터럴 맵으로 고정, 없는 값은 md 폴백 (2026-08-13 라인리뷰)
  const SM_MAX_W: Record<string, string> = {
    'max-w-sm': 'sm:max-w-sm', 'max-w-md': 'sm:max-w-md', 'max-w-lg': 'sm:max-w-lg',
    'max-w-xl': 'sm:max-w-xl', 'max-w-2xl': 'sm:max-w-2xl', 'max-w-3xl': 'sm:max-w-3xl',
  }
  const smMaxW = SM_MAX_W[maxWidth] ?? 'sm:max-w-md'
  const panelSheetClass = expanded
    ? `w-full ${smMaxW} sm:rounded-2xl sm:max-h-[88vh] h-[100dvh] sm:h-auto flex flex-col bg-[var(--bg-card)]`
    : `w-full ${smMaxW} sm:rounded-2xl rounded-t-2xl max-h-[88vh] flex flex-col bg-[var(--bg-card)]`

  const panelClass = fullscreen
    ? 'w-full h-full'
    : isSheet
      ? panelSheetClass
      : `w-full ${maxWidth}`

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (!isSheet) return
    // 아래로 빠르게/멀리 → 닫기
    const closeOffset = expanded ? 200 : DRAG_DISMISS_OFFSET
    if (info.offset.y > closeOffset || info.velocity.y > DRAG_DISMISS_VELOCITY) {
      onClose()
      return
    }
    // 위로 드래그 + 1차 상태 → 풀스크린 expand
    if (!expanded && info.offset.y < -DRAG_EXPAND_OFFSET) {
      setExpanded(true)
      return
    }
    // 아래로 살짝 드래그 + 풀스크린 상태 → 1차로 collapse
    if (expanded && info.offset.y > DRAG_EXPAND_OFFSET) {
      setExpanded(false)
      return
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className={`fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex ${fullscreen ? '' : backdropAlign}`}
          onClick={closeOnBackdrop ? onClose : undefined}
        >
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            initial={panelInitial}
            animate={panelAnimate}
            exit={panelExit}
            transition={SPRING_PANEL}
            drag={isSheet ? 'y' : false}
            // dragListener=false: panel 자체에선 drag 시작 안 됨. 핸들 onPointerDown에서만 dragControls.start.
            // 이렇게 해야 콘텐츠 overflow-y-auto가 자유롭게 스크롤됨.
            dragListener={false}
            dragControls={isSheet ? dragControls : undefined}
            dragConstraints={isSheet ? { top: -100, bottom: 0 } : undefined}
            dragElastic={isSheet ? 0.2 : undefined}
            onDragEnd={isSheet ? handleDragEnd : undefined}
            onClick={(e) => e.stopPropagation()}
            className={panelClass}
          >
            {/* sheet 핸들 — 모바일 전용. 탭하면 expand 토글, 드래그하면 sheet 이동 */}
            {isSheet && (
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                onPointerDown={(e) => dragControls.start(e)}
                aria-label={expanded ? '시트 축소' : '풀스크린으로 펼치기'}
                className="flex justify-center w-full pt-3 pb-2 sm:hidden touch-none cursor-grab active:cursor-grabbing focus:outline-none flex-shrink-0"
              >
                <div className={`h-1.5 rounded-full transition-all ${expanded ? 'bg-[var(--text-2)] w-12' : 'bg-[var(--text-4)] w-10'}`} />
              </button>
            )}
            {/* 콘텐츠 — overflow-y-auto로 자유 스크롤. drag 충돌 없음. */}
            <div className={isSheet ? 'flex-1 overflow-y-auto overscroll-contain' : ''}>
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
