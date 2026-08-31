'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import { X, RotateCcw, CheckCircle2, Undo2, Calculator, Calendar } from 'lucide-react'
import { toast } from 'sonner'
import { calcRefund, parseClassDays, DAY_LABELS, getLastClassDate } from '@/types'
import { formatWon } from '@/lib/format'
import { getTodayString } from '@/lib/date'
import DatePickerPopup from '@/components/payments/DatePickerPopup'

export type WithdrawActionTarget = {
  studentId: string
  studentName: string
  // 환불계산기용 — 퇴원 메뉴에서도 바로 환불액을 확인할 수 있게 (2026-06-13 사용자 지시)
  fee?: number
  enrollmentDate?: string
  withdrawalDate?: string | null
  classDays?: string | null
  paymentDueDay?: number | null
  phone?: string | null // 정산 재청구 발송용 (학부모폰)
  /** 보고 있는 달의 정규 청구서 상태 — 정산이 '환불형'인지 '미납형'인지 안내 문구를 가르는 데만 씀.
   *  실제 판정은 서버(resettle)가 다시 한다. (2026-07-22) */
  regularBillStatus?: string | null
}

type Props = {
  target: WithdrawActionTarget | null
  billingMonth: string
  onClose: () => void
  onMarked: () => void
}

const ACCENT = 'var(--red)'

const ACTION_OPTIONS = [
  { key: 'refund_done', label: '계좌환불 완료', desc: '계좌로 환불 처리 끝남 — 빨간 동그란 화살표', status: 'refund_done', icon: RotateCcw },
  { key: 'settle', label: '이번달까지 정리', desc: '이번달까지만 다니고 청구서·결제 없음 — 파기/환불할 것 없음', status: 'settle', icon: CheckCircle2 },
] as const

export default function WithdrawActionMenu({ target, billingMonth, onClose, onMarked }: Props) {
  // exit 애니메이션이 끝까지 재생되도록 AnimatePresence가 target=null 전환을 감지하게 함.
  // 내부 본문은 non-null target에 의존하므로 별도 컴포넌트로 분리.
  return createPortal(
    <AnimatePresence>
      {target && (
        <WithdrawActionMenuBody
          key="withdraw-menu"
          target={target}
          billingMonth={billingMonth}
          onClose={onClose}
          onMarked={onMarked}
        />
      )}
    </AnimatePresence>,
    document.body
  )
}

function WithdrawActionMenuBody({ target, billingMonth, onClose, onMarked }: Props & { target: WithdrawActionTarget }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [lastClassDate, setLastClassDate] = useState('') // 사용자가 고른 마지막 수업일 (YYYY-MM-DD)
  const [pickerOpen, setPickerOpen] = useState(false)
  const dateBtnRef = useRef<HTMLButtonElement>(null)

  const pad = (n: number) => String(n).padStart(2, '0')
  const toStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  // 마지막 수업일 기본값 = 저장된 withdrawal_date 직전 마지막 수업일 (calcRefund와 동일 기준)
  const defaultLastClass = target.withdrawalDate
    ? toStr(getLastClassDate(new Date(target.withdrawalDate), target.classDays))
    : ''
  const effectiveLastClass = lastClassDate || defaultLastClass

  // calcRefund 입력은 "미수강 시작일" = 마지막 수업일 다음날. 마지막 수업일 당일까지는 수강한 것으로 계산.
  const refund = target.fee != null && target.enrollmentDate && effectiveLastClass
    ? (() => {
        const [y, m, d] = effectiveLastClass.split('-').map(Number)
        const noShowStart = new Date(y, m - 1, d + 1)
        return calcRefund(
          target.fee,
          new Date(target.enrollmentDate),
          noShowStart,
          target.classDays,
          target.paymentDueDay,
        )
      })()
    : null

  const resumedAmount = refund ? (target.fee ?? 0) - refund.refundAmount : 0

  /**
   * 버튼 라벨용 정산 계획 — 서버 판정(dryRun)을 받아온다. 발송·파기는 하지 않는다.
   * 화면이 자기 캐시로 '환불형/미납형'을 추측하면 실제 동작과 어긋날 수 있다
   * (한 달에 완납분과 미납분이 함께 있는 학생 등). 라벨도 확인창과 같은 출처를 쓴다. (2026-07-22)
   */
  const [plan, setPlan] = useState<{ mode?: string } | null>(null)
  useEffect(() => {
    if (resumedAmount <= 0) { setPlan(null); return }
    let alive = true
    fetch('/api/payssam/resettle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: target.studentId,
        studentName: target.studentName,
        phone: target.phone,
        billingMonth,
        resumedAmount,
        dryRun: true,
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setPlan(d) })
      .catch(() => { if (alive) setPlan(null) })
    return () => { alive = false }
  }, [target.studentId, target.studentName, target.phone, billingMonth, resumedAmount])

  // 월별 처리 상태 기록 (이번달까지 정리 / 계좌환불 완료) — 학생 memo 아닌 그 달(billingMonth)에만 적용
  const apply = async (status: string, key: string) => {
    if (busy) return
    setBusy(key)
    try {
      const r = await fetch('/api/withdrawal-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: target.studentId, billing_month: billingMonth, status }),
      })
      if (!r.ok) throw new Error('update failed')
      toast.success(`${target.studentName}: ${status === 'refund_done' ? '계좌환불 완료' : '이번달까지 정리'}`)
      onMarked()
      onClose()
    } catch (e) {
      toast.error(`처리 실패: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  /** 중도퇴원 정산 — 서버가 당월 청구서 상태로 방식을 판정한다.
   *  완납분이 있으면 '환불형': 정산분 발송 → 결제완료 시 콜백이 기존 완납분 환불.
   *    (2026-07-15 원장 지시: '취소 먼저'가 아니라 '정산분 결제완료 시점에' 환불 → 재청구 누락 손실 방지)
   *  미납이면 '미납형': 미납 청구서 파기 → 실수강분만 청구(환불 없음). (2026-07-22)
   *  실행 전 dryRun으로 계획을 받아 확인창에 그대로 띄운다 — 보인 것과 실행되는 것을 일치시킨다. */
  const resettleAndRebill = async () => {
    if (busy || !refund) return
    const resumed = (target.fee ?? 0) - refund.refundAmount
    if (resumed <= 0) { toast.error('재청구 금액이 0원 이하입니다'); return }

    const payload = {
      studentId: target.studentId,
      studentName: target.studentName,
      phone: target.phone,
      billingMonth,
      resumedAmount: resumed,
      productName: `${billingMonth.replace('-', '년 ')}월 수업료 (중도퇴원 정산)`,
    }

    setBusy('resettle')
    try {
      // 1) 프리플라이트 — 서버가 '무엇을 할지' 판정만 해서 돌려준다(발송·파기 없음).
      //    확인창 문구를 화면 캐시로 지어내면 실제 동작과 어긋날 수 있어서(한 달에 완납분과
      //    미납분이 함께 있는 경우 등), 띄울 문구를 서버 판정으로 받아 쓴다. (2026-07-22)
      const pre = await fetch('/api/payssam/resettle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, dryRun: true }),
      })
      const serverPlan = await pre.json()
      if (!pre.ok) throw new Error(serverPlan.error || '정산 대상 확인 실패')

      if (!confirm(
        `${target.studentName} — 중도퇴원 정산\n` +
        `(${refund.elapsedSessions}회 수강 / 총 ${refund.totalSessions}회)\n\n` +
        `${serverPlan.planText}\n\n` +
        `진행할까요?`,
      )) { setBusy(null); return }

      // 2) 실제 실행
      const r = await fetch('/api/payssam/resettle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || '재청구 실패')
      const unpaidMode = data.mode === 'unpaid'
      if (data.code === 'SCHEDULED') {
        toast.success(unpaidMode
          ? `${target.studentName}: 미납분 파기 완료 — 정산분 재청구 ${data.scheduled_at_kst} 예약`
          : `${target.studentName}: 정산분 재청구 ${data.scheduled_at_kst} 예약 — 결제완료 시 기존 결제 자동 환불`)
      } else {
        toast.success(unpaidMode
          ? `${target.studentName}: 미납분 파기 후 정산분 ${resumed.toLocaleString()}원 청구서 발송`
          : `${target.studentName}: 정산분 ${resumed.toLocaleString()}원 청구서 발송 — 결제완료되면 기존 결제 자동 환불`)
      }
      onMarked()
      onClose()
    } catch (e) {
      toast.error(`정산 재청구 실패: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  /** 퇴원 취소 (번복) — withdrawal_date 해제 → 원래 반 복귀.
   *  memo/memo_color는 건드리지 않는다: 퇴원 마킹을 학생 memo에 쓰는 코드가 저장소에 없고
   *  (퇴원 상태는 withdrawal_status 테이블), null 덮어쓰기는 무관한 메모(차감 지시 등)만
   *  조용히 지웠다 (2026-08-13 라인리뷰). */
  const cancelWithdrawal = async () => {
    if (busy) return
    if (!confirm(`${target.studentName} 학생의 퇴원을 취소하고 원래 반으로 복귀시킵니다.\n\n진행하시겠습니까?`)) return
    setBusy('cancel_withdrawal')
    try {
      const r = await fetch(`/api/students/${target.studentId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withdrawal_date: null }),
      })
      if (!r.ok) throw new Error('퇴원 취소 실패')
      toast.success(`${target.studentName} 퇴원 취소 — 원래 반으로 복귀`)
      onMarked()
      onClose()
    } catch (e) {
      toast.error(`퇴원 취소 실패: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
        onClick={onClose}
      >
        <motion.div
          key="sheet"
          initial={{ y: 40, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 40, opacity: 0, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="w-full sm:max-w-md bg-[var(--bg-card)] rounded-t-3xl sm:rounded-3xl border border-[var(--border)] shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div>
              <p className="text-[11px] tracking-widest text-[var(--text-4)] font-semibold">퇴원 처리 — 환불/청구서</p>
              <h2 className="text-[18px] font-bold text-[var(--text-1)] mt-0.5">{target.studentName}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-[var(--text-3)] hover:bg-[var(--bg-card-hover)] transition-colors"
              aria-label="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 환불 계산기 — 퇴원 처리/처리중 학생도 바로 환불액 확인 (2026-06-13 사용자 지시) */}
          {target.fee != null && target.enrollmentDate && (
            <div className="mx-5 mb-3 p-4 rounded-2xl border border-[var(--border)] bg-[var(--bg)]">
              <div className="flex items-center gap-2 mb-3">
                <Calculator className="w-4 h-4 text-[var(--text-3)]" />
                <p className="text-[13px] font-bold text-[var(--text-1)]">환불 계산기</p>
              </div>
              <div className="mb-3">
                <span className="block text-[11px] text-[var(--text-4)] mb-1">마지막 수업일</span>
                <button
                  ref={dateBtnRef}
                  type="button"
                  onClick={() => {
                    if (!effectiveLastClass) setLastClassDate(getTodayString())
                    setPickerOpen(true)
                  }}
                  className="flex items-center gap-2 px-3 py-2 border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-1)] rounded-lg text-sm hover:bg-[var(--bg-card-hover)] active:scale-[0.99] transition-all"
                >
                  <Calendar className="w-4 h-4 text-[var(--text-3)]" />
                  <span className="tabular-nums">{effectiveLastClass || '날짜 선택'}</span>
                </button>
                {pickerOpen && (
                  <DatePickerPopup
                    inlineDate={effectiveLastClass || getTodayString()}
                    onDateChange={setLastClassDate}
                    onClose={() => setPickerOpen(false)}
                    anchorRef={dateBtnRef}
                    paymentDueDay={target.paymentDueDay}
                  />
                )}
              </div>
              {refund ? (
                <>
                  {refund.isSessionBased && target.classDays && (
                    <div className="px-3 py-2 mb-3 bg-[var(--blue-dim)] rounded-lg text-[11px] text-[var(--blue)]">
                      수업 요일: {parseClassDays(target.classDays)?.map(d => DAY_LABELS[d]).join(', ')} (수업 횟수 기반)
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="p-2.5 bg-[var(--bg-elevated)] rounded-lg">
                      <p className="text-[var(--text-4)] text-[11px]">{refund.isSessionBased ? '총 수업 횟수' : '등록기간'}</p>
                      <p className="font-medium">{refund.totalSessions}{refund.isSessionBased ? '회' : '일'}</p>
                    </div>
                    <div className="p-2.5 bg-[var(--bg-elevated)] rounded-lg">
                      <p className="text-[var(--text-4)] text-[11px]">{refund.isSessionBased ? '경과 수업' : '경과일수'}</p>
                      <p className="font-medium">{refund.elapsedSessions}{refund.isSessionBased ? '회' : '일'}</p>
                    </div>
                    <div className="p-2.5 bg-[var(--bg-elevated)] rounded-lg">
                      <p className="text-[var(--text-4)] text-[11px]">{refund.isSessionBased ? '잔여 수업' : '잔여일수'}</p>
                      <p className="font-medium">{refund.remainingSessions}{refund.isSessionBased ? '회' : '일'}</p>
                    </div>
                    <div className="p-2.5 bg-[var(--blue-dim)] rounded-lg">
                      <p className="text-[var(--blue)] text-[11px]">환불 예상액</p>
                      <p className="font-bold text-[var(--blue)]">{formatWon(refund.refundAmount)}</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-[var(--text-4)] mt-2">
                    원비 {formatWon(target.fee)} × 잔여 {refund.remainingSessions}{refund.isSessionBased ? '회' : '일'} / {refund.totalSessions}{refund.isSessionBased ? '회' : '일'}
                  </p>

                  {/* 원클릭: 기존 결제 취소 → 실수강분 재청구 (2026-06-15 사용자 지시) */}
                  {(() => {
                    const resumed = (target.fee ?? 0) - refund.refundAmount
                    // 미납 퇴원은 환불할 돈이 없다 — 라벨에 '결제 후 기존 환불'을 쓰면 화면이 거짓말을 한다.
                    // 서버 판정(plan)이 오면 그걸 쓰고, 아직이면 화면 값으로 잠정 표시.
                    const unpaid = plan?.mode ? plan.mode === 'unpaid' : target.regularBillStatus === 'sent'
                    return (
                      <button
                        type="button"
                        disabled={busy !== null || resumed <= 0}
                        onClick={resettleAndRebill}
                        className="mt-3 w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl font-bold text-left transition-all active:scale-[0.99] disabled:opacity-50"
                        style={{ background: 'var(--blue)', color: '#fff' }}
                      >
                        <span className="flex flex-col">
                          <span className="text-[13px]">
                            {unpaid ? '정산분 재청구 (미납분 파기 후 청구)' : '정산분 재청구 (결제 후 기존 환불)'}
                          </span>
                          <span className="text-[10px] font-medium opacity-80">
                            {unpaid
                              ? '미납 청구서 파기 → 실수강분만 청구 (환불 없음)'
                              : '실수강분 청구 → 결제완료되면 기존 결제 자동 환불'}
                          </span>
                        </span>
                        <span className="text-[15px] font-extrabold tabular-nums shrink-0">
                          {busy === 'resettle' ? '처리 중…' : `${formatWon(resumed)}`}
                        </span>
                      </button>
                    )
                  })()}
                </>
              ) : (
                <p className="text-[11px] text-[var(--text-4)]">마지막 수업일을 선택하면 환불 예상액이 계산됩니다.</p>
              )}
            </div>
          )}

          <div className="px-5 pb-4 space-y-2">
            {ACTION_OPTIONS.map(opt => {
              const Icon = opt.icon
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => apply(opt.status, opt.key)}
                  className="w-full flex items-start gap-3 px-4 py-3 rounded-2xl border border-[var(--border)] hover:bg-[var(--bg-card-hover)] active:scale-[0.99] transition-all text-left disabled:opacity-50"
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `color-mix(in oklab, ${ACCENT} 12%, transparent)`, color: ACCENT }}>
                    <Icon className="w-4 h-4" strokeWidth={2.2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-bold text-[var(--text-1)]">{opt.label}</p>
                    <p className="text-[11px] text-[var(--text-4)] mt-0.5">{opt.desc}</p>
                  </div>
                  {busy === opt.key && (
                    <span className="text-[10px] text-[var(--text-4)] shrink-0 self-center">처리 중...</span>
                  )}
                </button>
              )
            })}

            {/* 퇴원 취소 (번복) — 처분이 아니라 복귀라 파란색으로 구분 */}
            <div className="pt-2 mt-1 border-t border-[var(--border)]">
              <button
                type="button"
                disabled={busy !== null}
                onClick={cancelWithdrawal}
                className="w-full flex items-start gap-3 px-4 py-3 rounded-2xl border border-[var(--border)] hover:bg-[var(--bg-card-hover)] active:scale-[0.99] transition-all text-left disabled:opacity-50"
              >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--blue-dim)', color: 'var(--blue)' }}>
                  <Undo2 className="w-4 h-4" strokeWidth={2.2} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold text-[var(--text-1)]">퇴원 취소 (번복)</p>
                  <p className="text-[11px] text-[var(--text-4)] mt-0.5">퇴원 해제하고 원래 반으로 복귀 — 퇴원 마킹도 초기화</p>
                </div>
                {busy === 'cancel_withdrawal' && <span className="text-[10px] text-[var(--text-4)] shrink-0 self-center">처리 중...</span>}
              </button>
            </div>
          </div>

          <div className="px-5 pb-5 pt-1">
            <p className="text-[10px] text-[var(--text-4)] leading-relaxed">
              퇴원 학생의 결제 처리 상태를 표시합니다. 빨간 칩은 후속 작업이 남아있다는 뜻이며, 환불이 끝나면 초록 환불완료로 바꾸세요.
            </p>
          </div>
        </motion.div>
      </motion.div>
  )
}
