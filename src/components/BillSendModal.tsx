'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAnimatedClose } from '@/lib/useAnimatedClose'
import { X, Send, AlertTriangle, Check, Loader2 } from 'lucide-react'
import { getRegularTuitionTitle, getElectivesTuitionTitle, REGULAR_TUITION_MESSAGE } from '@/lib/billing-title'
import { formatWon, formatNumber } from '@/lib/format'
import { formatMonth } from '@/lib/utils'
import { TButton } from '@/components/motion'
import AnimatedModal from '@/components/ui/AnimatedModal'

interface Props {
  studentName: string
  studentId: string
  phone: string
  amount: number
  subject: string | null
  className?: string | null
  billingMonth: string
  electives?: string[]
  billType?: 'regular' | 'electives'
  onClose: () => void
  onSuccess?: () => void
}

type SendState = 'idle' | 'confirming' | 'sending' | 'success' | 'scheduled' | 'error'

function todayKstLabel(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000)
  return `${kst.getMonth() + 1}월 ${kst.getDate()}일`
}

function buildAmountAdjustNote(original: number, modified: number): string {
  return `${todayKstLabel()} 금액 수정 발송 (기본 ${formatWon(original)} → ${formatWon(modified)})`
}

export default function BillSendModal({ studentName, studentId, phone, amount, subject, className, billingMonth, electives, billType = 'regular', onClose: onCloseRaw, onSuccess }: Props) {
  // close 애니메이션 트리거
  const { closing, onClose } = useAnimatedClose(onCloseRaw)
  const isElectivesBill = billType === 'electives'
  const defaultTitle = isElectivesBill
    ? getElectivesTuitionTitle(billingMonth, electives)
    : getRegularTuitionTitle(subject, billingMonth, className, electives)
  const defaultMessage = REGULAR_TUITION_MESSAGE
  const [title, setTitle] = useState(defaultTitle)
  const [messageContent, setMessageContent] = useState(defaultMessage)
  const [amountValue, setAmountValue] = useState(amount)
  const [billNote, setBillNote] = useState('')
  const [state, setState] = useState<SendState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [scheduledKst, setScheduledKst] = useState('')

  useEffect(() => { setTitle(defaultTitle) }, [defaultTitle])
  useEffect(() => { setMessageContent(defaultMessage) }, [defaultMessage])
  useEffect(() => { setAmountValue(amount) }, [amount])

  // 금액이 기본값과 다르면 결제특이사항 자동 채움 (유저가 수정하지 않은 경우만)
  useEffect(() => {
    if (amountValue === amount) return
    const auto = buildAmountAdjustNote(amount, amountValue)
    setBillNote(prev => {
      if (!prev) return auto
      // 기존 값이 다른 금액으로 생성된 자동 문구면 갱신, 아니면 유저 편집이므로 유지
      if (/^\d+월 \d+일 금액 수정 발송 \(기본/.test(prev)) return auto
      return prev
    })
  }, [amountValue, amount])

  // 전화번호 유효성 검사
  const cleanPhone = phone.replace(/-/g, '')
  const isPhoneValid = /^01[016789]\d{7,8}$/.test(cleanPhone)

  // 금액 유효성 검사
  const isAmountValid = amountValue > 0

  // ESC 닫기는 AnimatedModal(모달 스택 top 판정 + onClose의 sending 가드)이 담당 (2026-07-10 C4)

  const handleSend = useCallback(async () => {
    if (state === 'sending' || state === 'success') return

    // 1단계: 확인 요청
    if (state !== 'confirming') {
      setState('confirming')
      return
    }

    // 2단계: 실제 발송
    setState('sending')
    setErrorMsg('')

    try {
      const finalTitle = title.trim() || defaultTitle
      const finalMessage = messageContent.trim() || defaultMessage
      const finalBillNote = billNote.trim() ||
        (amountValue !== amount ? buildAmountAdjustNote(amount, amountValue) : '')

      const res = await fetch('/api/payssam/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          studentName,
          phone: cleanPhone,
          amount: amountValue,
          productName: finalTitle,
          message: finalMessage,
          billingMonth,
          billNote: finalBillNote || undefined,
          billType,
        }),
      })

      const data = await res.json()

      // 영업시간 외 → 예약 등록 응답
      if (res.ok && data.code === 'SCHEDULED') {
        setScheduledKst(data.scheduled_at_kst || '')
        setState('scheduled')
        setTimeout(() => {
          onSuccess?.()
          onClose()
        }, 3500)
        return
      }

      if (!res.ok || data.code !== '0000') {
        const msg = data.msg || data.error || '청구서 발송에 실패했습니다'
        setErrorMsg(msg)
        setState('error')
        return
      }

      setState('success')

      // 성공 후 2초 뒤 자동 닫기
      setTimeout(() => {
        onSuccess?.()
        onClose()
      }, 2500)

    } catch {
      setErrorMsg('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      setState('error')
    }
  }, [state, studentId, studentName, cleanPhone, amount, amountValue, billingMonth, title, messageContent, billNote, defaultTitle, defaultMessage, billType, onClose, onSuccess])


  return (
    <AnimatedModal
      open={!closing}
      onClose={() => { if (state !== 'sending') onClose() }}
      closeOnBackdrop={state !== 'sending'}
    >
      <div data-paper-card="" className="bg-[var(--bg-card)] w-full rounded-2xl max-h-[90vh] overflow-y-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-card)] z-10">
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <Send className="w-5 h-5 text-[var(--blue)]" />
            청구서 발송
          </h2>
          <TButton
            onClick={() => { if (state !== 'sending') onClose() }}
            className="p-1.5 text-[var(--text-4)] hover:text-[var(--text-3)] hover:bg-[var(--bg-elevated)] rounded-lg transition-colors"
            disabled={state === 'sending'}
          >
            <X className="w-5 h-5" />
          </TButton>
        </div>

        <div className="p-5 space-y-4">
          {/* 유효성 경고 */}
          {!isPhoneValid && (
            <div className="flex items-start gap-2 p-3 bg-[var(--red-dim)] rounded-xl">
              <AlertTriangle className="w-4 h-4 text-[var(--red)] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[var(--red)]">전화번호 오류</p>
                <p className="text-xs text-[var(--text-3)] mt-0.5">
                  {phone ? `"${phone}"은 유효한 전화번호가 아닙니다` : '학부모 전화번호가 등록되어 있지 않습니다'}
                </p>
              </div>
            </div>
          )}

          {/* 청구 정보 */}
          <div className="bg-[var(--bg-card-hover)] rounded-xl p-4 space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-[var(--text-3)]">학생</span>
              <span className="text-sm font-semibold">{studentName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-[var(--text-3)]">수신 번호</span>
              <span className={`text-sm font-semibold ${isPhoneValid ? '' : 'text-[var(--red)]'}`}>
                {phone || '없음'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-[var(--text-3)]">청구 월</span>
              <span className="text-sm font-semibold">{formatMonth(billingMonth)}</span>
            </div>
            <div className="border-t border-[var(--border)] pt-3 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-[var(--text-3)] shrink-0">청구 금액</span>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={amountValue === 0 ? '' : formatNumber(amountValue)}
                  onChange={e => {
                    const raw = e.target.value.replace(/[^0-9]/g, '')
                    if (raw === '') { setAmountValue(0); return }
                    const n = parseInt(raw, 10)
                    if (!Number.isNaN(n)) setAmountValue(Math.min(99999999, n))
                  }}
                  disabled={state === 'sending' || state === 'success' || state === 'scheduled'}
                  className="w-32 px-2 py-1 bg-[var(--bg-elevated)] rounded-lg text-xl font-extrabold text-[var(--blue)] text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-[var(--blue)] disabled:opacity-60"
                />
                <span className="text-sm font-medium text-[var(--text-3)]">원</span>
              </div>
            </div>
            {amountValue !== amount && (
              <div className="flex items-center justify-end gap-1.5 -mt-1">
                <span className="text-[10px] text-[var(--text-4)] line-through tabular-nums">{formatWon(amount)}</span>
                <TButton
                  type="button"
                  onClick={() => setAmountValue(amount)}
                  className="text-[10px] text-[var(--blue)] hover:underline"
                  disabled={state === 'sending' || state === 'success' || state === 'scheduled'}
                >
                  기본값 복원
                </TButton>
              </div>
            )}
          </div>

          {/* 제목 (카톡 알림톡 상품명) */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">제목</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, 60))}
              disabled={state === 'sending' || state === 'success' || state === 'scheduled'}
              placeholder={defaultTitle}
              className="w-full px-3 py-2 bg-[var(--bg-elevated)] rounded-xl text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-1 focus:ring-[var(--blue)] disabled:opacity-60"
            />
          </div>

          {/* 내용 (카톡 알림톡 메시지) */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">내용</label>
            <textarea
              value={messageContent}
              onChange={e => setMessageContent(e.target.value.slice(0, 200))}
              disabled={state === 'sending' || state === 'success' || state === 'scheduled'}
              rows={2}
              placeholder={defaultMessage}
              className="w-full px-3 py-2 bg-[var(--bg-elevated)] rounded-xl text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-1 focus:ring-[var(--blue)] disabled:opacity-60 resize-none"
            />
          </div>

          {/* 결제 특이사항 (bill_note) */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">
              결제 특이사항 <span className="text-[var(--text-4)] font-normal">(선택)</span>
            </label>
            <input
              type="text"
              value={billNote}
              onChange={e => setBillNote(e.target.value.slice(0, 60))}
              disabled={state === 'sending' || state === 'success' || state === 'scheduled'}
              placeholder="예: 특강비 포함, 분할결제 2/3회차 등"
              className="w-full px-3 py-2 bg-[var(--bg-elevated)] rounded-xl text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-1 focus:ring-[var(--blue)] disabled:opacity-60"
            />
            {amountValue !== amount && (
              <p className="text-[10px] text-[var(--scheduled-text)] mt-1">금액 수정분이 자동 기록됩니다</p>
            )}
          </div>

          {/* 안내 */}
          <p className="text-xs text-[var(--text-4)] text-center">
            카카오톡 알림톡으로 청구서가 발송됩니다
          </p>

          {/* 에러 메시지 */}
          {state === 'error' && (
            <div className="flex items-start gap-2 p-3 bg-[var(--red-dim)] rounded-xl">
              <AlertTriangle className="w-4 h-4 text-[var(--red)] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[var(--red)]">발송 실패</p>
                <p className="text-xs text-[var(--text-3)] mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}

          {/* 성공 */}
          {state === 'success' && (
            <div className="flex items-center justify-center gap-2 p-4 bg-[var(--green-dim)] rounded-xl">
              <Check className="w-5 h-5 text-[var(--paid-text)]" />
              <span className="text-sm font-bold text-[var(--paid-text)]">청구서가 발송되었습니다</span>
            </div>
          )}

          {/* 예약 (영업시간 외) */}
          {state === 'scheduled' && (
            <div className="flex items-start gap-2 p-4 bg-[var(--orange-dim)] rounded-xl">
              <Check className="w-5 h-5 text-[var(--scheduled-text)] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-[var(--scheduled-text)]">예약 발송 등록됨</p>
                <p className="text-xs text-[var(--text-3)] mt-1">
                  영업시간 외 요청이라 <strong>{scheduledKst} KST</strong>에 자동으로 발송됩니다.
                </p>
                <p className="text-[11px] text-[var(--text-4)] mt-1">
                  업무시간: 평일 11:00~22:00 · 토 11:00~20:00
                </p>
              </div>
            </div>
          )}

          {/* 확인 단계 경고 */}
          {state === 'confirming' && (
            <div className="flex items-start gap-2 p-3 bg-[var(--orange-dim)] rounded-xl">
              <AlertTriangle className="w-4 h-4 text-[var(--scheduled-text)] shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--scheduled-text)]">
                <strong>{studentName}</strong>님에게 <strong>{formatWon(amountValue)}</strong> 청구서를 발송합니다. 확인하시겠습니까?
              </p>
            </div>
          )}

          {/* 버튼 */}
          {state !== 'success' && state !== 'scheduled' && (
            <div className="flex gap-2">
              {state === 'confirming' && (
                <TButton
                  onClick={() => setState('idle')}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold bg-[var(--bg-elevated)] text-[var(--text-3)] transition-colors hover:bg-[var(--border-light)]"
                >
                  취소
                </TButton>
              )}
              <TButton
                onClick={handleSend}
                disabled={!isPhoneValid || !isAmountValid || state === 'sending'}
                className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2
                  ${state === 'confirming'
                    ? 'bg-[var(--orange)] text-[var(--on-action)] hover:opacity-90'
                    : state === 'sending'
                      ? 'bg-[var(--blue)] text-[var(--on-action)] opacity-70 cursor-not-allowed'
                      : state === 'error'
                        ? 'bg-[var(--blue)] text-[var(--on-action)] hover:opacity-90'
                        : 'bg-[var(--blue)] text-[var(--on-action)] hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed'
                  }`}
              >
                {state === 'sending' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    발송 중...
                  </>
                ) : state === 'confirming' ? (
                  '확인, 발송합니다'
                ) : state === 'error' ? (
                  '다시 시도'
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    청구서 발송
                  </>
                )}
              </TButton>
            </div>
          )}
        </div>
      </div>
    </AnimatedModal>
  )
}
