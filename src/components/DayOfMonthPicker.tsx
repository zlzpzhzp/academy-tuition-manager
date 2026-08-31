'use client'

import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Check } from 'lucide-react'
import { TButton } from '@/components/motion'

interface Props {
  open: boolean
  value: number | null
  onChange: (day: number | null) => void
  onClose: () => void
  title?: string
  allowClear?: boolean
}

export default function DayOfMonthPicker({ open, value, onChange, onClose, title = '결제일 선택', allowClear = true }: Props) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {open && (
    <motion.div
      key="dom-picker-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[80] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="w-full max-w-xs bg-[var(--bg-card)] rounded-2xl shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-[var(--text-1)]">
            {value == null ? title : `${value}일`}
          </div>
          <TButton
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-3)] hover:bg-[var(--bg-elevated)]"
          >
            <X className="w-4 h-4" />
          </TButton>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 31 }, (_, i) => i + 1).map(day => {
            const selected = value === day
            return (
              <TButton
                key={day}
                type="button"
                onClick={() => { onChange(day); onClose() }}
                className={`aspect-square rounded-lg text-xs font-semibold transition-colors ${
                  selected
                    ? 'bg-[var(--blue)] text-white'
                    : 'text-[var(--text-2)] hover:bg-[var(--bg-elevated)]'
                }`}
              >
                {day}
              </TButton>
            )
          })}
        </div>
        {allowClear && (
          <div className="flex items-center justify-between gap-2 mt-3">
            <TButton
              type="button"
              onClick={() => { onChange(null); onClose() }}
              className="px-3 py-2 rounded-xl text-xs font-semibold text-[var(--text-3)] hover:bg-[var(--bg-elevated)]"
            >
              해제
            </TButton>
            <TButton
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-xl text-sm font-bold bg-[var(--bg-elevated)] text-[var(--text-2)] flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>닫기</span>
            </TButton>
          </div>
        )}
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
