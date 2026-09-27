'use client'

import { toast } from 'sonner'
import { useState, useEffect, useCallback, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Pencil, Trash2, Plus, CreditCard, Calculator, LogOut, UserX, CalendarDays } from 'lucide-react'
import DatePickerPopup from '@/components/payments/DatePickerPopup'
import { TButton } from '@/components/motion'
import EmptyState from '@/components/ui/EmptyState'
import type { Student, Payment, Grade, Class } from '@/types'
import { formatWon, formatClassName } from '@/lib/format'
import { getStudentFee, calcRefund, parseClassDays, DAY_LABELS, PAYMENT_METHOD_LABELS, CASH_RECEIPT_LABELS, getPaymentStatus, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS } from '@/types'
import StudentModal from '@/components/StudentModal'
import PaymentModal from '@/components/PaymentModal'
import AnimatedModal from '@/components/ui/AnimatedModal'
import Student360Section from '@/components/Student360Section'
import { safeFetch, safeMutate, getTodayString } from '@/lib/utils'

export default function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [student, setStudent] = useState<Student | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [grades, setGrades] = useState<(Grade & { classes: Class[] })[]>([])
  // 월별 요금 스냅샷 — 과거 달 상태 판정은 그 달 요금으로 (요금 인상 시 과거 표시 안 뒤바뀌게, 2026-07-02)
  const [feeSnaps, setFeeSnaps] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    fetch(`/api/fee-snapshots?student_id=${id}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((rows: { month: string; fee: number }[]) => {
        if (Array.isArray(rows)) setFeeSnaps(new Map(rows.map(r => [r.month, r.fee])))
      })
      // 실패를 삼키면 '스냅샷 없음'과 구분이 안 돼 과거 달 금액 판정이 조용히 현재 요금으로 틀어진다 (2026-08-13 라인리뷰)
      .catch(() => toast.error('요금 스냅샷을 불러오지 못했습니다 — 과거 달 완납/미납 표시가 부정확할 수 있습니다'))
  }, [id])
  const [loading, setLoading] = useState(true)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  // 기존 납부에 영수증을 나중에 붙일 입구가 이 화면에 없었다 — 납부 내역 줄 탭 → 편집 모달 (2026-08-18 유재석 건)
  const [editPayment, setEditPayment] = useState<Payment | null>(null)
  const [showRefundCalc, setShowRefundCalc] = useState(false)
  const [refundDate, setRefundDate] = useState(getTodayString())
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const [withdrawDate, setWithdrawDate] = useState(getTodayString())
  const [withdrawPickerOpen, setWithdrawPickerOpen] = useState(false)
  const withdrawDateBtnRef = useRef<HTMLButtonElement>(null)

  const fetchData = useCallback(async () => {
    const [studentResult, paymentsResult] = await Promise.all([
      safeFetch<Student>(`/api/students/${id}`),
      safeFetch<Payment[]>(`/api/payments?student_id=${id}`),
    ])
    if (studentResult.error) {
      setLoading(false)
      return
    }
    setStudent(studentResult.data)
    setPayments(paymentsResult.data ?? [])
    setLoading(false)
  }, [id])

  const ensureGrades = useCallback(async () => {
    if (grades.length > 0) return
    const { data } = await safeFetch<(Grade & { classes: Class[] })[]>('/api/grades')
    setGrades(data ?? [])
  }, [grades.length])

  useEffect(() => { fetchData() }, [fetchData])

  const handleUpdateStudent = async (data: Partial<Student>) => {
    const { data: saved, error } = await safeMutate<{ _codeConflict?: 'none' | 'middle' | 'both'; _attendanceCode?: string }>(`/api/students/${id}`, 'PUT', data)
    if (error) {
      toast.error(`수정 실패: ${error}`)
      return
    }
    if (saved?._codeConflict === 'middle') toast.warning(`출결코드 뒷자리가 중복되어 가운데 번호 ${saved._attendanceCode}로 등록했습니다`)
    else if (saved?._codeConflict === 'both') toast.error(`출결코드가 뒷자리·가운데 모두 중복됩니다. 수동 확인 필요 (현재 ${saved._attendanceCode})`)
    setShowEditModal(false)
    fetchData()
  }

  const handleDeleteStudent = async () => {
    if (!confirm(`"${student?.name}" 학생을 삭제하시겠습니까?`)) return
    const { error } = await safeMutate(`/api/students/${id}`, 'DELETE')
    if (error) {
      toast.error(`삭제 실패: ${error}`)
      return
    }
    router.push('/payments')
  }

  const handleWithdraw = () => {
    if (!student) return
    setWithdrawDate(getTodayString())
    setShowWithdrawModal(true)
  }

  const submitWithdraw = async () => {
    if (!withdrawDate) return
    const { error } = await safeMutate(`/api/students/${id}`, 'PUT', { withdrawal_date: withdrawDate })
    if (error) {
      toast.error(`퇴원 처리 실패: ${error}`)
      return
    }
    setShowWithdrawModal(false)
    fetchData()
  }

  const handleReenroll = async () => {
    const { error } = await safeMutate(`/api/students/${id}`, 'PUT', { withdrawal_date: null })
    if (error) {
      toast.error(`재등록 실패: ${error}`)
      return
    }
    fetchData()
  }

  const handleSavePayment = async (data: Partial<Payment>) => {
    const { data: created, error } = await safeMutate<Payment>('/api/payments', 'POST', data)
    if (error) {
      toast.error(`납부 기록 실패: ${error}`)
      return
    }
    fetchData()
    // 모달은 새 결제 케이스에선 영수증 업로드 위해 자동으로 닫지 않음 (PaymentModal이 자체 관리)
    return created ? { id: created.id } : undefined
  }

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm('이 납부 기록을 삭제하시겠습니까?')) return
    const { error } = await safeMutate(`/api/payments/${paymentId}`, 'DELETE')
    if (error) {
      toast.error(`삭제 실패: ${error}`)
      return
    }
    fetchData()
  }

  const handleUpdatePayment = async (paymentId: string, data: Partial<Payment>) => {
    const { error } = await safeMutate(`/api/payments/${paymentId}`, 'PUT', data)
    if (error) {
      toast.error(`수정 실패: ${error}`)
      return
    }
    setEditPayment(prev => (prev && prev.id === paymentId ? { ...prev, ...data } as Payment : prev))
    fetchData()
  }

  if (loading) return <div className="text-center py-12 text-[var(--text-4)]">로딩 중...</div>
  if (!student) return <EmptyState icon={UserX} title="학생을 찾을 수 없습니다" size="page" />


  const fee = getStudentFee(student, student.class as Class | undefined)
  const _now = new Date()
  const currentMonth = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`
  const currentMonthPayments = payments.filter(p => p.billing_month === currentMonth)
  const currentMonthTotal = currentMonthPayments.reduce((s, p) => s + p.amount, 0)
  const status = getPaymentStatus(currentMonthTotal, fee)
  const statusColors = PAYMENT_STATUS_COLORS[status]

  const classDays = student.class?.class_days ?? null
  const refund = showRefundCalc
    ? calcRefund(fee, new Date(student.enrollment_date), new Date(refundDate), classDays, student.payment_due_day)
    : null

  const paymentsByMonth = payments.reduce<Record<string, Payment[]>>((acc, p) => {
    if (!acc[p.billing_month]) acc[p.billing_month] = []
    acc[p.billing_month].push(p)
    return acc
  }, {})

  return (
    <div>
      <TButton onClick={() => router.back()} className="flex items-center gap-1 text-sm text-[var(--text-3)] mb-4 hover:text-[var(--text-2)]" aria-label="돌아가기">
        <ArrowLeft className="w-4 h-4" /> 돌아가기
      </TButton>

      {/* 학생 정보 카드 */}
      <div data-paper-card="" className="bg-[var(--bg-card)] rounded-xl border p-5 mb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold">{student.name}</h1>
            <p className="text-sm text-[var(--text-4)] mt-1">
              {student.class?.grade?.name} · {student.class?.name ? formatClassName(student.class) : '반 미지정'}
            </p>
          </div>
          <div className="flex gap-1">
            <TButton onClick={async () => { await ensureGrades(); setShowEditModal(true) }} className="p-2 text-[var(--text-4)] hover:text-[var(--text-3)]" aria-label="학생 정보 수정">
              <Pencil className="w-4 h-4" />
            </TButton>
            <TButton onClick={handleDeleteStudent} className="p-2 text-[var(--text-4)] hover:text-[var(--unpaid-text)]" aria-label="학생 삭제">
              <Trash2 className="w-4 h-4" />
            </TButton>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
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
          <div>
            <span className="text-[var(--text-4)]">정규 결제일</span>
            <p className="font-medium">{student.payment_due_day != null ? `매월 ${student.payment_due_day}일` : '미설정'}</p>
          </div>
          {(student.electives ?? []).length > 0 && (
            <div>
              <span className="text-[var(--text-4)]">선택과목 결제일</span>
              <p className="font-medium">{student.electives_payment_due_day != null ? `매월 ${student.electives_payment_due_day}일` : '정규와 동일'}</p>
            </div>
          )}
        </div>

        {student.withdrawal_date ? (
          <div className="mt-4 p-3 bg-[var(--unpaid-bg)] rounded-lg">
            <p className="text-sm text-[var(--unpaid-text)] font-medium">퇴원: {student.withdrawal_date}</p>
            <TButton onClick={handleReenroll} className="text-xs text-[var(--unpaid-text)] underline mt-1 opacity-80">재등록</TButton>
          </div>
        ) : (
          <TButton
            onClick={handleWithdraw}
            className="mt-4 flex items-center gap-1 text-sm text-[var(--unpaid-text)] hover:opacity-80 transition-opacity"
          >
            <LogOut className="w-4 h-4" /> 퇴원 처리
          </TButton>
        )}
      </div>

      {/* 학생 360 — 강사 앱·질문·성적·상담 교차 조회(읽기 전용). 기본 접힘 + 펼칠 때만 fetch (2026-08-19 지시) */}
      <div className="mb-4">
        <Student360Section studentId={id} />
      </div>

      {/* 이번달 납부 현황 */}
      <div data-paper-card="" className="bg-[var(--bg-card)] rounded-xl border p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-sm">이번달 납부현황</h2>
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
            onClick={() => { setEditPayment(null); setShowPaymentModal(true) }}
            className="px-3 py-2 bg-[var(--blue)] text-[var(--on-action)] rounded-lg text-sm font-medium flex items-center gap-1 hover:opacity-90 transition-opacity"
          >
            <CreditCard className="w-4 h-4" /> 납부 기록
          </TButton>
        </div>
      </div>

      {/* 환불 계산기 */}
      <div data-paper-card="" className="bg-[var(--bg-card)] rounded-xl border p-5 mb-4">
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
              <label className="block text-xs text-[var(--text-4)] mb-1" htmlFor="refund-date">퇴원 예정일</label>
              <input
                id="refund-date"
                type="date"
                value={refundDate}
                onChange={e => setRefundDate(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              />
            </div>
            {refund.isSessionBased && classDays && (
              <div className="px-3 py-2 bg-[var(--blue-bg)] rounded-lg text-xs text-[var(--blue)]">
                수업 요일: {parseClassDays(classDays)?.map(d => DAY_LABELS[d]).join(', ')} (수업 횟수 기반 계산)
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-[var(--bg-card-hover)] rounded-lg">
                <p className="text-[var(--text-4)] text-xs">{refund.isSessionBased ? '총 수업 횟수' : '등록기간'}</p>
                <p className="font-medium">{refund.totalSessions}{refund.isSessionBased ? '회' : '일'}</p>
              </div>
              <div className="p-3 bg-[var(--bg-card-hover)] rounded-lg">
                <p className="text-[var(--text-4)] text-xs">{refund.isSessionBased ? '경과 수업' : '경과일수'}</p>
                <p className="font-medium">{refund.elapsedSessions}{refund.isSessionBased ? '회' : '일'}</p>
              </div>
              <div className="p-3 bg-[var(--bg-card-hover)] rounded-lg">
                <p className="text-[var(--text-4)] text-xs">{refund.isSessionBased ? '잔여 수업' : '잔여일수'}</p>
                <p className="font-medium">{refund.remainingSessions}{refund.isSessionBased ? '회' : '일'}</p>
              </div>
              <div className="p-3 bg-[var(--blue-bg)] rounded-lg">
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

      {/* 납부 내역 */}
      <div data-paper-card="" className="bg-[var(--bg-card)] rounded-xl border p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-sm">납부 내역</h2>
          <TButton
            onClick={() => { setEditPayment(null); setShowPaymentModal(true) }}
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
                      <div
                        key={p.id}
                        onClick={() => { setEditPayment(p); setShowPaymentModal(true) }}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-card-hover)] group cursor-pointer"
                        role="button"
                        aria-label={`${formatWon(p.amount)} ${p.payment_date} 납부 편집·영수증`}
                      >
                        <div className="flex-1 text-sm">
                          <span className="font-medium">{formatWon(p.amount)}</span>
                          <span className="text-[var(--text-4)] ml-2">{PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS]}</span>
                          {p.cash_receipt && (
                            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded ${p.cash_receipt === 'issued' ? 'bg-[var(--paid-bg)] text-[var(--paid-text)]' : 'bg-[var(--scheduled-bg)] text-[var(--scheduled-text)]'}`}>
                              {CASH_RECEIPT_LABELS[p.cash_receipt]}
                            </span>
                          )}
                          <span className="text-[var(--text-4)] ml-2">{p.payment_date}</span>
                          {p.memo && <span className="text-[var(--text-4)] ml-2">· {p.memo}</span>}
                        </div>
                        {/* 결제선생 건은 개별 삭제 금지 — 청구서 취소 플로우로만 (2026-07-02 지시) */}
                        {p.method !== 'payssam' && (
                          <TButton
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleDeletePayment(p.id) }}
                            className="p-1 text-[var(--text-4)] hover:text-[var(--unpaid-text)] opacity-0 group-hover:opacity-100 transition-opacity"
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

      {showEditModal && (
        <StudentModal
          student={student}
          grades={grades}
          onSave={handleUpdateStudent}
          onClose={() => setShowEditModal(false)}
        />
      )}

      {showPaymentModal && (
        <PaymentModal
          payment={editPayment}
          studentId={id}
          defaultAmount={fee}
          onSave={handleSavePayment}
          onUpdate={handleUpdatePayment}
          onDelete={handleDeletePayment}
          onReceiptChange={fetchData}
          onClose={() => { setShowPaymentModal(false); setEditPayment(null); fetchData() }}
        />
      )}

      <AnimatedModal open={showWithdrawModal} onClose={() => setShowWithdrawModal(false)}>
        <div>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-lg font-bold text-[var(--text-1)]">퇴원 처리</h2>
            <TButton onClick={() => setShowWithdrawModal(false)} className="p-1 text-[var(--text-4)] hover:text-[var(--text-2)]" aria-label="닫기">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </TButton>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-3)] mb-2">퇴원일</label>
              {/* 2026-07-03 사용자 지시: 날짜 직접 타이핑 대신 달력 피커 */}
              <button
                ref={withdrawDateBtnRef}
                type="button"
                onClick={() => setWithdrawPickerOpen(true)}
                className="flex items-center gap-2 w-full px-3 py-3 rounded-xl bg-[var(--bg-card-hover)] border border-[var(--border)] text-[var(--text-1)] text-base hover:bg-[var(--bg-card)] active:scale-[0.99] transition-all focus:outline-none focus:border-[var(--blue)]"
              >
                <CalendarDays className="w-4 h-4 text-[var(--text-3)]" />
                <span className="tabular-nums">{withdrawDate}</span>
              </button>
              {withdrawPickerOpen && (
                <DatePickerPopup
                  inlineDate={withdrawDate || getTodayString()}
                  onDateChange={setWithdrawDate}
                  onClose={() => setWithdrawPickerOpen(false)}
                  anchorRef={withdrawDateBtnRef}
                />
              )}
              <p className="mt-2 text-xs text-[var(--text-4)]">
                퇴원 처리해도 기존 발송된 청구서는 자동 파기되지 않습니다. 필요 시 납부탭에서 별도 파기/취소 처리하세요.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <TButton onClick={() => setShowWithdrawModal(false)} className="flex-1 py-3 rounded-xl bg-[var(--bg-card-hover)] text-[var(--text-2)] font-medium">취소</TButton>
              <TButton onClick={submitWithdraw} disabled={!withdrawDate} className="flex-1 py-3 rounded-xl bg-[var(--unpaid-bg)] text-[var(--unpaid-text)] font-bold disabled:opacity-50">퇴원 처리</TButton>
            </div>
          </div>
        </div>
      </AnimatedModal>
    </div>
  )
}
