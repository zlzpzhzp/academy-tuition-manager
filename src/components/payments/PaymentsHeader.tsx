'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { TButton } from '@/components/motion'
import styles from './PaymentsHeader.module.css'

interface Props {
  month: string
  navigateMonth: (delta: number) => void
  memo: string
  memoStatus: 'loading' | 'loaded' | 'failed' | 'save_failed' | 'conflict'
  onMemoChange: (content: string) => void
  loading: boolean
  filters: ReactNode
  progress: ReactNode
  pullIndicator: ReactNode
}

/** 네비의 문서 공간은 고정하고 시각 요소만 축소한다. 저장 체인은 페이지 소유다. */
export default function PaymentsHeader({ month, navigateMonth, memo, memoStatus, onMemoChange, loading, filters, progress, pullIndicator }: Props) {
  const [memoHeight, setMemoHeight] = useState(82)
  const sizerRef = useRef<HTMLDivElement>(null)
  const memoRef = useRef<HTMLTextAreaElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const sizer = sizerRef.current
    if (!sizer) return
    const measure = () => setMemoHeight(Math.min(400, Math.max(82, sizer.scrollHeight)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(sizer)
    return () => observer.disconnect()
  }, [memo])

  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header) return
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    // 문법 지원과 compositor 가속은 별개다. 가속/관성 품질은 실제 기기에서 검수한다.
    const native = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
      && CSS.supports('animation-timeline', 'scroll(root block)')
      && CSS.supports('animation-range', '0px 120px')
      && CSS.supports('animation-duration', 'auto')
    let frame: number | null = null
    const update = () => {
      frame = null
      // CSS의 cubic-bezier(1/3, 0, 2/3, 1)와 같은 위치 함수. 시간 기반 추종 없음.
      const u = Math.min(1, Math.max(0, window.scrollY / 120))
      const p = u * u * (3 - 2 * u)
      header.style.setProperty('--payments-scroll-progress', String(p))
    }
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(update) }
    const stopFallback = () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('pageshow', schedule)
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
    }
    const selectDriver = () => {
      stopFallback()
      header.style.removeProperty('--payments-scroll-progress')
      const driver = (media?.matches ?? true) ? 'reduced' : native ? 'css' : 'fallback'
      header.dataset.paymentsMotion = driver
      if (driver !== 'fallback') return
      update() // 첫 paint/설정 변경 시 복원 위치를 즉시 반영한다.
      schedule() // 마운트 직후 브라우저의 늦은 스크롤 복원도 읽는다.
      window.addEventListener('scroll', schedule, { passive: true })
      window.addEventListener('pageshow', schedule)
    }
    selectDriver()
    media?.addEventListener('change', selectDriver)
    return () => {
      stopFallback()
      media?.removeEventListener('change', selectDriver)
    }
  }, [])

  const revealMemo = () => {
    const textarea = memoRef.current
    if (!textarea) return
    // 명시적 '메모 확인'만 이동한다. 일반 스크롤에는 좌표 측정/scrollTo/포커스 변경 없음.
    // 상단으로 돌아오며 네비가 다시 커져도 가리지 않도록 예약된 84px와 상태줄을 포함한다.
    // 실제 모바일 키보드의 뷰포트/포커스 동작은 별도 검수한다.
    const bottom = headerRef.current?.getBoundingClientRect().bottom ?? 140
    textarea.style.scrollMarginTop = `${Math.max(56, bottom) + 8}px`
    const { selectionStart, selectionEnd, selectionDirection, scrollTop } = textarea
    textarea.scrollIntoView({ block: 'start', behavior: 'instant' })
    textarea.focus({ preventScroll: true })
    textarea.setSelectionRange(selectionStart, selectionEnd, selectionDirection)
    textarea.scrollTop = scrollTop
  }

  const memoLocked = memoStatus === 'loading' || memoStatus === 'failed' || memoStatus === 'conflict'
  return (
    <>
      <div ref={headerRef} data-payments-header className={`${styles.header} sticky top-14 z-30 -mx-4 -mt-6`}>
        {pullIndicator}
        <div data-payments-nav className={styles.nav}>
          <div data-payments-nav-background aria-hidden className={styles.background} />
          <h1 data-payments-title className={`${styles.title} font-extrabold tracking-tight text-center whitespace-nowrap leading-none`}>
            <span className="text-[2.6rem] sm:text-[3.2rem] leading-none">{month.split('-')[0]}</span>
            <span className="text-[1.8rem] sm:text-[2.2rem] text-[var(--text-3)]">년 </span>
            <span className="text-5xl sm:text-6xl">{parseInt(month.split('-')[1])}</span>
            <span className="text-[1.8rem] sm:text-[2.2rem] text-[var(--text-3)]">월</span>
          </h1>
          <div className={styles.previous}>
            <TButton onClick={() => navigateMonth(-1)} className={styles.monthButton} aria-label="이전 달"><ChevronLeft className="w-7 h-7" /></TButton>
          </div>
          <div className={styles.next}>
            <TButton onClick={() => navigateMonth(1)} className={styles.monthButton} aria-label="다음 달"><ChevronRight className="w-7 h-7" /></TButton>
          </div>
        </div>
        <div data-payments-sticky-status className={styles.status}>
          {/* 발송 시작부터 종료까지 같은 위치/인스턴스. 오류는 발송 여부와 독립적이다. */}
          {progress}
          {(memoStatus === 'failed' || memoStatus === 'save_failed' || memoStatus === 'conflict') && (
            <div role="status" className="px-4 pb-1 text-xs text-[var(--unpaid-text)]">
              <p>{memoStatus === 'conflict' ? '다른 기기에서 수정됨 — 자동저장 중단. 아래 내용을 복사해 둔 뒤 새로고침하세요' : memoStatus === 'failed' ? '메모 로드 실패 — 새로고침 후 편집하세요' : '저장 실패 — 편집 내용은 화면에 보존됩니다'}</p>
              <TButton onClick={revealMemo} className="underline py-1">메모 확인</TButton>
            </div>
          )}
        </div>
      </div>
      {/* sticky의 부모는 목록 전체를 포함하는 페이지. 메모/필터는 항상 일반 흐름에 남는다. */}
      <div data-payments-details>
        <div className="flex justify-center">
          <TButton disabled={loading} onClick={() => {
            const a = document.createElement('a')
            a.href = `/api/payments/export?billing_month=${month}`
            a.download = ''
            a.click()
          }} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-[var(--text-4)] hover:text-[var(--text-3)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-50">
            <Download className="w-3 h-3" /><span>내보내기</span>
          </TButton>
        </div>
        <div className="relative overflow-hidden rounded-xl bg-[var(--bg-elevated)] mt-2" style={{ height: memoHeight }}>
          <textarea ref={memoRef} aria-label="월 메모" value={memo} readOnly={memoLocked}
            onChange={event => { if (!memoLocked) onMemoChange(event.target.value) }}
            placeholder={memoStatus === 'failed' ? '메모 로드 실패 — 새로고침 후 편집하세요' : '메모...'}
            className="absolute inset-0 w-full h-full resize-none bg-transparent rounded-xl px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-1 focus:ring-[var(--blue)] leading-[22px] overflow-y-auto" />
          <div ref={sizerRef} aria-hidden className="absolute inset-x-0 top-0 invisible pointer-events-none whitespace-pre-wrap break-words px-3 py-2 text-sm leading-[22px]">{memo + '\n'}</div>
        </div>
        <div data-payments-filters role="group" aria-label="납부 필터" className="flex flex-nowrap items-center gap-1.5 overflow-x-auto whitespace-nowrap py-2 px-1 [scroll-padding-inline:4px] [&>*]:shrink-0">
          {filters}
        </div>
      </div>
    </>
  )
}
