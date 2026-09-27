'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import { motion } from '@/components/paperMotion'
import { TButton } from '@/components/motion'

export type PaymentFilter = 'all' | 'unpaid' | 'overdue_unsent'
export interface DayFilterValue { filter: PaymentFilter; start: number | null; end: number | null }
export interface OverdueCalendar { days: Set<number>; studentCount: number; adjustedDays: Set<number>; asOf: string }
interface Props {
  open: boolean
  month: string
  value: DayFilterValue
  overdue: OverdueCalendar
  anchorRef: RefObject<HTMLButtonElement | null>
  onApply: (value: DayFilterValue) => void
  onClear: () => void
  onClose: () => void
}

function DraftPicker({ month, value, overdue, anchorRef, onApply, onClear, onClose }: Props) {
  const [start, setStart] = useState(value.start)
  const [end, setEnd] = useState(value.end)
  const [onlyOverdue, setOnlyOverdue] = useState(value.filter === 'overdue_unsent')
  const [year, monthNumber] = month.split('-').map(Number)
  const daysInMonth = new Date(year, monthNumber, 0).getDate()
  const firstDow = new Date(year, monthNumber - 1, 1).getDay()
  const [focusedDay, setFocusedDay] = useState(Math.min(start ?? 1, daysInMonth))
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.querySelector<HTMLButtonElement>(`[data-day="${Math.min(value.start ?? 1, daysInMonth)}"]`)?.focus({ preventScroll: true })
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
      if (event.key !== 'Tab' || !dialog) return
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')).filter(el => el.tabIndex >= 0)
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first?.focus()
      }
    }
    document.addEventListener('keydown', keydown, true)
    const anchor = anchorRef.current
    return () => { document.removeEventListener('keydown', keydown, true); anchor?.focus({ preventScroll: true }) }
  }, [anchorRef, daysInMonth, value.start])

  const pickDay = (day: number) => {
    setOnlyOverdue(false)
    if (start === null || end !== null) { setStart(day); setEnd(null) }
    else { setStart(Math.min(start, day)); setEnd(Math.max(start, day)) }
  }
  const moveDay = (event: KeyboardEvent, day: number) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]
    if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const next = Math.min(daysInMonth, Math.max(1, event.key === 'Home' ? 1 : event.key === 'End' ? daysInMonth : day + delta!))
    setFocusedDay(next)
    dialogRef.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus()
  }
  const apply = () => onApply(onlyOverdue
    ? { filter: 'overdue_unsent', start: null, end: null }
    : { filter: value.filter === 'overdue_unsent' ? 'all' : value.filter, start, end: end ?? start })

  return (
    <motion.div key="day-picker-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <motion.div ref={dialogRef} data-paper-card="" role="dialog" aria-modal="true" aria-labelledby="payment-days-title" aria-describedby="payment-days-help"
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="w-full max-w-xs bg-[var(--bg-card)] rounded-2xl shadow-xl p-4" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div id="payment-days-title" className="text-sm font-semibold text-[var(--text-1)]">
            {onlyOverdue ? '청구지연' : start === null ? '결제일 선택' : end === null ? `${start}일 (한 번 더 누르면 범위)` : start === end ? `${start}일` : `${start}일 ~ ${end}일`}
          </div>
          <TButton type="button" onClick={onClose} aria-label="닫기" className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-3)] hover:bg-[var(--bg-elevated)]"><X className="w-4 h-4" /></TButton>
        </div>
        <TButton type="button" aria-pressed={onlyOverdue} onClick={() => {
          setOnlyOverdue(!onlyOverdue)
          if (!onlyOverdue) { setStart(null); setEnd(null) }
        }} className={`w-full flex items-center justify-between rounded-xl px-3 py-2 mb-2 text-xs font-semibold border ${onlyOverdue ? 'border-[var(--red)] bg-[var(--red-dim)] text-[var(--unpaid-text)]' : 'border-[var(--border)] text-[var(--text-2)]'}`}>
          <span>청구지연 {overdue.studentCount}명</span><span aria-hidden>{onlyOverdue ? '✓' : '○'}</span>
        </TButton>
        <p id="payment-days-help" className="text-[11px] leading-relaxed text-[var(--text-3)] mb-2">
          빨간 날짜와 점은 청구지연입니다. 인원은 학생 수이며 일괄 발송 가능 인원과 다릅니다. ({overdue.asOf} 기준)
          {overdue.adjustedDays.size > 0 && ` ${Array.from(overdue.adjustedDays).sort((a, b) => a - b).join('·')}일 결제일은 이 달 말일(${daysInMonth}일)에 모아 표시합니다. 날짜 범위는 원래 결제일 기준입니다.`}
          <span className="sr-only">방향키로 날짜 이동, Home·End로 월 처음·끝 이동, Enter로 선택합니다.</span>
        </p>
        {/* 선택월 요일 정렬과 실제 일수를 보존한다. 학생 모달용 피커와 별개다. */}
        <div className="grid grid-cols-7 gap-1 text-center mb-1.5" aria-hidden>
          {['일', '월', '화', '수', '목', '금', '토'].map((day, i) => <span key={day} className={`text-[10px] font-medium ${i === 0 ? 'text-[var(--red)]' : i === 6 ? 'text-[var(--blue)]' : 'text-[var(--text-4)]'}`}>{day}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1" role="group" aria-label={`${year}년 ${monthNumber}월 결제일`}>
          {Array.from({ length: firstDow }, (_, i) => <div key={`empty-${i}`} className="aspect-square" />)}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
            const selected = start === day || end === day
            const inRange = start !== null && end !== null && day > start && day < end
            const late = overdue.days.has(day)
            return <TButton key={day} type="button" data-day={day} data-overdue={late} tabIndex={focusedDay === day ? 0 : -1}
              aria-pressed={selected || inRange} aria-label={`${day}일${late ? ', 청구지연' : ''}${late && day === daysInMonth && overdue.adjustedDays.size ? ', 월말로 보정된 결제일 포함' : ''}`}
              onFocus={() => setFocusedDay(day)} onKeyDown={event => moveDay(event, day)} onClick={() => pickDay(day)}
              className={`relative aspect-square rounded-lg text-xs font-semibold transition-colors border-2 ${
                selected ? 'border-[var(--blue)] bg-[var(--blue-dim)]' : inRange ? 'border-transparent bg-[var(--blue-dim)]' : 'border-transparent hover:bg-[var(--bg-elevated)]'
              } ${late ? 'text-[var(--red)]' : selected || inRange ? 'text-[var(--blue)]' : 'text-[var(--text-2)]'}`}>
              {day}{late && <span aria-hidden className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[var(--red)]" />}
            </TButton>
          })}
        </div>
        <div className="flex items-center justify-between gap-2 mt-3">
          <TButton type="button" onClick={onClear} className="px-3 py-2 rounded-xl text-xs font-semibold text-[var(--text-3)] hover:bg-[var(--bg-elevated)]">해제</TButton>
          <TButton type="button" onClick={apply} className="flex-1 py-2 rounded-xl text-sm font-bold bg-[var(--blue)] text-[var(--on-action)] flex items-center justify-center gap-1.5"><Check className="w-4 h-4" /><span>적용</span></TButton>
        </div>
      </motion.div>
    </motion.div>
  )
}

export default function PaymentDayFilterPicker(props: Props) {
  if (typeof document === 'undefined') return null
  // createPortal 바깥에 AnimatePresence를 두면 포털 직계 자식을 추적하지 못한다 (2026-06-15 흉터).
  return createPortal(<AnimatePresence>{props.open && <DraftPicker key="payment-days" {...props} />}</AnimatePresence>, document.body)
}
