'use client'

import { useState, useCallback, useMemo } from 'react'
import { useAnimatedClose } from '@/lib/useAnimatedClose'
import { AnimatePresence } from 'framer-motion'
import { motion } from '@/components/paperMotion'
import { X, Send, AlertTriangle, Check, Loader2, Bell } from 'lucide-react'
import { TButton } from '@/components/motion'
import { formatWon } from '@/lib/format'
import AnimatedModal from '@/components/ui/AnimatedModal'

export interface BulkBillTarget {
  studentId: string
  studentName: string
  className: string
  amount: number
}

interface Props {
  className: string
  targets: BulkBillTarget[]
  onClose: () => void
  onConfirm: () => Promise<void>
  /** 'send'(기본): 신규 청구서 일괄 발송. 'resend': 기존 sent 청구서 알림 재푸시 */
  mode?: 'send' | 'resend'
  /** 명단에서 자동 제외된 인원 안내(예: 지난달 미납 N명 제외) — 발송자가 빠진 이유를 알게 (2026-08-27) */
  excludedNote?: string
}

type State = 'idle' | 'confirming' | 'sending'

export default function BulkBillSendModal({ className, targets, onClose: onCloseRaw, onConfirm, mode = 'send', excludedNote }: Props) {
  const { closing, onClose } = useAnimatedClose(onCloseRaw)
  const [state, setState] = useState<State>('idle')
  const isResend = mode === 'resend'

  const total = useMemo(() => targets.reduce((acc, t) => acc + t.amount, 0), [targets])

  const handlePrimary = useCallback(async () => {
    if (state === 'sending') return
    if (state !== 'confirming') { setState('confirming'); return }
    setState('sending')
    try {
      await onConfirm() // 모달은 상위에서 닫음
    } catch {
      // onConfirm이 던지면 state='sending'에 갇혀 닫기(X/백드롭)까지 전부 disabled — 복구 (2026-07-10 C9)
      setState('confirming')
    }
  }, [state, onConfirm])

  return (
    <AnimatedModal
      open={!closing}
      onClose={() => { if (state !== 'sending') onClose() }}
      closeOnBackdrop={state !== 'sending'}
    >
      <div data-paper-card=""
        className="bg-[var(--bg-card)] w-full rounded-2xl max-h-[88vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-card)] z-10 rounded-t-[inherit]">
          <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
            {isResend ? <Bell className="w-4 h-4 text-[var(--scheduled-text)]" /> : <Send className="w-4 h-4 text-[var(--scheduled-text)]" />}
            {isResend ? '미결제 일괄 재발송' : '일괄 청구서 발송'}
            <span className="text-xs font-normal text-[var(--text-4)]">{className}</span>
          </h2>
          <TButton
            onClick={() => { if (state !== 'sending') onClose() }}
            disabled={state === 'sending'}
            className="p-1.5 text-[var(--text-4)] hover:text-[var(--text-3)] hover:bg-[var(--bg-elevated)] rounded-lg transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </TButton>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[var(--bg-elevated)]">
            <span className="text-xs text-[var(--text-3)]">대상 인원</span>
            <span className="text-sm font-bold tabular-nums">{targets.length}명</span>
          </div>

          {excludedNote && (
            <div className="flex items-start gap-1.5 px-3 py-2 rounded-xl bg-[var(--unpaid-bg)]">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--unpaid-text)]" />
              <span className="text-xs leading-snug text-[var(--unpaid-text)]">{excludedNote} — 미납분 정리 후 개별 발송하세요</span>
            </div>
          )}

          <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] max-h-72 overflow-y-auto">
            {targets.map(t => (
              <div key={t.studentId} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm font-semibold truncate">{t.studentName}</span>
                <span className="text-xs tabular-nums text-[var(--text-3)]">{formatWon(t.amount)}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between px-3 py-3 rounded-xl bg-[var(--bg-card-hover)]">
            <span className="text-sm font-medium text-[var(--text-3)]">합계</span>
            <span className="text-lg font-extrabold text-[var(--blue)] tabular-nums">{formatWon(total)}</span>
          </div>

          <p className="text-xs text-[var(--text-4)] text-center">
            {isResend
              ? '기존 청구서 카톡 알림이 다시 푸시됩니다 (새 청구 아님 · 결제 링크 동일)'
              : '카카오톡 알림톡으로 청구서가 발송됩니다'}
          </p>

          <AnimatePresence>
            {state === 'confirming' && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="flex items-start gap-2 p-3 bg-[var(--orange-dim)] rounded-xl"
              >
                <AlertTriangle className="w-4 h-4 text-[var(--scheduled-text)] shrink-0 mt-0.5" />
                <p className="text-sm text-[var(--scheduled-text)]">
                  {isResend
                    ? <><strong>{targets.length}명</strong>에게 미결제 알림을 일괄 재발송합니다. 이미 결제된 학생은 자동 제외됩니다.</>
                    : <><strong>{targets.length}명</strong>에게 <strong>{formatWon(total)}</strong> 청구서를 일괄 발송합니다. 실행하시겠습니까?</>}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="px-5 py-4 border-t border-[var(--border)] flex gap-2">
          <TButton
            onClick={() => { if (state === 'sending') return; if (state === 'confirming') setState('idle'); else onClose() }}
            disabled={state === 'sending'}
            className="flex-1 py-3 rounded-xl text-sm font-semibold bg-[var(--bg-elevated)] text-[var(--text-3)] hover:bg-[var(--border-light)] transition-colors disabled:opacity-40"
          >
            {state === 'confirming' ? '뒤로' : '취소'}
          </TButton>
          <TButton
            onClick={handlePrimary}
            disabled={state === 'sending' || targets.length === 0}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
              state === 'confirming'
                ? 'bg-[var(--orange)] text-[var(--on-action)] hover:opacity-90'
                : state === 'sending'
                  ? 'bg-[var(--blue)] text-[var(--on-action)] opacity-70 cursor-not-allowed'
                  : 'bg-[var(--blue)] text-[var(--on-action)] hover:opacity-90 disabled:opacity-30'
            }`}
          >
            {state === 'sending' ? (
              <><Loader2 className="w-4 h-4 animate-spin" />{isResend ? '재발송 시작...' : '발송 시작...'}</>
            ) : state === 'confirming' ? (
              <><Check className="w-4 h-4" />{isResend ? '확인, 재발송합니다' : '확인, 발송합니다'}</>
            ) : isResend ? (
              <><Bell className="w-4 h-4" />일괄 재발송</>
            ) : (
              <><Send className="w-4 h-4" />일괄 발송</>
            )}
          </TButton>
        </div>
      </div>
    </AnimatedModal>
  )
}
