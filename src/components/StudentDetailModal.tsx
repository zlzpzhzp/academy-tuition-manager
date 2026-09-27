'use client'

import { toast } from 'sonner'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAnimatedClose } from '@/lib/useAnimatedClose'
import { X, Pencil, Trash2, Plus, CreditCard, Calculator, LogOut, Check, Calendar } from 'lucide-react'
import { TButton } from '@/components/motion'
import AnimatedModal from '@/components/ui/AnimatedModal'
import type { Student, Payment, Grade, Class } from '@/types'
import { formatWon, formatClassName } from '@/lib/format'
import { getStudentFee, calcRefund, parseClassDays, DAY_LABELS, PAYMENT_METHOD_LABELS, CASH_RECEIPT_LABELS, getPaymentStatus, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS, getLastClassDate } from '@/types'
import StudentModal from '@/components/StudentModal'
import PaymentModal from '@/components/PaymentModal'
import DayOfMonthPicker from '@/components/DayOfMonthPicker'
import DatePickerPopup from '@/components/payments/DatePickerPopup'
import { StudentDetailSkeleton } from '@/components/Skeleton'
import Student360Section from '@/components/Student360Section'
import EmptyState from '@/components/ui/EmptyState'
import { safeFetch, safeMutate, getTodayString } from '@/lib/utils'

interface Props {
  studentId: string
  onClose: () => void
  onChange?: () => void
}

export default function StudentDetailModal({ studentId, onClose: onCloseRaw, onChange }: Props) {
  // close 애니메이션 트리거 — 240ms exit 후 부모 onClose
  const { closing, onClose } = useAnimatedClose(onCloseRaw)
  const [student, setStudent] = useState<Student | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  // 월별 요금 스냅샷 — 과거 달 상태 판정은 그 달 요금으로 (요금 인상 시 과거 표시 안 뒤바뀌게, 2026-07-02)
  const [feeSnaps, setFeeSnaps] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    fetch(`/api/fee-snapshots?student_id=${studentId}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((rows: { month: string; fee: number }[]) => {
        if (Array.isArray(rows)) setFeeSnaps(new Map(rows.map(r => [r.month, r.fee])))
      })
      // 실패를 삼키면 '스냅샷 없음'과 구분이 안 돼 과거 달 금액 판정이 조용히 현재 요금으로 틀어진다 (2026-08-13 라인리뷰)
      .catch(() => toast.error('요금 스냅샷을 불러오지 못했습니다 — 과거 달 완납/미납 표시가 부정확할 수 있습니다'))
  }, [studentId])
  const [grades, setGrades] = useState<(Grade & { classes: Class[] })[]>([])
  const [loading, setLoading] = useState(true)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showRefundCalc, setShowRefundCalc] = useState(false)
  const [refundDate, setRefundDate] = useState(getTodayString())
  const [refundPickerOpen, setRefundPickerOpen] = useState(false)
  const refundDateBtnRef = useRef<HTMLButtonElement>(null)
  // 퇴원 처리 — 마지막 수업일 달력 선택 (prompt 타이핑 대체, 2026-07-03)
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false)
  const [withdrawLastDate, setWithdrawLastDate] = useState(getTodayString())
  const [withdrawPickerOpen, setWithdrawPickerOpen] = useState(false)
  const withdrawDateBtnRef = useRef<HTMLButtonElement>(null)
  const [memoValue, setMemoValue] = useState('')
  const [memoColor, setMemoColor] = useState<'yellow' | 'green' | 'red' | null>(null)
  const [memoSaving, setMemoSaving] = useState(false)
  const [memoSavedFlash, setMemoSavedFlash] = useState(false)
  const [electivesSaving, setElectivesSaving] = useState(false)
  const [electivesDueDay, setElectivesDueDay] = useState<number | null>(null)
  const [electivesDueSaving, setElectivesDueSaving] = useState(false)
  const [electivesDueFlash, setElectivesDueFlash] = useState(false)
  const [showElectivesDuePicker, setShowElectivesDuePicker] = useState(false)
  // 정규(메인) 결제일 — 선택과목 결제일과 같은 패턴으로 인라인 편집
  const [paymentDueDay, setPaymentDueDay] = useState<number | null>(null)
  const [paymentDueSaving, setPaymentDueSaving] = useState(false)
  const [paymentDueFlash, setPaymentDueFlash] = useState(false)
  const [showPaymentDuePicker, setShowPaymentDuePicker] = useState(false)

  const fetchData = useCallback(async () => {
    const [studentResult, paymentsResult] = await Promise.all([
      safeFetch<Student>(`/api/students/${studentId}`),
      safeFetch<Payment[]>(`/api/payments?student_id=${studentId}`),
    ])
    if (studentResult.error) {
      setLoading(false)
      return
    }
    setStudent(studentResult.data)
    setPayments(paymentsResult.data ?? [])
    setMemoValue(studentResult.data?.memo ?? '')
    setMemoColor(studentResult.data?.memo_color ?? null)
    setElectivesDueDay(studentResult.data?.electives_payment_due_day ?? null)
    setPaymentDueDay(studentResult.data?.payment_due_day ?? null)
    setLoading(false)
  }, [studentId])

  const handleSavePaymentDue = async (day: number | null) => {
    if (paymentDueSaving) return
    const prev = paymentDueDay
    setPaymentDueDay(day)
    setPaymentDueSaving(true)
    const { error } = await safeMutate(`/api/students/${studentId}`, 'PUT', { payment_due_day: day })
    setPaymentDueSaving(false)
    // 낙관 반영은 실패 시 되돌린다 — 안 돌리면 화면은 새 결제일, DB는 옛 결제일 (미납/예정 판정 기준이 갈림)
    if (error) { setPaymentDueDay(prev); toast.error(`저장 실패: ${error}`); return }
    setPaymentDueFlash(true)
    setTimeout(() => setPaymentDueFlash(false), 1200)
    await fetchData()
    notifyChange()
  }

  const handleToggleElective = async (name: string) => {
    if (!student || electivesSaving) return
    const current = student.electives ?? []
    const next = current.includes(name) ? current.filter(e => e !== name) : [...current, name]
    setElectivesSaving(true)
    const { error } = await safeMutate(`/api/students/${studentId}`, 'PUT', { electives: next })
    setElectivesSaving(false)
    if (error) { toast.error(`선택과목 저장 실패: ${error}`); return }
    await fetchData()
    notifyChange()
  }

  const handleSaveElectivesDue = async (day: number | null) => {
    if (electivesDueSaving) return
    const prev = electivesDueDay
    setElectivesDueDay(day)
    setElectivesDueSaving(true)
    const { error } = await safeMutate(`/api/students/${studentId}`, 'PUT', { electives_payment_due_day: day })
    setElectivesDueSaving(false)
    if (error) { setElectivesDueDay(prev); toast.error(`저장 실패: ${error}`); return }
    setElectivesDueFlash(true)
    setTimeout(() => setElectivesDueFlash(false), 1200)
    await fetchData()
    notifyChange()
  }

  const handleSaveMemo = async () => {
    if (memoSaving) return // Enter 연타 동시 PUT 방지 (2026-07-10 전수점검 C13)
    setMemoSaving(true)
    const memo = memoValue.trim() || null
    const { error } = await safeMutate(`/api/students/${studentId}`, 'PUT', { memo, memo_color: memoColor })
    setMemoSaving(false)
    if (error) { toast.error(`저장 실패: ${error}`); return }
    setMemoSavedFlash(true)
    setTimeout(() => setMemoSavedFlash(false), 1200)
    await fetchData()
    notifyChange()
  }

  const ensureGrades = useCallback(async () => {
    if (grades.length > 0) return
    const { data } = await safeFetch<(Grade & { classes: Class[] })[]>('/api/grades')
    setGrades(data ?? [])
  }, [grades.length])

  useEffect(() => { fetchData() }, [fetchData])


  const notifyChange = () => { onChange?.() }

  const handleUpdateStudent = async (data: Partial<Student>) => {
    const { error } = await safeMutate(`/api/students/${studentId}`, 'PUT', data)
    if (error) { toast.error(`수정 실패: ${error}`); return }
    setShowEditModal(false)
    await fetchData()
    notifyChange()
  }

  const handleDeleteStudent = async () => {
    if (!confirm(`"${student?.name}" 학생을 삭제하시겠습니까?`)) return
    const { error } = await safeMutate(`/api/students/${studentId}`, 'DELETE')
    if (error) { toast.error(`삭제 실패: ${error}`); return }
    notifyChange()
    onClose()
  }

  // 2026-07-03 사용자 지시: prompt() 타이핑 입력 → 달력 피커로 교체
  const handleWithdraw = async () => {
    if (!student) return
    // 마지막 수업일 + 1일 = withdrawal_date (그 다음날부터 미수강 처리)
    // 이렇게 저장하면 getLastClassDate(withdrawal_date, class_days)가 입력한 마지막 수업일을 반환
    // new Date('YYYY-MM-DD')는 UTC 자정 파싱이라 로컬 getter와 혼용하면 KST 밖 기기에서 하루 밀린다
    // — 같은 파일의 환불 계산과 동일하게 split 파싱 (2026-08-13 라인리뷰)
    const [wy, wm, wd] = withdrawLastDate.split('-').map(Number)
    if (!wy || !wm || !wd) { toast.error('마지막 수업일을 선택해주세요'); return }
    const withdrawalDate = new Date(wy, wm - 1, wd + 1)
    const withdrawalStr = `${withdrawalDate.getFullYear()}-${String(withdrawalDate.getMonth() + 1).padStart(2, '0')}-${String(withdrawalDate.getDate()).padStart(2, '0')}`
    const { error } = await safeMutate(`/api/students/${studentId}`, 'PUT', { withdrawal_date: withdrawalStr })
    if (error) { toast.error(`퇴원 처리 실패: ${error}`); return }
    setWithdrawConfirmOpen(false)
    await fetchData()
    notifyChange()
  }

  const handleReenroll = async () => {
    const { error } = await safeMutate(`/api/students/${studentId}`, 'PUT', { withdrawal_date: null })
    if (error) { toast.error(`재등록 실패: ${error}`); return }
    await fetchData()
    notifyChange()
  }

  const handleSavePayment = async (data: Partial<Payment>) => {
    const { data: created, error } = await safeMutate<Payment>('/api/payments', 'POST', data)
    if (error) { toast.error(`납부 기록 실패: ${error}`); return }
    await fetchData()
    notifyChange()
    return created ? { id: created.id } : undefined
  }

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm('이 납부 기록을 삭제하시겠습니까?')) return
    const { error } = await safeMutate(`/api/payments/${paymentId}`, 'DELETE')
    if (error) { toast.error(`삭제 실패: ${error}`); return }
    await fetchData()
    notifyChange()
  }

  const fee = student ? getStudentFee(student, student.class as Class | undefined) : 0
  const _now = new Date()
  const currentMonth = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`
  const currentMonthPayments = payments.filter(p => p.billing_month === currentMonth)
  const currentMonthTotal = currentMonthPayments.reduce((s, p) => s + p.amount, 0)
  const status = student ? getPaymentStatus(currentMonthTotal, fee) : 'unpaid'
  const statusColors = PAYMENT_STATUS_COLORS[status]

  const classDays = student?.class?.class_days ?? null
  // refundDate = 마지막 수업일. calcRefund 입력은 "미수강 시작일" = 마지막 수업일 다음날.
  const refund = student && showRefundCalc
    ? (() => {
        const [ry, rm, rd] = refundDate.split('-').map(Number)
        const noShowStart = new Date(ry, rm - 1, rd + 1)
        return calcRefund(fee, new Date(student.enrollment_date), noShowStart, classDays, student.payment_due_day)
      })()
    : null

  const paymentsByMonth = payments.reduce<Record<string, Payment[]>>((acc, p) => {
    if (!acc[p.billing_month]) acc[p.billing_month] = []
    acc[p.billing_month].push(p)
    return acc
  }, {})

  return (
    <AnimatedModal open={!closing} onClose={onClose} variant="sheet" maxWidth="max-w-lg">
      <div className="bg-[var(--bg)]">

        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] sticky top-0 bg-[var(--bg)] z-10">
          <h2 className="font-bold text-base">{student?.name ?? '학생'}</h2>
          <TButton onClick={onClose} className="p-1 text-[var(--text-4)] hover:text-[var(--text-1)]" aria-label="닫기">
            <X className="w-5 h-5" />
          </TButton>
        </div>

        {loading ? (
          <StudentDetailSkeleton />
        ) : !student ? (
          <EmptyState title="학생을 찾을 수 없습니다" size="page" />
        ) : (
          <div className="p-4 space-y-4">
            <div data-paper-card="" className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm text-[var(--text-4)]">
                    {student.class?.grade?.name} · {student.class?.name ? formatClassName(student.class) : '반 미지정'}
                  </p>
                </div>
                <div className="flex gap-1">
                  <TButton onClick={async () => { await ensureGrades(); setShowEditModal(true) }} className="p-2 text-[var(--text-4)] hover:text-[var(--text-1)]" aria-label="학생 정보 수정">
                    <Pencil className="w-4 h-4" />
                  </TButton>
                  <TButton onClick={handleDeleteStudent} className="p-2 text-[var(--text-4)] hover:text-[var(--red)]" aria-label="학생 삭제">
                    <Trash2 className="w-4 h-4" />
                  </TButton>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-[var(--text-4)]">학교</span>
                  <p className="font-medium">
                    {(student.school ?? '').trim() || <span className="text-[var(--scheduled-text)] text-xs font-semibold">미입력 — 수정(연필)에서 입력</span>}
                  </p>
                </div>
                <div>
                  <span className="text-[var(--text-4)]">첫 등원일</span>
                  <p className="font-medium">{student.enrollment_date}</p>
                </div>
                <div>
                  <span className="text-[var(--text-4)]">원비</span>
                  <p className="font-medium">{formatWon(fee)}{student.custom_fee != null && ' (개별)'}</p>
                </div>
                {student.phone && (
                  <div>
                    <span className="text-[var(--text-4)]">연락처</span>
                    <p className="font-medium">{student.phone}</p>
                  </div>
                )}
                {student.parent_phone && (
                  <div>
                    <span className="text-[var(--text-4)]">학부모</span>
                    <p className="font-medium">{student.parent_phone}</p>
                  </div>
                )}
              </div>

              {/* 결제일 — 모든 학생 (정규 + 선택과목) */}
              <div className="mt-4 space-y-2">
                <span className="text-xs text-[var(--text-4)]">결제일</span>
                <div className={`grid ${(student.electives ?? []).length > 0 ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                  <TButton
                    type="button"
                    onClick={() => setShowPaymentDuePicker(true)}
                    disabled={paymentDueSaving}
                    className={`flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border transition-all ${
                      paymentDueFlash
                        ? 'bg-[var(--paid-bg)] text-[var(--paid-text)] border-[var(--paid-text)]'
                        : paymentDueDay != null
                          ? 'bg-[var(--blue-dim)] text-[var(--blue)] border-[var(--blue)]'
                          : 'bg-[var(--bg)] text-[var(--text-4)] border-[var(--border)] hover:text-[var(--text-1)]'
                    }`}
                    aria-label="정규 결제일 선택"
                    title="정규(메인 수강) 결제일"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Calendar className="w-4 h-4 shrink-0" />
                      <span className="truncate">정규 {paymentDueDay != null ? `매월 ${paymentDueDay}일` : '미설정'}</span>
                    </span>
                    {paymentDueFlash && <Check className="w-4 h-4 shrink-0" />}
                  </TButton>
                  {(student.electives ?? []).length > 0 && (
                    <TButton
                      type="button"
                      onClick={() => setShowElectivesDuePicker(true)}
                      disabled={electivesDueSaving}
                      className={`flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border transition-all ${
                        electivesDueFlash
                          ? 'bg-[var(--paid-bg)] text-[var(--paid-text)] border-[var(--paid-text)]'
                          : electivesDueDay != null
                            ? 'bg-[var(--blue-dim)] text-[var(--blue)] border-[var(--blue)]'
                            : 'bg-[var(--bg)] text-[var(--text-4)] border-[var(--border)] hover:text-[var(--text-1)]'
                      }`}
                      aria-label="선택과목 결제일 선택"
                      title="선택과목 결제일 (비우면 정규와 동일)"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Calendar className="w-4 h-4 shrink-0" />
                        <span className="truncate">선택 {electivesDueDay != null ? `매월 ${electivesDueDay}일` : '정규와 동일'}</span>
                      </span>
                      {electivesDueFlash && <Check className="w-4 h-4 shrink-0" />}
                    </TButton>
                  )}
                </div>
              </div>

              {/* 선택과목 — 고2 전용 */}
              {student.class?.grade?.name === '고2' && (
                <div className="mt-4 space-y-2">
                  <span className="text-xs text-[var(--text-4)]">선택과목 (기하 +15만 · 확통 +20만)</span>
                  <div className="flex gap-2">
                    {['기하', '확통'].map(name => {
                      const active = (student.electives ?? []).includes(name)
                      return (
                        <TButton
                          key={name}
                          type="button"
                          onClick={() => handleToggleElective(name)}
                          disabled={electivesSaving}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                            active
                              ? 'bg-[var(--blue-dim)] text-[var(--blue)] border-[var(--blue)]'
                              : 'bg-[var(--bg)] text-[var(--text-4)] border-[var(--border)] hover:text-[var(--text-1)]'
                          } ${electivesSaving ? 'opacity-50' : ''}`}
                        >
                          {name}
                        </TButton>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 비고 인라인 편집 */}
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-4)]">비고</span>
                  <div className="flex items-center gap-2">
                    {(['yellow', 'green', 'red'] as const).map(c => {
                      const dot = c === 'yellow' ? 'bg-[var(--orange)]' : c === 'green' ? 'bg-[var(--paid-text)]' : 'bg-[var(--unpaid-text)]'
                      const active = memoColor === c
                      return (
                        <TButton
                          key={c}
                          type="button"
                          onClick={() => setMemoColor(active ? null : c)}
                          className={`w-4 h-4 rounded-full ${dot} ${active ? 'ring-2 ring-[var(--text-1)]' : 'opacity-50'}`}
                          aria-label={`색상 ${c}`}
                        />
                      )
                    })}
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={memoValue}
                    onChange={e => setMemoValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveMemo() }}
                    placeholder="학생에 대한 메모"
                    className="flex-1 px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg)] focus:outline-none focus:ring-1 focus:ring-[var(--blue)]"
                  />
                  <TButton
                    onClick={handleSaveMemo}
                    disabled={memoSaving}
                    className={`p-2 rounded-lg shrink-0 transition-all ${memoSavedFlash ? 'bg-[var(--paid-bg)] text-[var(--paid-text)] scale-110' : 'bg-[var(--blue)] text-[var(--on-action)] hover:opacity-80'}`}
                    aria-label="비고 저장"
                  >
                    <Check className="w-4 h-4" />
                  </TButton>
                </div>
              </div>

              {student.withdrawal_date ? (
                <div className="mt-4 p-3 bg-[var(--red-dim)] rounded-lg">
                  {(() => {
                    const d = getLastClassDate(new Date(student.withdrawal_date), student.class?.class_days)
                    const last = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                    return <p className="text-sm text-[var(--red)] font-medium">마지막 수업일: {last}</p>
                  })()}
                  <TButton onClick={handleReenroll} className="text-xs text-[var(--red)] underline mt-1">재등록</TButton>
                </div>
              ) : withdrawConfirmOpen ? (
                <div className="mt-4 p-3 bg-[var(--red-dim)] rounded-lg space-y-2" onClick={e => e.stopPropagation()}>
                  <p className="text-xs font-medium text-[var(--red)]">마지막 수업일 선택 (그 다음날부터 미수강 처리)</p>
                  <button
                    ref={withdrawDateBtnRef}
                    type="button"
                    onClick={() => setWithdrawPickerOpen(true)}
                    className="flex items-center gap-2 px-3 py-2 w-full border border-[var(--border)] bg-[var(--bg)] text-[var(--text-1)] rounded-lg text-sm hover:bg-[var(--bg-card-hover)] active:scale-[0.99] transition-all"
                  >
                    <Calendar className="w-4 h-4 text-[var(--text-3)]" />
                    <span className="tabular-nums">{withdrawLastDate}</span>
                  </button>
                  {withdrawPickerOpen && (
                    <DatePickerPopup
                      inlineDate={withdrawLastDate}
                      onDateChange={setWithdrawLastDate}
                      onClose={() => setWithdrawPickerOpen(false)}
                      anchorRef={withdrawDateBtnRef}
                    />
                  )}
                  <div className="flex gap-2">
                    <TButton onClick={() => setWithdrawConfirmOpen(false)} className="flex-1 py-2 rounded-lg bg-[var(--bg-card-hover)] text-[var(--text-3)] text-sm font-medium">취소</TButton>
                    <TButton onClick={handleWithdraw} className="flex-1 py-2 rounded-lg bg-[var(--unpaid-bg)] text-[var(--unpaid-text)] text-sm font-bold">퇴원 처리</TButton>
                  </div>
                </div>
              ) : (
                <TButton
                  onClick={() => { setWithdrawLastDate(getTodayString()); setWithdrawConfirmOpen(true) }}
                  className="mt-4 flex items-center gap-1 text-sm text-[var(--red)] hover:opacity-80"
                >
                  <LogOut className="w-4 h-4" /> 퇴원 처리
                </TButton>
              )}
            </div>

            {/* 학생 360 — 강사 앱·질문·성적·상담 교차 조회(읽기 전용). 기본 접힘 + 펼칠 때만 fetch (2026-08-19 지시) */}
            <Student360Section studentId={studentId} />

            <div data-paper-card="" className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm">이번달 납부현황</h3>
                <span
                  className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: statusColors.bg, color: statusColors.text }}
                  role="status"
                >
                  {PAYMENT_STATUS_LABELS[status]}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-2xl font-bold">{formatWon(currentMonthTotal)}</p>
                  <p className="text-sm text-[var(--text-4)]">/ {formatWon(fee)}</p>
                </div>
                <TButton
                  onClick={() => setShowPaymentModal(true)}
                  className="px-3 py-2 bg-[var(--blue)] text-[var(--on-action)] rounded-lg text-sm font-medium flex items-center gap-1 hover:opacity-90"
                >
                  <CreditCard className="w-4 h-4" /> 납부 기록
                </TButton>
              </div>
            </div>

            <div data-paper-card="" className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <TButton
                onClick={() => setShowRefundCalc(!showRefundCalc)}
                className="flex items-center gap-2 font-bold text-sm w-full text-left"
                aria-expanded={showRefundCalc}
              >
                <Calculator className="w-4 h-4" /> 환불 계산기
              </TButton>
              {showRefundCalc && refund && (
                <div className="mt-4 space-y-3">
                  <div>
                    <span className="block text-xs text-[var(--text-4)] mb-1">마지막 수업일</span>
                    <button
                      ref={refundDateBtnRef}
                      type="button"
                      onClick={() => setRefundPickerOpen(true)}
                      className="flex items-center gap-2 px-3 py-2 border border-[var(--border)] bg-[var(--bg)] text-[var(--text-1)] rounded-lg text-sm hover:bg-[var(--bg-card-hover)] active:scale-[0.99] transition-all"
                    >
                      <Calendar className="w-4 h-4 text-[var(--text-3)]" />
                      <span className="tabular-nums">{refundDate}</span>
                    </button>
                    {refundPickerOpen && (
                      <DatePickerPopup
                        inlineDate={refundDate || getTodayString()}
                        onDateChange={setRefundDate}
                        onClose={() => setRefundPickerOpen(false)}
                        anchorRef={refundDateBtnRef}
                        paymentDueDay={student.payment_due_day}
                      />
                    )}
                  </div>
                  {refund.isSessionBased && classDays && (
                    <div className="px-3 py-2 bg-[var(--blue-dim)] rounded-lg text-xs text-[var(--blue)]">
                      수업 요일: {parseClassDays(classDays)?.map(d => DAY_LABELS[d]).join(', ')} (수업 횟수 기반 계산)
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="p-3 bg-[var(--bg-elevated)] rounded-lg">
                      <p className="text-[var(--text-4)] text-xs">{refund.isSessionBased ? '총 수업 횟수' : '등록기간'}</p>
                      <p className="font-medium">{refund.totalSessions}{refund.isSessionBased ? '회' : '일'}</p>
                    </div>
                    <div className="p-3 bg-[var(--bg-elevated)] rounded-lg">
                      <p className="text-[var(--text-4)] text-xs">{refund.isSessionBased ? '경과 수업' : '경과일수'}</p>
                      <p className="font-medium">{refund.elapsedSessions}{refund.isSessionBased ? '회' : '일'}</p>
                    </div>
                    <div className="p-3 bg-[var(--bg-elevated)] rounded-lg">
                      <p className="text-[var(--text-4)] text-xs">{refund.isSessionBased ? '잔여 수업' : '잔여일수'}</p>
                      <p className="font-medium">{refund.remainingSessions}{refund.isSessionBased ? '회' : '일'}</p>
                    </div>
                    <div className="p-3 bg-[var(--blue-dim)] rounded-lg">
                      <p className="text-[var(--blue)] text-xs">환불 예상액</p>
                      <p className="font-bold text-[var(--blue)]">{formatWon(refund.refundAmount)}</p>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--text-4)]">
                    원비 {formatWon(fee)} × 잔여 {refund.remainingSessions}{refund.isSessionBased ? '회' : '일'} / {refund.totalSessions}{refund.isSessionBased ? '회' : '일'}
                  </p>
                </div>
              )}
            </div>

            <div data-paper-card="" className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm">납부 내역</h3>
                <TButton
                  onClick={() => setShowPaymentModal(true)}
                  className="text-sm text-[var(--blue)] font-medium flex items-center gap-1 hover:opacity-70"
                >
                  <Plus className="w-4 h-4" /> 추가
                </TButton>
              </div>

              {payments.length === 0 ? (
                <EmptyState title="납부 기록이 없습니다" size="compact" />
              ) : (
                <div className="space-y-4">
                  {Object.entries(paymentsByMonth)
                    .sort(([a], [b]) => b.localeCompare(a))
                    .map(([month, monthPayments]) => {
                      const monthTotal = monthPayments.reduce((s, p) => s + p.amount, 0)
                      const monthFee = month < currentMonth ? (feeSnaps.get(month) ?? fee) : fee
                      const monthStatus = getPaymentStatus(monthTotal, monthFee)
                      const monthStatusColors = PAYMENT_STATUS_COLORS[monthStatus]
                      return (
                        <div key={month}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-[var(--text-2)]">{month}</span>
                            <span
                              className="px-2 py-0.5 rounded-full text-xs font-medium"
                              style={{ backgroundColor: monthStatusColors.bg, color: monthStatusColors.text }}
                              role="status"
                            >
                              {formatWon(monthTotal)} · {PAYMENT_STATUS_LABELS[monthStatus]}
                            </span>
                          </div>
                          {monthPayments.map(p => (
                            <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-elevated)] group">
                              <div className="flex-1 text-sm">
                                <span className="font-medium">{formatWon(p.amount)}</span>
                                <span className="text-[var(--text-4)] ml-2">{PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS]}</span>
                                {p.cash_receipt && (
                                  <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded ${p.cash_receipt === 'issued' ? 'bg-[var(--green-dim)] text-[var(--paid-text)]' : 'bg-[var(--orange-dim)] text-[var(--scheduled-text)]'}`}>
                                    {CASH_RECEIPT_LABELS[p.cash_receipt]}
                                  </span>
                                )}
                                <span className="text-[var(--text-4)] ml-2">{p.payment_date}</span>
                                {p.memo && <span className="text-[var(--text-4)] ml-2">· {p.memo}</span>}
                              </div>
                              {/* 결제선생 건은 개별 삭제 금지 — 청구서 취소 플로우로만 (2026-07-02 지시) */}
                              {p.method !== 'payssam' && (
                                <TButton
                                  onClick={() => handleDeletePayment(p.id)}
                                  className="p-1 text-[var(--text-4)] hover:text-[var(--red)] opacity-0 group-hover:opacity-100 transition-opacity"
                                  aria-label="납부 기록 삭제"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </TButton>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          </div>
        )}

        {showEditModal && student && (
          <StudentModal
            student={student}
            grades={grades}
            onSave={handleUpdateStudent}
            onClose={() => setShowEditModal(false)}
          />
        )}

        {showPaymentModal && student && (
          <PaymentModal
            studentId={studentId}
            defaultAmount={fee}
            onSave={handleSavePayment}
            onReceiptChange={() => { fetchData(); notifyChange() }}
            onClose={() => { setShowPaymentModal(false); fetchData() }}
          />
        )}

        <DayOfMonthPicker
          open={showElectivesDuePicker}
          value={electivesDueDay}
          onChange={(d) => handleSaveElectivesDue(d)}
          onClose={() => setShowElectivesDuePicker(false)}
          title="선택과목 결제일 선택"
        />

        <DayOfMonthPicker
          open={showPaymentDuePicker}
          value={paymentDueDay}
          onChange={(d) => handleSavePaymentDue(d)}
          onClose={() => setShowPaymentDuePicker(false)}
          title="정규 결제일 선택"
        />
      </div>
    </AnimatedModal>
  )
}
