'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { usePullToRefresh } from '@/lib/usePullToRefresh'
import { ChevronDown, Loader2, AlertCircle, Clock, PhoneOff, Lock, Download, FileText, Ban, Send } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { TButton } from '@/components/motion'
import Link from 'next/link'
import type { Student, GradeWithClasses } from '@/types'
import { formatWon, formatNumber, formatClassName } from '@/lib/format'
import { getStudentFee } from '@/types'
import { useGrades, getActiveStudents, getPaymentDueDay, swrFetcher } from '@/lib/utils'
import QuickBillSendModal from '@/components/QuickBillSendModal'
import useSWR from 'swr'

interface BillRecord {
  id: string
  student_id: string
  bill_id: string
  amount: number
  billing_month: string
  phone: string
  status: string
  short_url?: string
  appr_price?: number
  appr_dt?: string
  sent_at: string
  updated_at?: string
  is_regular_tuition?: boolean
  bill_note?: string | null
}

type ClassWithStudents = GradeWithClasses['classes'][number]
type StudentWithClass = Student & { class: ClassWithStudents }

function timeAgo(iso: string, now: number): string {
  const d = new Date(iso)
  const n = new Date(now)
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  if (!sameDay) return `${d.getMonth() + 1}/${d.getDate()}`
  const diff = Math.max(0, now - d.getTime())
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  return `${Math.floor(min / 60)}시간 전`
}

export default function BillingPage() {
  // 2026-07-07 사용자 지시: 월 선택 제거 → 전체 최신 변동순 현황판.
  // selectedMonth는 발송 대상·활성 학생 기준으로만 쓰는 현재월 고정값(월 네비 없음).
  const selectedMonth = useMemo(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }, [])
  const [expandedAction, setExpandedAction] = useState<'overdue' | 'cancelled' | 'nophone' | null>(null)
  const [showTools, setShowTools] = useState(false)
  const [nowTs, setNowTs] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])

  const { data: grades = [], isLoading: gradesLoading, mutate: mutateGrades } = useGrades<GradeWithClasses[]>()
  // month 없이 = 전체 기간을 최신 변동순으로 (연속 현황판)
  const { data: bills = [], mutate: mutateBills } = useSWR<BillRecord[]>(
    `/api/billing`,
    swrFetcher,
    { refreshInterval: 30000 }
  )

  const { data: testModeInfo } = useSWR<{ testMode: boolean }>(
    '/api/billing/test-mode',
    swrFetcher,
    { refreshInterval: 60000 }
  )

  // 납부 기록(전체) — "3일 이상 미결제" 판정에 현장(현금/이체 등) 납부를 교차 반영.
  // 청구서 status만 보면 오프라인으로 낸 학생이 영원히 미결제로 남음 (2026-07-10 전수점검 F6)
  const { data: allPayments = [] } = useSWR<{ student_id: string; billing_month: string; amount: number }[]>(
    '/api/payments',
    swrFetcher,
    { refreshInterval: 60000 }
  )
  const paidByStudentMonth = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of allPayments) {
      const k = `${p.student_id}|${p.billing_month}`
      m.set(k, (m.get(k) ?? 0) + p.amount)
    }
    return m
  }, [allPayments])

  // 청구서 발송 모달
  const [showSendModal, setShowSendModal] = useState(false)

  const allVisibleStudents = useMemo<StudentWithClass[]>(() =>
    grades.flatMap(g => g.classes.flatMap(c => {
      const active = getActiveStudents((c as ClassWithStudents).students ?? [], selectedMonth)
      return active.map(s => ({ ...s, class: c as ClassWithStudents }))
    })), [grades, selectedMonth])

  // 발송 모달용: 모든 활성 학생 (필터 미적용)
  const allForSendModal = useMemo<StudentWithClass[]>(() =>
    grades.flatMap(g => g.classes.flatMap(c => {
      const active = getActiveStudents((c as ClassWithStudents).students ?? [], selectedMonth)
      return active.map(s => ({ ...s, class: c as ClassWithStudents }))
    })), [grades, selectedMonth])

  const studentById = useMemo(() => {
    const map = new Map<string, StudentWithClass>()
    for (const s of allVisibleStudents) map.set(s.id, s)
    return map
  }, [allVisibleStudents])

  // 최근 활동 등 전체 학생 메타(필터 무관) — 과목/학년/반/원래결제일 표시용
  const studentMetaById = useMemo(() => {
    const map = new Map<string, { name: string; gradeName: string; className: string; dueDay: number }>()
    for (const g of grades) {
      for (const c of g.classes) {
        for (const s of (c as ClassWithStudents).students ?? []) {
          map.set(s.id, {
            name: s.name,
            gradeName: g.name,
            className: formatClassName(c), // 과목 병기 '수학H' — 반 이름 단독은 과목 간 구분 불가
            dueDay: s.payment_due_day ?? getPaymentDueDay(s),
          })
        }
      }
    }
    return map
  }, [grades])

  // Expanded stats — counts + amounts per status
  const stats = useMemo(() => {
    const expectedAmount = allVisibleStudents.reduce((sum, s) => sum + getStudentFee(s, s.class), 0)
    const total = allVisibleStudents.length

    // 통계 카드는 이번달 청구서만 집계 — bills는 전체기간(연속 현황판)이라 그대로 쓰면
    // 누적 발송수가 이번달 학생수를 넘어 "미발송"이 항상 0으로 붙는 기간혼합 (2026-07-10 전수점검 F5)
    const scopedBills = bills.filter(b => b.billing_month === selectedMonth)

    let sentCount = 0, paidCount = 0, cancelledCount = 0
    let sentAmount = 0, paidAmount = 0, pendingAmount = 0, cancelledAmount = 0
    // '미발송'은 학생 단위 — 학생수에서 청구서 '건수'를 빼면 정규+선택과목 2장 나간 학생이
    // 두 명 발송된 것처럼 계산돼 미발송이 실제보다 적게(0으로) 나온다 (2026-08-13 라인리뷰)
    const sentStudentIds = new Set<string>()

    for (const b of scopedBills) {
      if (b.status !== 'cancelled' && b.status !== 'destroyed') sentStudentIds.add(b.student_id)
      if (b.status === 'paid') {
        paidCount++
        paidAmount += b.appr_price ?? b.amount
        sentAmount += b.amount
        sentCount++
      } else if (b.status === 'cancelled' || b.status === 'destroyed') {
        cancelledCount++
        cancelledAmount += b.amount
      } else {
        sentCount++
        sentAmount += b.amount
        pendingAmount += b.amount
      }
    }

    const activeSent = sentCount - paidCount  // 발송됨(미결제)
    const unsent = allVisibleStudents.filter(s => !sentStudentIds.has(s.id)).length
    const paymentRate = sentCount > 0 ? Math.round((paidCount / sentCount) * 100) : 0

    return {
      total,
      expectedAmount,
      sentCount,
      paidCount,
      cancelledCount,
      activeSent,
      unsent,
      sentAmount,
      paidAmount,
      pendingAmount,
      cancelledAmount,
      paymentRate,
    }
  }, [allVisibleStudents, bills, selectedMonth])

  // 액션 필요 리스트
  const actionItems = useMemo(() => {
    const threeDays = 3 * 24 * 60 * 60 * 1000

    const overdue = bills
      .filter(b => {
        if (b.status === 'paid' || b.status === 'cancelled' || b.status === 'destroyed') return false
        // 현장 납부(현금/이체 등)로 그 달 원비가 이미 정산된 학생은 제외 —
        // 청구서 status만 보면 오프라인 납부자가 영원히 미결제로 남음 (2026-07-10 전수점검 F6)
        const paid = paidByStudentMonth.get(`${b.student_id}|${b.billing_month}`) ?? 0
        if (paid >= b.amount) return false
        return nowTs - new Date(b.sent_at).getTime() >= threeDays
      })
      .map(b => {
        const s = studentById.get(b.student_id) ?? allVisibleStudents.find(x => x.id === b.student_id)
        return { bill: b, student: s, daysSince: Math.floor((nowTs - new Date(b.sent_at).getTime()) / (24 * 60 * 60 * 1000)) }
      })
      .sort((a, b) => b.daysSince - a.daysSince)

    const cancelled = bills
      .filter(b => b.status === 'cancelled' || b.status === 'destroyed')
      .map(b => {
        const s = studentById.get(b.student_id) ?? allVisibleStudents.find(x => x.id === b.student_id)
        return { bill: b, student: s }
      })

    const noPhone = allVisibleStudents.filter(s => !(s.parent_phone || s.phone))

    return { overdue, cancelled, noPhone }
  }, [bills, allVisibleStudents, studentById, nowTs, paidByStudentMonth])

  // 발송 수납 전체 내역 — 전체 기간 최신 상태 변경순(updated_at desc). 연속 현황판의 메인.
  const recentActivity = useMemo(() => {
    return [...bills].sort((a, b) => {
      const ta = new Date(a.updated_at ?? a.sent_at ?? 0).getTime()
      const tb = new Date(b.updated_at ?? b.sent_at ?? 0).getTime()
      return tb - ta
    })
  }, [bills])

  // ─── Pull-to-refresh ──────────────────────────────────────
  // 공용 훅으로 대체 — 인라인 구현엔 try/finally가 없어 refresh 실패 시 스피너가 멈춰있던 잠재버그도 함께 해소.
  const PULL_THRESHOLD = 60
  const { containerRef, pullDistance, isRefreshing } = usePullToRefresh({
    onRefresh: () => Promise.all([mutateGrades(), mutateBills()]),
  })

  const exportCsv = useCallback(() => {
    const rows = [
      ['학생', '금액', '상태', '발송일', '결제일', 'bill_id'],
      ...bills.map(b => {
        const s = studentById.get(b.student_id)
        return [
          s?.name ?? '?',
          b.amount.toString(),
          b.status,
          b.sent_at ?? '',
          b.appr_dt ?? '',
          b.bill_id,
        ]
      }),
    ]
    const csv = '\ufeff' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // 내용이 전체기간 청구서라 월 이름을 붙이면 월별 정산 자료로 오인된다 (2026-08-13 라인리뷰)
    a.download = '결제선생_전체기간.csv'
    a.click()
    URL.revokeObjectURL(url)
  }, [bills, studentById])

  if (gradesLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-4)]" /></div>
  }

  // 2026-07-07 조용한실패 감사: `!== false`는 SWR 로딩 중(undefined)에 true로 오판 →
  // 운영 모드인데 '테스트 모드' 배지가 깜빡여 "발송 안 되는 줄" 오해 유발. 명시적 true만 테스트로.
  const isTestMode = testModeInfo?.testMode === true

  return (
    <div ref={containerRef}>
      {/* Pull-to-refresh 인디케이터 */}
      <AnimatePresence>
        {pullDistance > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: pullDistance, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="flex items-center justify-center overflow-hidden"
          >
            <motion.div
              animate={{
                rotate: isRefreshing ? 360 : (pullDistance / PULL_THRESHOLD) * 360,
                scale: pullDistance >= PULL_THRESHOLD ? 1.15 : 0.9,
              }}
              transition={isRefreshing
                ? { rotate: { duration: 0.8, repeat: Infinity, ease: 'linear' } }
                : { type: 'spring', stiffness: 200, damping: 15 }
              }
            >
              <svg className="w-6 h-6 text-[var(--text-4)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pt-2 pb-1">
        <div className="mb-3 px-1">
          <h1 className="text-2xl font-extrabold tracking-tight">
            {(() => { const d = new Date(); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][d.getDay()]}요일` })()}
          </h1>
          <p className="text-[12px] text-[var(--text-4)] mt-0.5">발송·수납 현황 · 최신순</p>
        </div>

        {/* 청구서 발송 — 메인 진입점. Border Beam(브랜드색, 은은 3.5s) 적용 (2026-07-07 dispatch) */}
        <TButton
          onClick={() => setShowSendModal(true)}
          className="border-beam w-full mt-2 flex items-center justify-center gap-2 py-3 rounded-2xl bg-[var(--blue)] text-white text-sm font-bold hover:opacity-90 active:scale-[0.98] transition-all shadow-[0_2px_12px_rgba(59,130,246,0.2)]"
          style={{ '--bb-color': '#7db3ff', '--bb-color2': '#ffffff', '--bb-duration': '4s', '--bb-width': '2px' } as React.CSSProperties}
        >
          <Send className="w-4 h-4" />
          청구서 발송하기
        </TButton>

        {isTestMode && (
          <div className="mt-3 mb-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--orange-dim)] text-[var(--orange)] text-[11px] font-semibold">
              <Lock className="w-3 h-3" /> 테스트 모드
            </span>
          </div>
        )}

        {/* 액션 필요 */}
        {(actionItems.overdue.length > 0 || actionItems.cancelled.length > 0 || actionItems.noPhone.length > 0) && (
          <div className="card overflow-hidden mb-3">
            <h2 className="text-sm font-semibold text-[var(--text-2)] px-4 pt-4 pb-2">액션 필요</h2>
            <div>
              {actionItems.overdue.length > 0 && (
                <ActionRow
                  icon={<Clock className="w-4 h-4" />}
                  color="var(--orange)"
                  bg="var(--orange-dim)"
                  label="3일 이상 미결제"
                  count={actionItems.overdue.length}
                  expanded={expandedAction === 'overdue'}
                  onToggle={() => setExpandedAction(expandedAction === 'overdue' ? null : 'overdue')}
                >
                  {actionItems.overdue.map(({ bill, student, daysSince }) => (
                    <ActionItemRow
                      key={bill.id}
                      name={student?.name ?? '?'}
                      detail={`${daysSince}일째 미결제`}
                      amount={bill.amount}
                      accent="var(--orange)"
                      irregular={bill.is_regular_tuition === false}
                      note={bill.bill_note}
                    />
                  ))}
                </ActionRow>
              )}
              {actionItems.cancelled.length > 0 && (
                <ActionRow
                  icon={<Ban className="w-4 h-4" />}
                  color="var(--red)"
                  bg="var(--red-dim)"
                  label="취소 / 파기된 청구서"
                  count={actionItems.cancelled.length}
                  expanded={expandedAction === 'cancelled'}
                  onToggle={() => setExpandedAction(expandedAction === 'cancelled' ? null : 'cancelled')}
                >
                  {actionItems.cancelled.map(({ bill, student }) => (
                    <ActionItemRow
                      key={bill.id}
                      name={student?.name ?? '?'}
                      detail={bill.status === 'destroyed' ? '파기됨' : '취소됨'}
                      amount={bill.amount}
                      accent="var(--red)"
                      irregular={bill.is_regular_tuition === false}
                      note={bill.bill_note}
                    />
                  ))}
                </ActionRow>
              )}
              {actionItems.noPhone.length > 0 && (
                <ActionRow
                  icon={<PhoneOff className="w-4 h-4" />}
                  color="var(--text-3)"
                  bg="var(--bg-elevated)"
                  label="전화번호 미등록"
                  count={actionItems.noPhone.length}
                  expanded={expandedAction === 'nophone'}
                  onToggle={() => setExpandedAction(expandedAction === 'nophone' ? null : 'nophone')}
                >
                  {actionItems.noPhone.map(s => (
                    <ActionItemRow
                      key={s.id}
                      name={s.name}
                      detail={formatClassName(s.class)}
                      accent="var(--text-3)"
                    />
                  ))}
                </ActionRow>
              )}
            </div>
          </div>
        )}

        {/* 발송 수납 내역 — 내부 스크롤 */}
        {recentActivity.length > 0 && (
          <div className="card px-2 py-3.5 mb-3">
            <div className="flex items-baseline justify-between mb-2 px-1">
              <h2 className="text-sm font-semibold text-[var(--text-2)]">발송 · 수납</h2>
              <span className="text-[10px] text-[var(--text-4)] tabular-nums">{recentActivity.length}건</span>
            </div>
            <div className="space-y-0.5 max-h-[72vh] overflow-y-auto pr-1 -mr-1">
              {recentActivity.map(bill => {
                const s = studentById.get(bill.student_id)
                const meta = studentMetaById.get(bill.student_id)
                const { label, color } = statusBadge(bill.status)
                const isIrregular = bill.is_regular_tuition === false
                const note = bill.bill_note
                const metaParts = meta
                  ? [meta.gradeName, meta.className, meta.dueDay ? `${meta.dueDay}일` : null].filter(Boolean)
                  : []
                return (
                  <div key={bill.id} className="flex items-center gap-1.5 py-[3px] px-1" title={note ? `📝 ${note}` : undefined}>
                    {/* 날짜 맨 왼쪽 — 글자폭에 딱 맞게(고정폭 제거) 이름과 밀착 */}
                    <span className="text-[10px] text-[var(--text-4)] shrink-0 tabular-nums whitespace-nowrap">{timeAgo(bill.updated_at ?? bill.sent_at, nowTs)}</span>
                    {/* 이름+메타 한 그룹 — 여백 최소, 내용 최대 노출 */}
                    <div className="flex-1 min-w-0 flex items-baseline gap-1">
                      <span className="text-xs font-medium shrink-0 truncate max-w-[52px]">{s?.name ?? meta?.name ?? '?'}</span>
                      <span className="text-[10px] text-[var(--text-4)] truncate min-w-0">
                        {metaParts.join('·')}{note ? ` · 📝${note}` : ''}
                      </span>
                    </div>
                    {isIrregular && (
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded-full bg-[var(--orange-dim)] text-[var(--orange)] shrink-0">비정규</span>
                    )}
                    <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0" style={{ color, background: dimColor(color) }}>{label}</span>
                    <span className="text-[11px] text-[var(--text-3)] tabular-nums w-[54px] text-right shrink-0">{formatNumber(bill.amount)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 결제율 게이지 */}
        <div className="card p-4 mb-3">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-sm text-[var(--text-3)] font-semibold">결제율</span>
            <span className="text-[10px] text-[var(--text-4)]">{stats.paidCount}/{stats.sentCount} 건</span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-extrabold tabular-nums" style={{ color: 'var(--paid-text)' }}>{stats.paymentRate}</span>
            <span className="text-xl text-[var(--text-3)]">%</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--bg-elevated)] mt-2 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'var(--paid-text)' }}
              initial={{ width: 0 }}
              animate={{ width: `${stats.paymentRate}%` }}
              transition={{ type: 'spring', stiffness: 100, damping: 20 }}
            />
          </div>
          <div className="flex items-baseline justify-between mt-3 pt-3 border-t border-[var(--border)]">
            <div>
              <p className="text-[10px] text-[var(--text-4)]">결제 완료 금액</p>
              <p className="text-base font-bold tabular-nums" style={{ color: 'var(--paid-text)' }}>{formatWon(stats.paidAmount)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[var(--text-4)]">미결제 금액</p>
              <p className="text-base font-bold tabular-nums" style={{ color: 'var(--orange)' }}>{formatWon(stats.pendingAmount)}</p>
            </div>
          </div>
        </div>

        {/* 2x2 상태 카드 */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="card p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-[var(--text-4)]">발송</span>
              <span className="text-xs font-bold tabular-nums">{stats.sentCount}</span>
            </div>
            <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>{formatWon(stats.sentAmount)}</p>
          </div>
          <div className="card p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px]" style={{ color: 'var(--paid-text)' }}>결제완료</span>
              <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--paid-text)' }}>{stats.paidCount}</span>
            </div>
            <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--paid-text)' }}>{formatWon(stats.paidAmount)}</p>
          </div>
          <div className="card p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px]" style={{ color: 'var(--orange)' }}>미결제</span>
              <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--orange)' }}>{stats.activeSent}</span>
            </div>
            <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--orange)' }}>{formatWon(stats.pendingAmount)}</p>
          </div>
          <div className="card p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px]" style={{ color: 'var(--red)' }}>취소/파기</span>
              <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--red)' }}>{stats.cancelledCount}</span>
            </div>
            <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--red)' }}>{formatWon(stats.cancelledAmount)}</p>
          </div>
        </div>

        {/* 도구 (접힘) */}
        <div className="card overflow-hidden mb-4">
          <TButton
            onClick={() => setShowTools(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-[var(--text-2)] hover:bg-[var(--bg-card-hover)] transition-colors"
          >
            <span>추가 도구</span>
            <motion.div animate={{ rotate: showTools ? 180 : 0 }} transition={{ type: 'spring', stiffness: 300, damping: 25 }}>
              <ChevronDown className="w-4 h-4 text-[var(--text-4)]" />
            </motion.div>
          </TButton>
          <AnimatePresence initial={false}>
            {showTools && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                style={{ overflow: 'hidden' }}
              >
                <div className="px-4 pb-4 space-y-2 border-t border-[var(--border)] pt-3">
                  <Link
                    href="/payments"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-card-hover)] text-sm font-medium text-[var(--text-2)] transition-colors"
                  >
                    <FileText className="w-4 h-4 text-[var(--blue)]" />
                    납부 탭으로 이동 (발송 · 결제 관리)
                  </Link>
                  <TButton
                    onClick={exportCsv}
                    disabled={bills.length === 0}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-card-hover)] text-sm font-medium text-[var(--text-2)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download className="w-4 h-4 text-[var(--blue)]" />
                    CSV 내보내기 ({bills.length}건)
                  </TButton>
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[var(--orange-dim)]">
                    <AlertCircle className="w-4 h-4 text-[var(--orange)] shrink-0 mt-0.5" />
                    <div className="text-xs text-[var(--orange)]">
                      <p className="font-semibold">
                        {isTestMode ? '테스트 모드 켜짐' : '운영 모드'}
                      </p>
                      <p className="text-[11px] opacity-80 mt-0.5">
                        {isTestMode
                          ? '실제 발송/결제/취소가 차단되어 있습니다. src/lib/payssam.ts의 TEST_MODE를 false로 바꾸면 실제 운영 전환됩니다.'
                          : '실제 결제선생 API로 발송됩니다.'}
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {showSendModal && (
        <QuickBillSendModal
          students={allForSendModal}
          grades={grades}
          billingMonth={selectedMonth}
          onClose={() => setShowSendModal(false)}
          onSuccess={() => mutateBills()}
        />
      )}
    </div>
  )
}

function ActionRow({ icon, color, bg, label, count, expanded, onToggle, children }: {
  icon: React.ReactNode
  color: string
  bg: string
  label: string
  count: number
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border-t border-[var(--border)] first:border-t-0">
      <TButton
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-[var(--bg-card-hover)] transition-colors"
      >
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: bg, color }}
        >
          {icon}
        </span>
        <span className="text-sm font-medium text-[var(--text-2)] flex-1 text-left">{label}</span>
        <span className="text-xs font-bold tabular-nums" style={{ color }}>{count}</span>
        <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ type: 'spring', stiffness: 300, damping: 25 }}>
          <ChevronDown className="w-4 h-4 text-[var(--text-4)]" />
        </motion.div>
      </TButton>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-4 pb-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ActionItemRow({ name, detail, amount, irregular, note }: {
  name: string
  detail: string
  amount?: number
  accent?: string
  irregular?: boolean
  note?: string | null
}) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-[var(--border)]/40 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium">{name}</span>
          {irregular && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--orange-dim)] text-[var(--orange)]">비정규</span>
          )}
          <span className="text-[11px] text-[var(--text-4)]">{detail}</span>
        </div>
        {note && (
          <p className="text-[10px] text-[var(--text-3)] mt-0.5 truncate" title={note}>📝 {note}</p>
        )}
      </div>
      {amount !== undefined && (
        <span className="text-[11px] font-semibold tabular-nums text-[var(--text-3)] shrink-0 mt-1">{formatWon(amount)}</span>
      )}
    </div>
  )
}

function statusBadge(status: string): { label: string; color: string } {
  switch (status) {
    case 'paid': return { label: '결제완료', color: 'var(--paid-text)' }
    case 'cancelled': return { label: '취소', color: 'var(--red)' }
    case 'destroyed': return { label: '파기', color: 'var(--red)' }
    case 'sent': return { label: '발송됨', color: 'var(--orange)' }
    default: return { label: status, color: 'var(--text-3)' }
  }
}

function dimColor(color: string): string {
  if (color.includes('paid-text')) return 'var(--green-dim)'
  if (color.includes('orange')) return 'var(--orange-dim)'
  if (color.includes('red')) return 'var(--red-dim)'
  return 'var(--bg-elevated)'
}
