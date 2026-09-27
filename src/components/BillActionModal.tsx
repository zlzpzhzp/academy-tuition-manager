'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAnimatedClose } from '@/lib/useAnimatedClose'
import { X, Trash2, Undo2, AlertTriangle, Check, Loader2, RefreshCw, Split, Bell, Send, Mail, MessageSquare } from 'lucide-react'
import { TButton } from '@/components/motion'
import { formatWon, formatNumber } from '@/lib/format'
import { pickSplitActionTargets } from '@/lib/splitBillActions'
import AnimatedModal from '@/components/ui/AnimatedModal'
import { ACADEMY_NAME, MESSAGE_PREFIX, SMS_SENDER_NUMBER } from '@/lib/branding'

interface SplitBillInfo {
  count: number
  amounts: number[]
  statuses?: ('sent' | 'paid' | 'cancelled' | 'destroyed')[]
  /** 건별 청구서 id — 있으면 파기/취소/재발송을 건별 (billId, amount) 쌍으로 실행한다.
   *  없이 합계로 보내면 서버 AMOUNT_MISMATCH 가드에 전부 막힌다 (2026-08-16 라인리뷰 high) */
  billIds?: string[]
}

interface Props {
  studentId: string
  studentName: string
  phone: string
  billId: string
  amount: number
  status: 'sent' | 'paid' | 'cancelled'
  billingMonth: string
  onClose: () => void
  onSuccess?: () => void
  /** 분할 청구 발송된 학생: 건수와 분할 금액 */
  splitInfo?: SplitBillInfo
  /** 미납 안내 SMS 양식 자동 채움용 — 과목명, 결제일 */
  subject?: string | null
  paymentDueDay?: number | null
}

type ActionState = 'idle' | 'confirming-destroy' | 'confirming-cancel' | 'confirming-reissue' | 'confirming-resend' | 'configuring-split' | 'composing-sms' | 'confirming-sms' | 'submitting' | 'success' | 'error'

function buildOverdueSmsTemplate(opts: { studentName: string; subject?: string | null; billingMonth: string; paymentDueDay?: number | null }): string {
  const monthNum = Number(opts.billingMonth.slice(5, 7)) || new Date().getMonth() + 1
  const subjectLabel = opts.subject?.trim() || '정규'
  const dueDayLabel = opts.paymentDueDay != null && opts.paymentDueDay > 0 ? `${opts.paymentDueDay}일` : '확인 필요'
  return `[${ACADEMY_NAME}]
안녕하세요!
학부모님 ${ACADEMY_NAME}입니다.
${opts.studentName}학생 ${subjectLabel} ${monthNum}월 정규원비가 미납중인 것으로 확인됩니다.(결제일 매달 ${dueDayLabel})

카톡으로만 알림이 가고 있어서 문자로 다시한번 전달드립니다.

혹여 결제가 완료 되었는데 저희가 확인 못했을 수 있으니 한번 확인해보시고 궁금하신 사항이 있으시면 언제든 편히 이 번호로 문의 주세요.

항상 감사합니다🙏`
}

export default function BillActionModal({ studentId, studentName, phone, billId, amount, status, billingMonth, onClose: onCloseRaw, onSuccess, splitInfo, subject, paymentDueDay }: Props) {
  // close 애니메이션 트리거 — 240ms exit 후 부모 onClose
  const { closing, onClose } = useAnimatedClose(onCloseRaw)
  const [state, setState] = useState<ActionState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [successLabel, setSuccessLabel] = useState('')

  const [parts, setParts] = useState<2 | 3 | 4>(3)
  const [splitAmounts, setSplitAmounts] = useState<string[]>(['', '', ''])
  const [smsText, setSmsText] = useState<string>('')

  const openSmsCompose = useCallback(() => {
    setSmsText(buildOverdueSmsTemplate({ studentName, subject, billingMonth, paymentDueDay }))
    setState('composing-sms')
  }, [studentName, subject, billingMonth, paymentDueDay])

  const submitSms = useCallback(async () => {
    setState('submitting')
    setErrorMsg('')
    try {
      const res = await fetch('/api/sms/send-overdue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, text: smsText.trim(), billId }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || '문자 발송에 실패했습니다')
        setState('error')
        return
      }
      setSuccessLabel('미납 안내 문자를 보냈습니다')
      setState('success')
      setTimeout(() => { onSuccess?.(); onClose() }, 2000)
    } catch {
      setErrorMsg('네트워크 오류가 발생했습니다')
      setState('error')
    }
  }, [studentId, smsText, billId, onClose, onSuccess])

  // ESC 닫기는 AnimatedModal(모달 스택 top 판정 + onClose의 submitting 가드)이 담당 (2026-07-10 C4)

  useEffect(() => {
    setSplitAmounts(prev => {
      const next = Array.from({ length: parts }, (_, i) => prev[i] ?? '')
      return next
    })
  }, [parts])

  const submit = useCallback(async (kind: 'destroy' | 'cancel' | 'reissue' | 'resend') => {
    setState('submitting')
    setErrorMsg('')
    try {
      const url =
        kind === 'destroy' ? '/api/payssam/destroy' :
        kind === 'cancel' ? '/api/payssam/cancel' :
        kind === 'resend' ? '/api/payssam/resend' :
        '/api/payssam/reissue'

      // 분할 청구: 건별 (billId, amount)로 순차 실행 — 합계로 한 번에 보내면
      // 서버의 건별 금액 대조 가드(AMOUNT_MISMATCH)에 100% 막힌다 (2026-08-16 라인리뷰 high)
      if (splitInfo?.billIds && splitInfo.billIds.length >= 2) {
        const targets = pickSplitActionTargets(
          kind,
          splitInfo.billIds.map((id, i) => ({
            billId: id,
            amount: splitInfo.amounts[i] ?? 0,
            status: splitInfo.statuses?.[i] ?? 'sent',
          })),
        )
        if (targets.length === 0) {
          setErrorMsg(kind === 'cancel' ? '취소할 결제완료 분할 청구서가 없습니다' : '처리할 발송됨 분할 청구서가 없습니다')
          setState('error')
          return
        }
        let okCount = 0
        let scheduledCount = 0
        const failures: string[] = []
        for (const t of targets) {
          try {
            const r = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ billId: t.billId, amount: t.amount }),
            })
            const d = await r.json().catch(() => ({}))
            if (r.ok && d.code === 'SCHEDULED') scheduledCount++
            else if (r.ok && d.code === '0000') okCount++
            else failures.push(`${t.amount.toLocaleString()}원: ${d.msg || d.error || `HTTP ${r.status}`}`)
          } catch {
            failures.push(`${t.amount.toLocaleString()}원: 네트워크 오류`)
          }
        }
        if (failures.length > 0) {
          // 일부 성공 시에도 실패분을 표면화 — 남은 청구서가 라이브로 방치되면 안 된다
          setErrorMsg(`분할 ${targets.length}건 중 ${failures.length}건 실패${okCount + scheduledCount > 0 ? ` (성공 ${okCount + scheduledCount}건)` : ''} — ${failures.join(' / ')}`)
          setState('error')
          if (okCount + scheduledCount > 0) onSuccess?.() // 성공분은 목록에 반영
          return
        }
        const actionLabel =
          kind === 'destroy' ? '파기' : kind === 'cancel' ? '결제 취소' : kind === 'resend' ? '재알림' : '재발행'
        setSuccessLabel(
          scheduledCount > 0
            ? `분할 ${targets.length}건 ${actionLabel} — ${scheduledCount}건은 영업시간 외 예약 처리`
            : `분할 ${targets.length}건 ${actionLabel} 완료`,
        )
        setState('success')
        setTimeout(() => { onSuccess?.(); onClose() }, 2500)
        return
      }

      const body = { billId, amount }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok && data.code === 'SCHEDULED') {
        setSuccessLabel(`영업시간 외 → ${data.scheduled_at_kst} KST 예약 재발송 등록됨`)
        setState('success')
        setTimeout(() => { onSuccess?.(); onClose() }, 3500)
        return
      }
      if (!res.ok || data.code !== '0000') {
        setErrorMsg(data.msg || data.error || '처리에 실패했습니다')
        setState('error')
        return
      }
      setSuccessLabel(
        kind === 'destroy' ? '청구서가 파기되었습니다' :
        kind === 'cancel' ? '결제가 취소되었습니다' :
        kind === 'resend' ? '카톡 알림을 다시 보냈습니다' :
        '새 청구서가 발송되었습니다'
      )
      setState('success')
      setTimeout(() => {
        onSuccess?.()
        onClose()
      }, 2000)
    } catch {
      setErrorMsg('네트워크 오류가 발생했습니다')
      setState('error')
    }
  }, [billId, amount, splitInfo, onClose, onSuccess])

  const updateSplitAmount = (idx: number, value: string) => {
    const digits = value.replace(/\D/g, '')
    const num = digits ? parseInt(digits) : 0
    setSplitAmounts(prev => {
      const next = [...prev]
      next[idx] = digits
      // 마지막 칸이 아니면서 현재+앞서 입력된 금액들이 원비에 미치지 않으면 다음 칸 자동계산
      if (idx < parts - 1) {
        let accumulated = 0
        for (let i = 0; i <= idx; i++) {
          accumulated += i === idx ? num : (parseInt(next[i] || '0'))
        }
        const remaining = amount - accumulated
        if (remaining > 0) {
          // 나머지를 남은 칸 수로 균등 분배 (마지막 칸에만 잔액 몰빵 대신 균등)
          const remainingParts = parts - idx - 1
          const perPart = Math.floor(remaining / remainingParts)
          const lastAdjust = remaining - perPart * remainingParts
          for (let j = idx + 1; j < parts; j++) {
            next[j] = String(j === parts - 1 ? perPart + lastAdjust : perPart)
          }
        } else {
          for (let j = idx + 1; j < parts; j++) next[j] = '0'
        }
      }
      return next
    })
  }

  const splitTotal = splitAmounts.reduce((s, v) => s + (parseInt(v || '0') || 0), 0)
  const splitValid = splitTotal === amount && splitAmounts.every(v => parseInt(v || '0') > 0)

  const submitSplit = useCallback(async () => {
    setState('submitting')
    setErrorMsg('')
    try {
      const amounts = splitAmounts.map(v => parseInt(v || '0'))
      const res = await fetch('/api/payssam/split-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          studentName,
          phone,
          billingMonth,
          amounts,
        }),
      })
      const data = await res.json()
      if (res.ok && data.code === 'SCHEDULED') {
        setSuccessLabel(`영업시간 외 → ${data.scheduled_at_kst} KST 예약 발송 등록됨`)
        setState('success')
        setTimeout(() => {
          onSuccess?.()
          onClose()
        }, 3500)
        return
      }
      if (!res.ok || (data.code !== '0000' && data.code !== 'PARTIAL')) {
        setErrorMsg(data.msg || data.error || '분할 발송에 실패했습니다')
        setState('error')
        return
      }
      if (data.code === 'PARTIAL') {
        setErrorMsg(data.msg)
        setState('error')
        // 일부는 실제로 발송됐다 — 목록을 갱신하지 않으면 운영자가 같은 화면에서
        // 재시도해 성공분이 중복 청구된다 (2026-08-13 라인리뷰)
        onSuccess?.()
        return
      }
      // 서버가 일부러 표면화한 '기존 청구서 파기 실패'(이중결제 위험)를 성공 화면이 버리면 안 된다
      if (Array.isArray(data.destroyFailed) && data.destroyFailed.length > 0) {
        setErrorMsg(data.msg || `발송은 완료됐지만 기존 청구서 ${data.destroyFailed.length}건 파기 실패 — 수동 파기 필요 (이중결제 위험)`)
        setState('error')
        onSuccess?.() // 분할 발송 자체는 성공 — 목록 갱신
        return
      }
      setSuccessLabel(`${parts}건 분할 청구서 발송 완료`)
      setState('success')
      setTimeout(() => {
        onSuccess?.()
        onClose()
      }, 2000)
    } catch {
      setErrorMsg('네트워크 오류가 발생했습니다')
      setState('error')
    }
  }, [splitAmounts, studentId, studentName, phone, billingMonth, parts, onClose, onSuccess])

  const canDestroy = status === 'sent'   // 미결제 발송 상태만 파기
  const canCancel = status === 'paid'    // 결제완료만 취소
  const canSplit = status === 'sent'     // 미결제 발송 상태만 분할

  return (
    <AnimatedModal
      open={!closing}
      onClose={() => { if (state !== 'submitting') onClose() }}
      closeOnBackdrop={state !== 'submitting'}
    >
      <div data-paper-card="" className="bg-[var(--bg-card)] w-full rounded-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-card)] z-10 rounded-t-[inherit]">
          <h2 className="text-lg font-bold tracking-tight">
            {state === 'configuring-split' ? '분할결제 설정' : (state === 'composing-sms' || state === 'confirming-sms') ? '미납 안내 문자' : '청구서 관리'}
          </h2>
          <TButton
            onClick={() => { if (state !== 'submitting') onClose() }}
            className="p-1.5 text-[var(--text-4)] hover:text-[var(--text-3)] hover:bg-[var(--bg-elevated)] rounded-lg transition-colors"
            disabled={state === 'submitting'}
          >
            <X className="w-5 h-5" />
          </TButton>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-[var(--bg-card-hover)] rounded-xl p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-[var(--text-3)]">학생</span>
              <span className="text-sm font-semibold">{studentName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-[var(--text-3)]">청구 금액</span>
              <span className="text-sm font-bold">{formatWon(amount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-[var(--text-3)]">상태</span>
              <span className="text-sm font-semibold">
                {status === 'sent' ? '발송됨' : status === 'paid' ? '결제완료' : '취소됨'}
              </span>
            </div>
            {splitInfo && splitInfo.count >= 2 && (
              <div className="pt-2 mt-2 border-t border-[var(--border)] space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[var(--text-3)]">분할 청구</span>
                  <span className="text-sm font-bold text-[var(--scheduled-text)]">{splitInfo.count}건</span>
                </div>
                <div className="flex flex-col gap-1">
                  {splitInfo.amounts.map((amt, i) => {
                    const st = splitInfo.statuses?.[i]
                    const isPaid = st === 'paid'
                    const isSent = st === 'sent'
                    return (
                      <div key={i} className="flex justify-between items-center text-xs">
                        <span className="text-[var(--text-4)]">분할 {i + 1}/{splitInfo.count}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[var(--text-2)] tabular-nums">{formatWon(amt)}</span>
                          {isPaid ? (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md" style={{ background: 'var(--blue-dim)', color: 'var(--blue)' }} title="결제 완료">
                              <Send className="w-3 h-3" style={{ transform: 'rotate(180deg)' }} />
                            </span>
                          ) : isSent ? (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md" style={{ background: 'var(--orange-dim)', color: 'var(--scheduled-text)' }} title="발송됨 (미결제)">
                              <Mail className="w-3 h-3" />
                            </span>
                          ) : (
                            <span className="inline-block w-5 h-5" />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {state === 'success' && (
            <div className="flex items-center justify-center gap-2 p-4 bg-[var(--green-dim)] rounded-xl">
              <Check className="w-5 h-5 text-[var(--paid-text)]" />
              <span className="text-sm font-bold text-[var(--paid-text)]">{successLabel}</span>
            </div>
          )}

          {state === 'error' && (
            <div className="flex items-start gap-2 p-3 bg-[var(--red-dim)] rounded-xl">
              <AlertTriangle className="w-4 h-4 text-[var(--red)] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[var(--red)]">실패</p>
                <p className="text-xs text-[var(--text-3)] mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}

          {(state === 'confirming-destroy' || state === 'confirming-cancel' || state === 'confirming-reissue' || state === 'confirming-resend') && (
            <div className="flex items-start gap-2 p-3 bg-[var(--orange-dim)] rounded-xl">
              <AlertTriangle className="w-4 h-4 text-[var(--scheduled-text)] shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--scheduled-text)]">
                {state === 'confirming-destroy'
                  ? <>청구서를 <strong>파기</strong>합니다. 학부모는 더이상 이 청구서로 결제할 수 없습니다.</>
                  : state === 'confirming-cancel'
                  ? <><strong>{formatWon(amount)}</strong> 결제를 취소합니다. 학부모에게 환불 처리됩니다.</>
                  : state === 'confirming-resend'
                  ? <>같은 청구서 링크로 <strong>카톡 알림을 다시 보냅니다</strong>. 결제 금액과 bill_id는 그대로입니다.</>
                  : <>기존 청구서를 파기하고 <strong>새 청구서를 발송</strong>합니다. 학부모 카톡에 새 결제 링크가 전송됩니다.</>}
              </p>
            </div>
          )}

          {state === 'confirming-sms' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-[var(--orange-dim)] rounded-xl">
                <AlertTriangle className="w-4 h-4 text-[var(--scheduled-text)] shrink-0 mt-0.5" />
                <p className="text-sm text-[var(--scheduled-text)]">
                  <strong>{studentName}</strong> 학부모(<strong>{phone}</strong>)에게 아래 본문 그대로 문자가 발송됩니다. 정말 보낼까요?
                </p>
              </div>
              <div className="bg-[var(--bg-elevated)] rounded-xl p-3 max-h-48 overflow-y-auto">
                <p className="text-[13px] text-[var(--text-2)] whitespace-pre-wrap break-words">{smsText.trim()}</p>
              </div>
            </div>
          )}

          {state === 'configuring-split' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--text-2)]">분할 개수</span>
                <div className="flex gap-1">
                  {[2, 3, 4].map(n => (
                    <TButton
                      key={n}
                      type="button"
                      onClick={() => setParts(n as 2 | 3 | 4)}
                      className={`w-10 h-9 rounded-lg text-sm font-bold transition-colors ${
                        parts === n
                          ? 'bg-[var(--blue)] text-[var(--on-action)]'
                          : 'bg-[var(--bg-elevated)] text-[var(--text-3)] hover:bg-[var(--border-light)]'
                      }`}
                    >
                      {n}
                    </TButton>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                {Array.from({ length: parts }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-4)] w-10 shrink-0">{i + 1}/{parts}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={splitAmounts[i] ? formatNumber(parseInt(splitAmounts[i])) : ''}
                      onChange={e => updateSplitAmount(i, e.target.value)}
                      placeholder="0"
                      className="flex-1 px-3 py-2 border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-1)] rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                    />
                    <span className="text-xs text-[var(--text-4)] w-4">원</span>
                  </div>
                ))}
              </div>
              <div className={`flex justify-between text-sm rounded-lg px-3 py-2 ${splitValid ? 'bg-[var(--green-dim)] text-[var(--paid-text)]' : 'bg-[var(--red-dim)] text-[var(--red)]'}`}>
                <span>합계</span>
                <span className="font-bold">
                  {formatWon(splitTotal)} / {formatWon(amount)}
                </span>
              </div>
              <p className="text-xs text-[var(--text-4)] leading-relaxed">
                ・ 기존 청구서는 파기되고 새로 <strong>{parts}개</strong> 청구서가 발송됩니다<br />
                ・ 다음 달도 이 분할 방식 그대로 자동 발송됩니다
              </p>
            </div>
          )}

          {state === 'composing-sms' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-3)]">학부모 {phone || '폰 미등록'}</span>
                <span className="text-[10px] text-[var(--text-4)] tabular-nums">{smsText.length}자</span>
              </div>
              <textarea
                value={smsText}
                onChange={e => setSmsText(e.target.value)}
                rows={14}
                maxLength={1500}
                className="w-full px-3 py-2.5 bg-[var(--bg-elevated)] rounded-lg text-[13px] text-[var(--text-1)] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--blue)] resize-none whitespace-pre-wrap break-words"
              />
              <p className="text-[11px] text-[var(--text-4)] leading-relaxed">
                ・ 본문 그대로 발송됩니다 ({MESSAGE_PREFIX.trim()} 자동 부착 없음)<br />
                ・ {SMS_SENDER_NUMBER ? `발신번호 ${SMS_SENDER_NUMBER}, ` : ''}통신사가 [Web발신] 헤더 자동 부착
              </p>
            </div>
          )}

          {state !== 'success' && (
            <div className="flex flex-col gap-2">
              {(state === 'confirming-destroy' || state === 'confirming-cancel' || state === 'confirming-reissue' || state === 'confirming-resend') ? (
                <div className="flex gap-2">
                  <TButton
                    onClick={() => setState('idle')}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold bg-[var(--bg-elevated)] text-[var(--text-3)] hover:bg-[var(--border-light)]"
                  >
                    돌아가기
                  </TButton>
                  <TButton
                    onClick={() => submit(
                      state === 'confirming-destroy' ? 'destroy' :
                      state === 'confirming-cancel' ? 'cancel' :
                      state === 'confirming-resend' ? 'resend' :
                      'reissue'
                    )}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-[var(--on-action)] hover:opacity-90"
                    style={{ background: (state === 'confirming-reissue' || state === 'confirming-resend') ? 'var(--blue)' : 'var(--red)' }}
                  >
                    확인, 진행합니다
                  </TButton>
                </div>
              ) : state === 'configuring-split' ? (
                <div className="flex gap-2">
                  <TButton
                    onClick={() => setState('idle')}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold bg-[var(--bg-elevated)] text-[var(--text-3)] hover:bg-[var(--border-light)]"
                  >
                    돌아가기
                  </TButton>
                  <TButton
                    onClick={submitSplit}
                    disabled={!splitValid}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-[var(--on-action)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'var(--blue)' }}
                  >
                    {parts}건 분할 결제
                  </TButton>
                </div>
              ) : state === 'composing-sms' ? (
                <div className="flex gap-2">
                  <TButton
                    onClick={() => setState('idle')}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold bg-[var(--bg-elevated)] text-[var(--text-3)] hover:bg-[var(--border-light)]"
                  >
                    돌아가기
                  </TButton>
                  <TButton
                    onClick={() => setState('confirming-sms')}
                    disabled={!smsText.trim() || !phone}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-[var(--on-action)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'var(--blue)' }}
                  >
                    문자 발송
                  </TButton>
                </div>
              ) : state === 'confirming-sms' ? (
                <div className="flex gap-2">
                  <TButton
                    onClick={() => setState('composing-sms')}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold bg-[var(--bg-elevated)] text-[var(--text-3)] hover:bg-[var(--border-light)]"
                  >
                    돌아가기
                  </TButton>
                  <TButton
                    onClick={submitSms}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-[var(--on-action)] hover:opacity-90"
                    style={{ background: 'var(--blue)' }}
                  >
                    확인, 발송합니다
                  </TButton>
                </div>
              ) : state === 'submitting' ? (
                <TButton disabled className="py-3 rounded-xl text-sm font-bold bg-[var(--blue)] text-[var(--on-action)] opacity-70 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> 처리 중...
                </TButton>
              ) : (
                <>
                  {canDestroy && (
                    <>
                      <TButton
                        onClick={() => setState('confirming-resend')}
                        className="w-full py-3 rounded-xl text-sm font-bold bg-[var(--blue)] text-[var(--on-action)] hover:opacity-90 flex items-center justify-center gap-2"
                      >
                        <Bell className="w-4 h-4" />
                        재발송 (카톡 다시 보내기)
                      </TButton>
                      <TButton
                        onClick={openSmsCompose}
                        disabled={!phone}
                        className="w-full py-3 rounded-xl text-sm font-bold bg-[var(--bg-elevated)] text-[var(--text-2)] hover:bg-[var(--border-light)] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={phone ? '학부모 폰으로 미납 안내 문자 발송' : '학부모 폰 미등록'}
                      >
                        <MessageSquare className="w-4 h-4" />
                        미납 안내 문자 (학부모 폰)
                      </TButton>
                      <TButton
                        onClick={() => setState('confirming-reissue')}
                        className="w-full py-3 rounded-xl text-sm font-bold bg-[var(--bg-elevated)] text-[var(--text-2)] hover:bg-[var(--border-light)] flex items-center justify-center gap-2"
                      >
                        <RefreshCw className="w-4 h-4" />
                        파기 후 재발송 (새 청구서)
                      </TButton>
                      {canSplit && (
                        <TButton
                          onClick={() => {
                            const perPart = Math.floor(amount / 3)
                            const lastAdjust = amount - perPart * 3
                            setSplitAmounts([String(perPart), String(perPart), String(perPart + lastAdjust)])
                            setParts(3)
                            setState('configuring-split')
                          }}
                          className="w-full py-3 rounded-xl text-sm font-bold bg-[var(--bg-elevated)] text-[var(--text-2)] hover:bg-[var(--border-light)] flex items-center justify-center gap-2"
                        >
                          <Split className="w-4 h-4" />
                          분할결제로 변경
                        </TButton>
                      )}
                      <TButton
                        onClick={() => setState('confirming-destroy')}
                        className="w-full py-3 rounded-xl text-sm font-bold bg-[var(--red-dim)] text-[var(--red)] hover:opacity-90 flex items-center justify-center gap-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        청구서 파기만 (발송 취소)
                      </TButton>
                    </>
                  )}
                  {canCancel && (
                    <TButton
                      onClick={() => setState('confirming-cancel')}
                      className="w-full py-3 rounded-xl text-sm font-bold bg-[var(--red-dim)] text-[var(--red)] hover:opacity-90 flex items-center justify-center gap-2"
                    >
                      <Undo2 className="w-4 h-4" />
                      결제 취소 (환불)
                    </TButton>
                  )}
                  {!canDestroy && !canCancel && (
                    <p className="text-center text-sm text-[var(--text-4)] py-4">
                      현재 상태에서 수행할 수 있는 작업이 없습니다
                    </p>
                  )}
                  <TButton
                    onClick={onClose}
                    className="w-full py-3 rounded-xl text-sm font-semibold bg-[var(--bg-elevated)] text-[var(--text-3)] hover:bg-[var(--border-light)]"
                  >
                    닫기
                  </TButton>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </AnimatedModal>
  )
}
