'use client'

import { toast } from 'sonner'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAnimatedClose } from '@/lib/useAnimatedClose'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Trash2, AlertTriangle, Check, Camera, ImagePlus, Loader2 } from 'lucide-react'
import type { Payment, PaymentMethod } from '@/types'
import { formatWon } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/types'
import { METHOD_OPTIONS_SHORT } from '@/lib/constants'
import { getTodayString } from '@/lib/utils'
import { compressImageToBlob } from '@/lib/compressImage'
import AnimatedModal from '@/components/ui/AnimatedModal'

interface Props {
  payment?: Payment | null
  studentId: string
  defaultBillingMonth?: string
  defaultAmount?: number
  prevMemo?: string | null
  prevMethod?: PaymentMethod | null
  /** onSave는 가능하면 저장된 payment id를 반환 — 영수증 즉시 업로드용 */
  onSave: (data: Partial<Payment>) => Promise<{ id?: string } | void> | void
  onUpdate?: (paymentId: string, data: Partial<Payment>) => Promise<void> | void
  onDelete?: (paymentId: string) => void
  /** 영수증 추가/삭제 성공 시 호출 — 부모 목록 갱신용 (2026-07-03: 갱신 누락으로 중복 업로드 사고) */
  onReceiptChange?: () => void
  onClose: () => void
}

export default function PaymentModal({ payment, studentId, defaultBillingMonth, defaultAmount, prevMemo, prevMethod, onSave, onUpdate, onDelete, onReceiptChange, onClose: onCloseRaw }: Props) {
  const today = getTodayString()
  const currentMonth = today.slice(0, 7)

  // close 애니메이션 트리거 — internal closing state로 240ms exit 후 부모 onClose
  const { closing, onClose } = useAnimatedClose(onCloseRaw)

  const [amount, setAmount] = useState(payment?.amount ? String(payment.amount) : defaultAmount ? String(defaultAmount) : '')
  // 디폴트: 카드 (결제선생은 자동 callback에서만 등록, 수동 선택 디폴트 아님)
  const [method, setMethod] = useState<PaymentMethod>(payment?.method as PaymentMethod ?? (prevMethod && prevMethod !== 'payssam' ? prevMethod : 'card'))
  const [paymentDate, setPaymentDate] = useState(payment?.payment_date ?? today)
  const [billingMonth, setBillingMonth] = useState(payment?.billing_month ?? defaultBillingMonth ?? currentMonth)
  const [memo, setMemo] = useState(payment?.memo ?? prevMemo ?? '')
  const [cashReceipt, setCashReceipt] = useState<'issued' | 'pending' | null>(payment?.cash_receipt ?? null)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showConfirmSuccess, setShowConfirmSuccess] = useState(false)
  const [editingDate, setEditingDate] = useState(false)
  const [editDate, setEditDate] = useState(payment?.payment_date ?? today)
  const [editingMemo, setEditingMemo] = useState(false)
  const [editMemo, setEditMemo] = useState(payment?.memo ?? '')
  const [editingMethod, setEditingMethod] = useState(false)
  const [editMethod, setEditMethod] = useState<PaymentMethod>(payment?.method as PaymentMethod ?? (prevMethod && prevMethod !== 'payssam' ? prevMethod : 'card'))
  const modalRef = useRef<HTMLDivElement>(null)
  const needsCashReceipt = method === 'transfer' || method === 'cash'

  const [receiptImages, setReceiptImages] = useState<string[]>(payment?.receipt_images ?? [])
  // 2026-07-26 감사: 영수증은 저장된 원본 URL이 아니라 서버가 발급한 단기 서명 URL로 표시한다.
  // (버킷을 private으로 닫아도 화면이 깨지지 않게. 삭제/식별은 계속 저장된 원본 문자열 기준)
  const [signedMap, setSignedMap] = useState<Record<string, string>>({})
  const [failedReceipts, setFailedReceipts] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  // 뷰어는 {stored(삭제 키), signed(표시용)} 쌍 — 서명 URL로 삭제를 보내면 서버(저장 원본 매칭)가 못 지운다 (2026-08-13 라인리뷰)
  const [viewImage, setViewImage] = useState<{ stored: string; signed: string } | null>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 저장 직후 영수증 업로드 가능하도록 저장된 결제 id 보관 (새 결제 케이스)
  const [savedPaymentId, setSavedPaymentId] = useState<string | null>(payment?.id ?? null)
  const effectivePaymentId = payment?.id ?? savedPaymentId

  // 표시용 서명 URL 갱신 (모달을 열 때/목록이 바뀔 때마다 새로 받는다)
  useEffect(() => {
    if (!effectivePaymentId || receiptImages.length === 0) { setSignedMap({}); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/payments/${effectivePaymentId}/receipt`)
        if (!res.ok) { toast.error('영수증을 불러오지 못했습니다'); return }
        const { signed } = await res.json() as { signed?: { stored: string; url: string }[] }
        if (cancelled || !signed) return
        setFailedReceipts([])
        setSignedMap(Object.fromEntries(signed.map(s => [s.stored, s.url])))
      } catch {
        if (!cancelled) toast.error('영수증을 불러오지 못했습니다')
      }
    })()
    return () => { cancelled = true }
  }, [effectivePaymentId, receiptImages])

  const handleReceiptFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    if (!effectivePaymentId) {
      toast.error('결제를 먼저 저장한 후 영수증을 추가해주세요')
      return
    }
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        try {
          // canvas.toBlob() 직접 사용 — fetch(dataUrl) 우회로 CSP connect-src 영향 안 받음
          const blob = await compressImageToBlob(file, 1200, 0.8)
          const fd = new FormData()
          fd.append('file', new File([blob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' }))
          const res = await fetch(`/api/payments/${effectivePaymentId}/receipt`, { method: 'POST', body: fd })
          if (res.ok) {
            const { receipt_images } = await res.json()
            setReceiptImages(receipt_images)
            onReceiptChange?.() // 부모 목록 즉시 갱신 → '영수증 등록' 배지 사라짐 (중복 업로드 방지)
          } else {
            const err = await res.json().catch(() => ({}))
            toast.error(`업로드 실패: ${err.error || res.statusText}`)
          }
        } catch (e) {
          console.error('[receipt-upload]', e)
          toast.error(`영수증 업로드 오류: ${(e as Error)?.message || '알 수 없음'}`)
        }
      }
    } finally {
      setUploading(false)
    }
  }, [effectivePaymentId, onReceiptChange])

  const handleReceiptRemove = useCallback(async (url: string) => {
    if (!effectivePaymentId) return // 새 납부 직후(저장 완료 뷰)에서도 삭제 가능해야 함 (2026-07-10 C1)
    if (!confirm('이 영수증 사진을 삭제할까요?')) return
    const res = await fetch(`/api/payments/${effectivePaymentId}/receipt`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    if (res.ok) {
      const { receipt_images } = await res.json()
      setReceiptImages(receipt_images)
      setViewImage(null)
      onReceiptChange?.()
    } else {
      toast.error('삭제 실패')
    }
  }, [effectivePaymentId, onReceiptChange])

  useEffect(() => {
    if (!needsCashReceipt) {
      setCashReceipt(null)
    } else {
      setCashReceipt(prev => prev === null ? 'pending' : prev)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method])

  // Escape 처리는 AnimatedModal(모달 스택 top 판정)이 담당 — 여기 자체 핸들러를 두면
  // 중첩 상태에서 스택 무시하고 닫혀버림 (2026-07-10 전수점검 C4에서 제거)

  const [submitting, setSubmitting] = useState(false)
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!amount || parseInt(amount) <= 0 || showSuccess || submitting) return

    // 1. API에 먼저 저장. submitting 가드 — await 중 더블탭이 중복 납부 row를 만들던 문제 (2026-07-10 전수점검)
    setSubmitting(true)
    let result: { id?: string } | void
    try {
      result = await onSave({
        student_id: studentId,
        amount: parseInt(amount),
        method,
        payment_date: paymentDate,
        billing_month: billingMonth,
        cash_receipt: needsCashReceipt ? cashReceipt : null,
        memo,
      })
    } finally {
      setSubmitting(false)
    }

    // 저장 실패(부모 onSave가 에러 토스트 후 undefined 반환) — 성공 연출 없이 폼 유지 (2026-07-10)
    if (!payment?.id && !(result && typeof result === 'object' && 'id' in result && result.id)) return

    // 새 결제: 반환된 id 보관 (영수증 input 활성화)
    if (!payment?.id && result && typeof result === 'object' && 'id' in result && result.id) {
      setSavedPaymentId(result.id)
    }

    // 2. 저장 완료 —
    //    수정 모드: 체크 애니메이션 → 1초 후 닫기 (기존 동작)
    //    새 결제: savedPaymentId 세팅으로 뷰가 '납부 완료 + 영수증 첨부' 화면으로 전환됨.
    //    (기존엔 "모달 유지 후 영수증 첨부" 의도였지만 영수증 UI가 payment prop 뷰에서만
    //     렌더돼 빈 폼 dead-end + 재제출 함정이었음 — 2026-07-10 전수점검 C1, 전용 뷰 신설)
    if (payment?.id) {
      setShowSuccess(true)
      setTimeout(() => { onClose() }, 1000)
    }
  }, [amount, showSuccess, submitting, studentId, method, paymentDate, billingMonth, needsCashReceipt, cashReceipt, memo, payment?.id, onSave, onClose])

  const handleDelete = () => {
    if (payment?.id && onDelete) {
      onDelete(payment.id)
    }
  }

  // 영수증 첨부 섹션 — 기존 납부(정보 뷰)와 새 납부 직후(저장 완료 뷰) 공용 (2026-07-10 C1)
  const receiptSection = (
    <>
            {/* 영수증 사진 — 현장 카드결제 증빙 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[var(--text-2)]">영수증 사진</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--blue-dim)] text-[var(--blue)] hover:opacity-80 disabled:opacity-50"
                    aria-label="영수증 촬영"
                  >
                    {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                    촬영
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--orange-dim)] text-[var(--orange)] hover:opacity-80 disabled:opacity-50"
                    aria-label="영수증 업로드"
                  >
                    {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImagePlus className="w-3 h-3" />}
                    업로드
                  </button>
                </div>
              </div>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={e => { handleReceiptFiles(e.target.files); e.target.value = '' }}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={e => { handleReceiptFiles(e.target.files); e.target.value = '' }}
              />
              {receiptImages.length === 0 ? (
                <div className="text-center py-4 text-xs text-[var(--text-4)] bg-[var(--bg-elevated)] rounded-lg border border-dashed border-[var(--border)]">
                  촬영 또는 업로드해서 영수증을 첨부하세요
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {receiptImages.map(url => {
                    const signed = signedMap[url]
                    // 서명 URL이 도착하기 전엔 아예 그리지 않는다. 저장된 원본 URL로 폴백하면
                    // 버킷이 private이라 404가 나고, 그 실패 상태가 그대로 굳어버린다.
                    // (2026-07-26 운영자님 신고 '이미지 로드 실패' — 첫 페인트에서 원본 URL로 그렸다가
                    //  실패 처리된 뒤, 서명 URL이 와도 화면이 복구되지 않던 문제)
                    if (!signed) {
                      return (
                        <div
                          key={url}
                          className="aspect-square rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] animate-pulse"
                        />
                      )
                    }
                    return (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setViewImage({ stored: url, signed })}
                        className="relative aspect-square overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] hover:opacity-90 transition-opacity"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          key={signed}
                          src={signed}
                          alt="영수증"
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                          onError={() => setFailedReceipts(prev => prev.includes(url) ? prev : [...prev, url])}
                        />
                        {failedReceipts.includes(url) && (
                          <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--red)] px-1 text-center bg-[var(--bg-elevated)]">
                            이미지 로드 실패
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
    </>
  )

  return (
    <AnimatedModal open={!closing} onClose={onClose} variant="sheet" maxWidth="max-w-md">
      <div ref={modalRef} className="bg-[var(--bg-card)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-card)] z-10">
          <h2 className="text-lg font-bold tracking-tight">{payment ? '납부 정보' : '납부'}</h2>
          <button onClick={onClose} aria-label="닫기" className="p-1.5 text-[var(--text-4)] hover:text-[var(--text-3)] hover:bg-[var(--bg-elevated)] rounded-lg transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* 전달 비고 내용 알림 */}
        {prevMemo && !payment && (
          <div className="mx-5 mt-4 p-3 bg-[var(--orange-dim)] border border-[var(--orange)] rounded-lg flex gap-2">
            <AlertTriangle className="w-4 h-4 text-[var(--orange)] shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-[var(--orange)]">전달 비고 내용 (자동 반영)</p>
              <p className="text-xs text-[var(--orange)] mt-0.5">{prevMemo}</p>
            </div>
          </div>
        )}
        {prevMemo && payment && (
          <div className="mx-5 mt-4 p-3 bg-[var(--orange-dim)] border border-[var(--orange)] rounded-lg flex gap-2">
            <AlertTriangle className="w-4 h-4 text-[var(--orange)] shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-[var(--orange)]">전달 비고 내용</p>
              <p className="text-xs text-[var(--orange)] mt-0.5">{prevMemo}</p>
            </div>
          </div>
        )}

        {/* 기존 납부 정보 확인 모드 */}
        {payment && !showConfirmDelete ? (
          <div className="p-5 space-y-4">
            <div className="bg-[var(--green-dim)] border border-[var(--paid-text)] rounded-xl p-4 text-center">
              <p className="text-[var(--paid-text)] font-bold text-lg">{formatWon(payment.amount)}</p>
              <p className="text-[var(--paid-text)] text-sm mt-1">납부완료</p>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-[var(--text-4)]">납부 방법</span>
                {editingMethod ? (
                  <div className="flex items-center gap-1.5">
                    <div className="flex gap-1">
                      {METHOD_OPTIONS_SHORT.map(([val, label]) => (
                        <motion.button
                          key={val}
                          type="button"
                          onClick={() => setEditMethod(val)}
                          whileTap={{ scale: 0.88 }}
                          animate={editMethod === val ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                          transition={{ duration: 0.25 }}
                          className={`px-2 py-1 rounded text-[11px] font-medium border whitespace-nowrap ${
                            editMethod === val ? 'bg-[var(--blue)] text-white border-[var(--blue)]' : 'bg-[var(--bg-card)] text-[var(--text-3)] border-[var(--border)]'
                          }`}
                        >
                          {label}
                        </motion.button>
                      ))}
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.85 }}
                      onClick={async () => {
                        if (onUpdate && payment.id && editMethod !== payment.method) {
                          await onUpdate(payment.id, { method: editMethod })
                        }
                        setEditingMethod(false)
                      }}
                      className="p-1.5 bg-[var(--blue-bg)] hover:bg-[var(--blue-dim)] text-[var(--blue)] rounded-full transition-colors"
                      aria-label="저장"
                    >
                      <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.85 }}
                      onClick={() => { setEditingMethod(false); setEditMethod(payment.method as PaymentMethod) }}
                      className="p-1 text-[var(--text-4)] hover:text-[var(--text-3)]"
                      aria-label="취소"
                    >
                      <X className="w-4 h-4" />
                    </motion.button>
                  </div>
                ) : (
                  <motion.button
                    whileTap={{ scale: 0.92 }}
                    onClick={() => setEditingMethod(true)}
                    className="font-medium hover:text-[var(--blue)] hover:underline transition-colors"
                  >
                    <motion.span
                      key={editMethod}
                      initial={{ opacity: 0, y: -4, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
                      className="inline-block"
                    >
                      {PAYMENT_METHOD_LABELS[editMethod]}
                    </motion.span>
                  </motion.button>
                )}
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-[var(--text-4)]">납부일</span>
                {editingDate ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      value={editDate}
                      onChange={e => setEditDate(e.target.value)}
                      className="px-2 py-1 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                    />
                    <motion.button
                      whileTap={{ scale: 0.85 }}
                      onClick={async () => {
                        if (onUpdate && payment.id) {
                          await onUpdate(payment.id, { payment_date: editDate })
                        }
                        setEditingDate(false)
                      }}
                      className="p-1.5 bg-[var(--blue-bg)] hover:bg-[var(--blue-dim)] text-[var(--blue)] rounded-full transition-colors"
                      aria-label="저장"
                    >
                      <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.85 }}
                      onClick={() => { setEditingDate(false); setEditDate(payment.payment_date) }}
                      className="p-1 text-[var(--text-4)] hover:text-[var(--text-3)]"
                      aria-label="취소"
                    >
                      <X className="w-4 h-4" />
                    </motion.button>
                  </div>
                ) : (
                  <motion.button
                    whileTap={{ scale: 0.92 }}
                    onClick={() => setEditingDate(true)}
                    className="font-medium hover:text-[var(--blue)] hover:underline transition-colors"
                  >
                    <motion.span
                      key={payment.payment_date}
                      initial={{ opacity: 0, y: -4, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
                      className="inline-block"
                    >
                      {payment.payment_date}
                    </motion.span>
                  </motion.button>
                )}
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-[var(--text-4)]">해당 월</span>
                <span className="font-medium">{payment.billing_month}</span>
              </div>
              {payment.cash_receipt && (
                <div className="flex justify-between py-2 border-b">
                  <span className="text-[var(--text-4)]">현금영수증</span>
                  <span className="font-medium">{payment.cash_receipt === 'issued' ? '발행완료' : '미발행'}</span>
                </div>
              )}
            </div>

            {receiptSection}

            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-[var(--text-4)] shrink-0">비고</span>
              {editingMemo ? (
                <div className="flex items-center gap-1.5 flex-1 ml-4">
                  <input
                    type="text"
                    value={editMemo}
                    onChange={e => setEditMemo(e.target.value)}
                    className="flex-1 px-2 py-1 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                    placeholder="특이사항이 있으면 입력하세요"
                    autoFocus
                  />
                </div>
              ) : (
                <button
                  onClick={() => setEditingMemo(true)}
                  className="text-sm font-medium text-right max-w-[60%] hover:text-[var(--blue)] hover:underline transition-colors text-[var(--text-4)]"
                >
                  {payment.memo || '탭하여 입력'}
                </button>
              )}
            </div>

            <motion.button
              whileTap={{ scale: 0.97 }}
              disabled={showConfirmSuccess}
              onClick={async () => {
                if (editMemo !== (payment.memo ?? '') && onUpdate && payment.id) {
                  await onUpdate(payment.id, { memo: editMemo.trim() || '' })
                }
                setShowConfirmSuccess(true)
                setTimeout(() => onClose(), 800)
              }}
              className={`w-full py-3 rounded-lg font-medium text-sm transition-all duration-500 flex items-center justify-center gap-2 ${
                showConfirmSuccess
                  ? 'bg-[var(--paid-bg)] border border-[var(--paid-text)] text-[var(--paid-text)] scale-105'
                  : 'bg-[var(--green-dim)] border border-[var(--green)] text-[var(--paid-text)] hover:bg-[var(--green-dim)]'
              }`}
            >
              {showConfirmSuccess ? (
                <span className="flex items-center gap-2 animate-[checkBounce_0.5s_ease-out]">
                  <Check className="w-6 h-6" strokeWidth={3} />
                </span>
              ) : '확인'}
            </motion.button>

            {payment.method === 'payssam' ? (
              // 결제선생 자동수납 건은 개별 삭제 금지 — 결제 취소(환불) 플로우로만 처리 (2026-07-02 지시)
              <div className="w-full py-2.5 bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-3)] rounded-lg text-sm flex items-center justify-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                결제선생 건은 청구서 결제 취소로만 처리됩니다
              </div>
            ) : (
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowConfirmDelete(true)}
                className="w-full py-2.5 bg-[var(--unpaid-bg)] border border-[var(--red-dim)] text-[var(--unpaid-text)] rounded-lg font-medium text-sm hover:opacity-80 flex items-center justify-center gap-2 transition-opacity"
              >
                <Trash2 className="w-4 h-4" />
                납부 취소
              </motion.button>
            )}
          </div>
        ) : payment && showConfirmDelete ? (
          <div className="p-5 space-y-4">
            <div className="bg-[var(--unpaid-bg)] border border-[var(--red-dim)] rounded-xl p-4 text-center">
              <p className="text-[var(--unpaid-text)] font-bold">납부 기록을 삭제하시겠습니까?</p>
              <p className="text-[var(--unpaid-text)] text-sm mt-1 opacity-80">이 작업은 되돌릴 수 없습니다</p>
            </div>
            <div className="flex gap-3">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowConfirmDelete(false)}
                className="flex-1 py-2.5 border border-[var(--border)] rounded-lg font-medium text-sm text-[var(--text-3)] hover:bg-[var(--bg-card-hover)]"
              >
                돌아가기
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleDelete}
                className="flex-1 py-2.5 bg-[var(--unpaid-bg)] border border-[var(--red-dim)] text-[var(--unpaid-text)] rounded-lg font-medium text-sm hover:opacity-80 transition-opacity"
              >
                삭제
              </motion.button>
            </div>
          </div>
        ) : savedPaymentId ? (
          /* 새 납부 저장 완료 뷰 — 영수증 즉시 첨부 후 직접 닫기 (2026-07-10 C1) */
          <div className="p-5 space-y-4">
            <div className="bg-[var(--green-dim)] border border-[var(--paid-text)] rounded-xl p-4 text-center animate-[checkBounce_0.5s_ease-out]">
              <p className="text-[var(--paid-text)] font-bold text-lg flex items-center justify-center gap-2">
                <Check className="w-5 h-5" strokeWidth={3} />
                {formatWon(parseInt(amount) || 0)} 납부 완료
              </p>
              <p className="text-[var(--paid-text)] text-xs mt-1 opacity-80">영수증 사진이 있다면 지금 바로 첨부할 수 있어요</p>
            </div>
            {receiptSection}
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={onClose}
              className="w-full py-3 rounded-lg font-medium text-sm bg-[var(--blue)] text-white hover:opacity-90"
            >
              닫기
            </motion.button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-2)] mb-1">해당 월</label>
              <input
                type="month"
                value={billingMonth}
                onChange={e => setBillingMonth(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-2)] mb-1">납부 금액 *</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                  required
                  autoFocus
                />
                <span className="text-sm text-[var(--text-4)]">원</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-2)] mb-1">납부 방법</label>
              <div className="grid grid-cols-5 gap-1.5">
                {METHOD_OPTIONS_SHORT.map(([val, label]) => (
                  <motion.button
                    key={val}
                    type="button"
                    onClick={() => setMethod(val)}
                    whileTap={{ scale: 0.9 }}
                    animate={method === val ? { scale: [1, 1.1, 1] } : { scale: 1 }}
                    transition={{ duration: 0.25 }}
                    className={`py-2 rounded-lg text-xs font-medium border whitespace-nowrap ${
                      method === val ? 'bg-[var(--blue)] text-white border-[var(--blue)]' : 'bg-[var(--bg-card)] text-[var(--text-3)] border-[var(--border)] hover:bg-[var(--bg-card-hover)]'
                    }`}
                  >
                    {label}
                  </motion.button>
                ))}
              </div>
            </div>

            {needsCashReceipt && (
              <div>
                <label className="block text-sm font-medium text-[var(--text-2)] mb-1">현금영수증</label>
                <div className="flex gap-2">
                  <motion.button
                    type="button"
                    onClick={() => setCashReceipt('issued')}
                    whileTap={{ scale: 0.95 }}
                    animate={cashReceipt === 'issued' ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                    transition={{ duration: 0.25 }}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                      cashReceipt === 'issued' ? 'bg-[var(--paid-bg)] text-[var(--paid-text)] border-[var(--paid-text)]' : 'bg-[var(--bg-card)] text-[var(--text-3)] border-[var(--border)] hover:bg-[var(--bg-card-hover)]'
                    }`}
                  >
                    발행완료
                  </motion.button>
                  <motion.button
                    type="button"
                    onClick={() => setCashReceipt('pending')}
                    whileTap={{ scale: 0.95 }}
                    animate={cashReceipt === 'pending' ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                    transition={{ duration: 0.25 }}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                      cashReceipt === 'pending' ? 'bg-[var(--scheduled-bg)] text-[var(--scheduled-text)] border-[var(--scheduled-text)]' : 'bg-[var(--bg-card)] text-[var(--text-3)] border-[var(--border)] hover:bg-[var(--bg-card-hover)]'
                    }`}
                  >
                    미발행
                  </motion.button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[var(--text-2)] mb-1">납부일</label>
              <input
                type="date"
                value={paymentDate}
                onChange={e => setPaymentDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-2)] mb-1">비고</label>
              <input
                type="text"
                value={memo}
                onChange={e => setMemo(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                placeholder="특이사항이 있으면 입력하세요"
              />
            </div>

            <motion.button
              type="submit"
              whileTap={{ scale: 0.97 }}
              disabled={showSuccess || submitting}
              className={`w-full py-3 rounded-lg font-medium text-sm transition-all duration-500 flex items-center justify-center gap-2 ${
                showSuccess
                  ? 'bg-[var(--paid-bg)] border border-[var(--paid-text)] text-[var(--paid-text)] scale-105'
                  : 'bg-[var(--blue)] text-white hover:opacity-90 disabled:opacity-60'
              }`}
            >
              {showSuccess ? (
                <span className="flex items-center gap-2 animate-[checkBounce_0.5s_ease-out]">
                  <Check className="w-6 h-6" strokeWidth={3} />
                  <span className="text-base font-bold">완료!</span>
                </span>
              ) : submitting ? '저장 중…' : '납부'}
            </motion.button>
          </form>
        )}
      </div>

      {/* 영수증 풀스크린 뷰어 — 모달 내 별도 fullscreen overlay (z-[60]) */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {viewImage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center"
              onClick={() => setViewImage(null)}
            >
              <button
                onClick={e => { e.stopPropagation(); setViewImage(null) }}
                className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full"
                aria-label="닫기"
              >
                <X className="w-5 h-5" />
              </button>
              <button
                onClick={e => { e.stopPropagation(); if (viewImage) handleReceiptRemove(viewImage.stored) }}
                className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-4 py-2 bg-[var(--unpaid-bg)] text-[var(--unpaid-text)] rounded-full font-medium text-sm shadow-lg hover:opacity-90"
                aria-label="영수증 삭제"
              >
                <Trash2 className="w-4 h-4" />
                삭제
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={viewImage.signed}
                alt="영수증"
                className="max-w-[95vw] max-h-[90vh] object-contain"
                onClick={e => e.stopPropagation()}
              />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </AnimatedModal>
  )
}
