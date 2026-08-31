'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PaymentMethod } from '@/types'
import { METHOD_OPTIONS_SHORT } from '@/lib/constants'
import { TButton } from '@/components/motion'

interface Props {
  currentMethod: PaymentMethod
  onMethodChange: (method: PaymentMethod) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

export default function MethodPickerPopup({ currentMethod, onMethodChange, onClose, anchorRef }: Props) {
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect()
      let top = rect.bottom + 4
      let left = rect.left
      const menuH = METHOD_OPTIONS_SHORT.length * 28 + 8
      if (top + menuH > window.innerHeight) top = rect.top - menuH - 4
      if (left + 60 > window.innerWidth) left = window.innerWidth - 68
      setPos({ top, left })
    }
    requestAnimationFrame(() => setShow(true))
  }, [anchorRef])

  return createPortal(
    <div data-picker-portal>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        className="fixed z-[61] flex flex-col gap-0.5 items-start"
        style={{ top: pos.top, left: pos.left }}
        role="listbox"
        aria-label="결제수단 선택"
      >
        {METHOD_OPTIONS_SHORT.map(([val, label], i) => (
          <TButton
            key={val}
            type="button"
            onClick={() => { onMethodChange(val); onClose() }}
            role="option"
            aria-selected={currentMethod === val}
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap shadow-md transition-all ${
              currentMethod === val
                ? 'bg-[var(--blue)] text-white'
                : 'bg-[var(--bg-card)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--bg-card-hover)] border border-[var(--border)]'
            }`}
            style={{
              opacity: show ? 1 : 0,
              transform: show ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(0.8)',
              transition: `opacity 0.2s ease ${i * 0.04}s, transform 0.25s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.04}s`,
            }}
          >
            {label}
          </TButton>
        ))}
      </div>
    </div>,
    document.body
  )
}
