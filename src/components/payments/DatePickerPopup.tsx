'use client'

import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { TButton } from '@/components/motion'

interface Props {
  inlineDate: string
  onDateChange: (date: string) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
  /** 매달 정기 결제일 (1~31). 넘기면 달력에 매월 해당 일자를 점으로 마킹 */
  paymentDueDay?: number | null
}

export default function DatePickerPopup({ inlineDate, onDateChange, onClose, anchorRef, paymentDueDay }: Props) {
  const popupRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect()
      let top = rect.bottom + 4
      let left = Math.max(8, rect.left)
      // 화면 밖으로 나가면 위로
      if (top + 280 > window.innerHeight) top = rect.top - 280
      // 왼쪽 밖으로 나가면 조정
      if (left + 220 > window.innerWidth) left = window.innerWidth - 228
      setPos({ top, left })
    }
  }, [anchorRef])

  const selDate = new Date(inlineDate)
  const year = selDate.getFullYear()
  const month = selDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const navigateMonth = (delta: number) => {
    const nd = new Date(year, month + delta, 1)
    const maxDay = new Date(nd.getFullYear(), nd.getMonth() + 1, 0).getDate()
    const day = Math.min(selDate.getDate(), maxDay)
    onDateChange(
      `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    )
  }

  const dueDayThisMonth = paymentDueDay && paymentDueDay >= 1 && paymentDueDay <= daysInMonth
    ? paymentDueDay
    : null

  return createPortal(
    <div data-picker-portal>
      <div className="fixed inset-0 z-[210]" onClick={onClose} />
      <div data-paper-card=""
        ref={popupRef}
        className="fixed z-[211] bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-xl p-2"
        style={{ top: pos.top, left: pos.left, width: '220px' }}
        role="dialog"
        aria-label="날짜 선택"
      >
        <div className="flex items-center justify-between mb-1.5 px-1">
          <TButton
            type="button"
            onClick={() => navigateMonth(-1)}
            className="text-[var(--text-4)] hover:text-[var(--text-3)] text-xs p-0.5"
            aria-label="이전 달"
          >
            ◀
          </TButton>
          <span className="text-xs font-medium text-[var(--text-1)]">{year}년 {month + 1}월</span>
          <TButton
            type="button"
            onClick={() => navigateMonth(1)}
            className="text-[var(--text-4)] hover:text-[var(--text-3)] text-xs p-0.5"
            aria-label="다음 달"
          >
            ▶
          </TButton>
        </div>
        <div className="grid grid-cols-7 gap-0 text-center">
          {['일', '월', '화', '수', '목', '금', '토'].map(d => (
            <span key={d} className="text-[9px] text-[var(--text-4)] py-0.5">{d}</span>
          ))}
          {cells.map((day, i) => {
            const isSelected = day === selDate.getDate()
            const isDue = dueDayThisMonth === day
            return (
              <TButton
                key={i}
                type="button"
                disabled={!day}
                onClick={() => {
                  if (day) {
                    onDateChange(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
                    onClose()
                  }
                }}
                className={`relative text-[11px] py-1 rounded ${
                  !day ? '' :
                  isSelected ? 'bg-[var(--blue)] text-[var(--on-action)] font-bold' :
                  'hover:bg-[var(--bg-elevated)] text-[var(--text-2)]'
                }`}
                aria-label={day ? `${month + 1}월 ${day}일${isDue ? ' (정기 결제일)' : ''}` : undefined}
              >
                {day || ''}
                {isDue && (
                  <span
                    className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                    style={{ background: isSelected ? 'var(--on-action)' : 'var(--green)' }}
                  />
                )}
              </TButton>
            )
          })}
        </div>
        {/* 정기 결제일 범례 — paymentDueDay 넘긴 경우(환불계산기)만 표시. 필터에선 안 뜸 */}
        {paymentDueDay != null && (
          <div className="flex items-center gap-3 mt-1.5 px-1 pb-0.5">
            <span className="flex items-center gap-1 text-[9px] text-[var(--text-4)]">
              <span className="w-2 h-2 rounded bg-[var(--blue)]" />
              마지막 수업일
            </span>
            <span className="flex items-center gap-1 text-[9px] text-[var(--text-4)]">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--green)' }} />
              매달 {paymentDueDay}일 결제일
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
