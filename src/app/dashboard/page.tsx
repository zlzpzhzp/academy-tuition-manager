'use client'

import { memo, useCallback, useMemo, useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Users, CreditCard, AlertCircle, TrendingUp, BarChart3, ClipboardCheck, Megaphone, CheckCircle2, Clock, Info, X, RefreshCw, Sparkles, UserMinus, RotateCcw } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import useSWR from 'swr'
import EmptyState from '@/components/ui/EmptyState'
import type { Payment, GradeWithClasses, Teacher, Student, Class } from '@/types'
import { getStudentFee, getPaymentStatus, calcRefund, getLastClassDate } from '@/types'
import { getPaymentDueDay, isPaymentScheduled, getActiveStudents, getCurrentMonth, formatMonth, useGrades, usePayments, useTeachers, getPrevMonth, revalidateGrades, revalidatePayments, swrFetcher } from '@/lib/utils'
import { formatWon, formatNumber, formatClassName } from '@/lib/format'
import { usePullToRefresh, type PullFrame } from '@/lib/usePullToRefresh'
import { DashboardSkeleton } from '@/components/Skeleton'
import StatsMiniCard from '@/components/stats/StatsMiniCard'
import { motion } from '@/components/paperMotion'
import { FadeInUp, StaggerContainer, StaggerItem, AnimatedNumber, TButton } from '@/components/motion'

type DashStudent = Student & { class: Class; gradeName: string; gradeIndex: number; classIndex: number }

function ChevronRightSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-4)] opacity-60" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

const ONBOARDING_KEY = 'tuition_dashboard_onboarded_v1'

// SWR 결과가 없을 때의 **고정** 빈 배열 (2026-09-27 동작품질 배치2 #3). `= []` 는 렌더마다 새 배열이라
// 거기에 기댄 memo(요약 통계 등)가 매 렌더 다시 계산됐다. 얼려 두어 제자리 변경은 바로 드러나게.
const EMPTY: never[] = Object.freeze([]) as unknown as never[]

export default function DashboardPage() {
  const router = useRouter()
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem(ONBOARDING_KEY)) setShowOnboarding(true)
  }, [])
  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false)
    if (typeof window !== 'undefined') localStorage.setItem(ONBOARDING_KEY, '1')
  }, [])

  const currentMonth = getCurrentMonth()
  const prevMonth = getPrevMonth(currentMonth)
  const { data: grades = EMPTY, error: gradesError, isLoading: gradesLoading } = useGrades<GradeWithClasses[]>()
  const { data: payments = EMPTY, error: paymentsError, isLoading: paymentsLoading } = usePayments<Payment[]>(currentMonth)
  const { data: prevPayments = EMPTY } = usePayments<Payment[]>(prevMonth)
  const { data: teachers = EMPTY } = useTeachers<Teacher[]>()
  // 5월 청구서 상태 — 퇴원생 row에 결제처리 상태 표시용
  const { data: bills = EMPTY, isLoading: billsLoading } = useSWR<{ student_id: string; status: string; is_regular_tuition?: boolean }[]>(
    `/api/billing?month=${currentMonth}`,
    swrFetcher,
  )
  // 처리 필요한 경고(⚠️ 감사로그) 개수 — 최근 7일치만 센다(오래된 건 이미 처리됐다고 본다).
  // 2026-07-31 조용한실패 점검: 기록은 되는데 사람에게 도달하는 경로가 없던 문제.
  // 기준 시각은 **렌더 중에 만들지 않는다.** Date.now() 는 순수하지 않아서 서버 렌더와
  // 클라이언트 렌더가 다른 값을 내고(하이드레이션 불일치), 리렌더마다 SWR 키가 바뀌어
  // 같은 데이터를 계속 다시 받는다. 마운트 후 한 번만 정한다.
  const [warnSince, setWarnSince] = useState<string | null>(null)
  useEffect(() => {
    setWarnSince(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
  }, [])
  const { data: warnLogs = EMPTY } = useSWR<{ id: string }[]>(
    warnSince ? `/api/audit-logs?warnOnly=1&limit=100&since=${warnSince}` : null,
    swrFetcher,
  )
  const warnCount = warnLogs.length

  const billStatusByStudent = useMemo(() => {
    const map = new Map<string, string>()
    for (const b of bills) {
      if (b.is_regular_tuition === false) continue
      // sent_at 정렬 필요 없이 상태 우선순위: paid > sent > cancelled > destroyed
      const prev = map.get(b.student_id)
      const rank = (s: string) => s === 'paid' ? 4 : s === 'sent' ? 3 : s === 'cancelled' ? 2 : s === 'destroyed' ? 1 : 0
      if (!prev || rank(b.status) > rank(prev)) map.set(b.student_id, b.status)
    }
    return map
  }, [bills])

  // billsLoading 포함 — 퇴원 row 상태칩이 bills 도착 전 "퇴원" 폴백으로 렌더됐다가
  // 결제완료/파기로 바뀌는 깜빡임 방지 (rule.swr_loading_guard, 2026-07-10 전수점검)
  const loading = gradesLoading || paymentsLoading || billsLoading
  const error = gradesError || paymentsError

  const { active: allStudents, withdrawn: withdrawnThisMonth } = useMemo(() => {
    const active: DashStudent[] = []
    const withdrawn: DashStudent[] = []
    grades.forEach((g, gi) => {
      g.classes.forEach((c, ci) => {
        const all = c.students ?? []
        getActiveStudents(all, currentMonth)
          .filter(s => !s.withdrawal_date)
          .forEach(s => active.push({ ...s, class: c, gradeName: g.name, gradeIndex: gi, classIndex: ci }))
        all.forEach(s => {
          if (s.withdrawal_date?.startsWith(currentMonth)) {
            withdrawn.push({ ...s, class: c, gradeName: g.name, gradeIndex: gi, classIndex: ci })
          }
        })
      })
    })
    // 영어 과목은 학년 낮아도 뒤로
    const subjectWeight = (c: Class) => (c.subject === '영어' ? 1 : 0)
    active.sort((a, b) => {
      const sw = subjectWeight(a.class) - subjectWeight(b.class)
      if (sw !== 0) return sw
      if (a.gradeIndex !== b.gradeIndex) return a.gradeIndex - b.gradeIndex
      if (a.classIndex !== b.classIndex) return a.classIndex - b.classIndex
      return (a.order_index ?? 0) - (b.order_index ?? 0)
    })
    // 퇴원: withdrawal_date 내림차순 (최신 위)
    withdrawn.sort((a, b) => (b.withdrawal_date ?? '').localeCompare(a.withdrawal_date ?? ''))
    return { active, withdrawn }
  }, [grades, currentMonth])

  const paidByStudentId = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of payments) map.set(p.student_id, (map.get(p.student_id) ?? 0) + p.amount)
    return map
  }, [payments])

  const getStudentPaid = useCallback((studentId: string) => paidByStudentId.get(studentId) ?? 0, [paidByStudentId])

  const stats = useMemo(() => {
    const totalStudents = allStudents.length
    const totalFee = allStudents.reduce((sum, s) => sum + getStudentFee(s, s.class), 0)
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0)
    const unpaidStudents = allStudents.filter(s => {
      const fee = getStudentFee(s, s.class)
      const paid = paidByStudentId.get(s.id) ?? 0
      return getPaymentStatus(paid, fee) !== 'paid'
    })
    const overdueStudents = unpaidStudents.filter(s => !isPaymentScheduled(s, currentMonth))
    const scheduledStudents = unpaidStudents.filter(s => isPaymentScheduled(s, currentMonth))
    // 신규 — 이번 달 enrollment_date인 학생. 등록일 오름차순(최신이 맨 아래) — 사용자 명시 룰 2026-05-16
    const newStudents = allStudents
      .filter(s => s.enrollment_date?.startsWith(currentMonth))
      .sort((a, b) => (a.enrollment_date ?? '').localeCompare(b.enrollment_date ?? ''))
    const withdrawnStudents = withdrawnThisMonth
    const paidCount = totalStudents - unpaidStudents.length
    const paymentRate = totalStudents > 0 ? Math.round((paidCount / totalStudents) * 100) : 0
    return { totalStudents, totalFee, totalPaid, unpaidStudents, overdueStudents, scheduledStudents, newStudents, withdrawnStudents, paidCount, paymentRate }
  }, [allStudents, withdrawnThisMonth, payments, currentMonth, paidByStudentId])
  // 지난달 대비 수납액 증감 (만원 단위, 토스/copilot 트렌드 패턴). 지난달 납부는 늦게 올 수 있어 위 통계와 분리 —
  // 도착해도 미납·예정 목록(아래 memo 구획)의 입력이 바뀌지 않게 (#3).
  const prevTotalPaid = useMemo(() => prevPayments.reduce((sum, p) => sum + p.amount, 0), [prevPayments])
  const paidDeltaMan = Math.round((stats.totalPaid - prevTotalPaid) / 10000)

  // Pull-to-refresh — SWR 캐시 강제 새로고침 (billing의 인라인 로직을 hook으로 추출)
  // 2026-09-26 C07: touchmove 마다 setState(페이지 전체 재렌더)하던 것을 rAF 안의 DOM 직접 쓰기로.
  // 컨테이너 translate·전환·인디케이터 투명도/회전 공식은 예전 JSX 와 같다.
  const pullIconWrapRef = useRef<HTMLDivElement>(null)
  const pullIconRef = useRef<SVGSVGElement>(null)
  const onPull = useCallback((distance: number, { container, refreshing }: PullFrame) => {
    container.style.transform = `translateY(${distance}px)`
    container.style.transition = distance === 0 ? 'transform 0.25s cubic-bezier(0.22,1,0.36,1)' : 'none'
    const wrap = pullIconWrapRef.current
    if (wrap) {
      wrap.style.display = distance > 8 || refreshing ? '' : 'none'
      wrap.style.opacity = String(Math.min(1, distance / 60))
    }
    if (pullIconRef.current) pullIconRef.current.style.transform = `rotate(${distance * 4}deg)`
  }, [])
  const { containerRef, isRefreshing } = usePullToRefresh({
    onRefresh: async () => {
      await Promise.all([revalidateGrades(), revalidatePayments(currentMonth)])
    },
    disabled: loading,
    onPull,
  })

  // 퇴원 row 환불 칩 토글: 환불 필요 ↔ 결제취소(red)/환불완료(green)
  const toggleRefundDone = useCallback(async (s: DashStudent) => {
    if (togglingId) return
    setTogglingId(s.id)
    const memo = s.memo?.trim() ?? ''
    const isDone = memo === '결제취소' || memo.startsWith('환불완료')
    // 원래 상태 추정: 결제 취소(red, due_day=1) vs 환불계산 필요(yellow, due_day≠1)
    const wasRed = (s.payment_due_day ?? 1) === 1
    const restoreColor = wasRed ? 'red' : 'yellow'
    // 복원 문구는 현재/지난달 기준 동적 생성 — "5월/4월" 하드코딩이 7월에도 그대로 찍히던 버그 (2026-07-10 전수점검)
    const curM = Number(currentMonth.slice(5))
    const prevM = Number(prevMonth.slice(5))
    const restoreText = wasRed ? `${curM}월 결제 취소(환불)` : `환불계산 필요(${prevM}월 결제분)`
    // 처리 완료 후 색상: 환불 카테고리는 모두 red + 동그란 화살표(사용자 지시 2026-05-21)
    const doneText = wasRed ? '결제취소' : '환불완료'
    const doneColor = 'red'
    const next = isDone
      ? { memo: restoreText, memo_color: restoreColor }
      : { memo: doneText, memo_color: doneColor }
    try {
      const r = await fetch(`/api/students/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!r.ok) throw new Error('update failed')
      await revalidateGrades()
    } catch (e) {
      console.error(e)
      // 실패 무표시면 '눌렸는데 안 바뀐' 것과 구분 불가 — 칩은 원래 상태로 남는다 (2026-08-13 라인리뷰)
      toast.error('처리 상태 변경에 실패했습니다. 다시 시도하세요.')
      await revalidateGrades()
    } finally {
      setTogglingId(null)
    }
  }, [togglingId, currentMonth, prevMonth])

  if (loading) return <DashboardSkeleton />

  if (error) return (
    <div className="text-center py-20">
      <p className="text-[var(--red)] mb-4 text-sm">{error?.message}</p>
      <TButton onClick={() => window.location.reload()} className="btn btn-primary">다시 시도</TButton>
    </div>
  )

  return (
    <div ref={containerRef} className="space-y-5" style={{ transform: 'translateY(0px)', transition: 'transform 0.25s cubic-bezier(0.22,1,0.36,1)' }}>
      {/* Pull-to-refresh 인디케이터 — 표시·투명도·회전은 onPull 이 DOM 에 직접 쓴다 */}
      <div ref={pullIconWrapRef} className="absolute left-1/2 -translate-x-1/2 -top-12 flex items-center justify-center pointer-events-none" style={{ display: isRefreshing ? undefined : 'none', opacity: 0 }}>
        <RefreshCw ref={pullIconRef} className={`w-5 h-5 text-[var(--text-3)] ${isRefreshing ? 'animate-spin' : ''}`} style={{ transform: 'rotate(0deg)' }} />
      </div>
      <div className="flex items-start justify-between">
        <div>
          {(() => {
            const today = new Date()
            const m = today.getMonth() + 1
            const d = today.getDate()
            const weekday = ['일','월','화','수','목','금','토'][today.getDay()]
            return (
              <h1 className="text-[2.2rem] font-extrabold tracking-tight leading-none text-[var(--text-1)] tabular-nums mb-1 whitespace-nowrap">
                {m}월 {d}일 <span className="text-[1.6rem]">{weekday}요일</span>
              </h1>
            )
          })()}
          <p className="text-[13px] font-medium text-[var(--text-4)]">{formatMonth(currentMonth)} 기준</p>
        </div>
        <div className="flex items-center -space-x-3">
          <Link
            href="/notice"
            aria-label="공지 발송"
            className="p-2.5 rounded-xl text-[var(--text-4)] hover:text-[var(--text-1)] hover:bg-[var(--bg-card-hover)] transition-colors"
          >
            <Megaphone className="w-5 h-5" />
          </Link>
          <Link
            href="/stats"
            aria-label="매출 추이"
            className="p-2.5 rounded-xl text-[var(--text-4)] hover:text-[var(--text-1)] hover:bg-[var(--bg-card-hover)] transition-colors"
          >
            <BarChart3 className="w-5 h-5" />
          </Link>
          <Link
            href="/attendance"
            aria-label="출결"
            className="p-2.5 rounded-xl text-[var(--text-4)] hover:text-[var(--text-1)] hover:bg-[var(--bg-card-hover)] transition-colors"
          >
            <ClipboardCheck className="w-5 h-5" />
          </Link>
          {/* 2026-07-31 조용한실패 점검: 실패는 ⚠️ 감사로그로 남는데 보는 경로가 설정 화면 목록뿐이라
              '수동 파기 필요' 같은 경고가 묻혔다. 앱을 열면 바로 눈에 띄게 배지로 올린다. */}
          {warnCount > 0 && (
            <Link
              href="/settings?logs=warn"
              aria-label={`처리 필요 경고 ${warnCount}건`}
              className="relative p-2.5 rounded-xl text-[var(--unpaid-text)] bg-[var(--red-dim)] hover:opacity-90 transition-opacity"
            >
              <AlertCircle className="w-5 h-5" />
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--unpaid-text)] text-[10px] font-bold text-[var(--on-action)] flex items-center justify-center tabular-nums">
                {warnCount > 99 ? '99+' : warnCount}
              </span>
            </Link>
          )}
        </div>
      </div>

      {/* Onboarding tooltip — 첫 진입 1회 (localStorage). copilot 5113 패턴 */}
      <AnimatePresence>
        {showOnboarding && (
          <motion.div
            key="onboarding"
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="bg-[var(--blue-bg)] border border-[var(--blue-dim)] rounded-2xl px-4 py-3 flex items-start gap-3">
              <Info className="w-4 h-4 text-[var(--blue)] shrink-0 mt-0.5" />
              <div className="flex-1 text-[12px] text-[var(--text-2)] leading-relaxed">
                <span className="font-bold text-[var(--text-1)]">통계 카드를 탭</span>하면 해당 화면으로 이동합니다.
                납부율은 이번 달 재원생 중 결제 완료 비율, 수납액은 지난달 대비 증감 화살표 표시.
              </div>
              <TButton onClick={dismissOnboarding} className="p-1 -m-1 text-[var(--text-4)] hover:text-[var(--text-1)] shrink-0" aria-label="안내 닫기">
                <X className="w-3.5 h-3.5" />
              </TButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 요약 카드 — 탭 가능: 재원생→설정, 납부율/수납액→납부, 미납→납부+필터 */}
      <StaggerContainer className="grid grid-cols-2 gap-3">
        <Link href="/settings" className="contents">
          <StaggerItem className="card p-5 cursor-pointer hover:bg-[var(--bg-card-hover)] transition-colors active:scale-[0.98] duration-150">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-[var(--blue)]" />
                <span className="text-[13px] text-[var(--text-4)] font-medium">재원생</span>
              </div>
              <ChevronRightSmall />
            </div>
            <p className="text-[32px] font-extrabold text-[var(--text-1)] leading-none tracking-tight"><AnimatedNumber value={stats.totalStudents} /><span className="text-[15px] font-medium text-[var(--text-4)] ml-0.5">명</span></p>
          </StaggerItem>
        </Link>
        <Link href="/payments" className="contents">
          <StaggerItem className="card p-5 cursor-pointer hover:bg-[var(--bg-card-hover)] transition-colors active:scale-[0.98] duration-150">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-[var(--green)]" />
                <span className="text-[13px] text-[var(--text-4)] font-medium">납부율</span>
              </div>
              <ChevronRightSmall />
            </div>
            <p className="text-[32px] font-extrabold text-[var(--text-1)] leading-none tracking-tight"><AnimatedNumber value={stats.paymentRate} /><span className="text-[15px] font-medium text-[var(--text-4)] ml-0.5">%</span></p>
            <p className="text-[13px] text-[var(--text-4)] mt-1">{stats.paidCount}/{stats.totalStudents}명 완료</p>
          </StaggerItem>
        </Link>
        <Link href="/billing" className="contents">
          <StaggerItem className="card p-5 cursor-pointer hover:bg-[var(--bg-card-hover)] transition-colors active:scale-[0.98] duration-150">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-[var(--blue)]" />
                <span className="text-[13px] text-[var(--text-4)] font-medium">수납액</span>
              </div>
              <ChevronRightSmall />
            </div>
            <p className="text-[28px] font-extrabold text-[var(--text-1)] leading-none tracking-tight"><AnimatedNumber value={Math.round(stats.totalPaid / 10000)} /><span className="text-[14px] font-medium text-[var(--text-4)] ml-0.5">만원</span></p>
            <div className="flex items-center gap-1.5 mt-1">
              <p className="text-[13px] text-[var(--text-4)]">/ {(stats.totalFee / 10000).toFixed(0)}만원</p>
              {prevTotalPaid > 0 && paidDeltaMan !== 0 && (
                <span className={`text-[11px] font-bold tabular-nums ${paidDeltaMan > 0 ? 'text-[var(--paid-text)]' : 'text-[var(--unpaid-text)]'}`}>
                  {paidDeltaMan > 0 ? '↑' : '↓'} {Math.abs(paidDeltaMan).toLocaleString()}만
                </span>
              )}
            </div>
          </StaggerItem>
        </Link>
        <Link href="/payments" className="contents">
          <StaggerItem className="card p-5 cursor-pointer hover:bg-[var(--bg-card-hover)] transition-colors active:scale-[0.98] duration-150">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-[var(--red)]" />
                <span className="text-[13px] text-[var(--text-4)] font-medium">미납</span>
              </div>
              <ChevronRightSmall />
            </div>
            <div className="flex items-baseline gap-2">
              <p className="text-[28px] font-extrabold text-[var(--red)] leading-none tracking-tight"><AnimatedNumber value={stats.overdueStudents.length} /></p>
              <p className="text-[13px] text-[var(--text-4)]">예정 {stats.scheduledStudents.length}</p>
            </div>
          </StaggerItem>
        </Link>
      </StaggerContainer>

      {/* 이번 달 신규 — 납부탭과 동일 row 컴팩트 (px-4 py-1.5, gap-2). 비고 줄 함께. */}
      <AnimatePresence>
        {stats.newStudents.length > 0 && (
          <motion.div
            key="new-students"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
            className="card overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
              <Sparkles className="w-4 h-4 text-[var(--blue)]" />
              <h2 className="text-[15px] font-bold text-[var(--text-1)]">신규</h2>
              <span className="text-[13px] font-bold text-[var(--blue)] tabular-nums">{stats.newStudents.length}</span>
            </div>
            {stats.newStudents.map((s, idx) => {
              const fee = getStudentFee(s, s.class)
              const paid = getStudentPaid(s.id)
              const status = getPaymentStatus(paid, fee)
              const dueDay = getPaymentDueDay(s)
              const month = parseInt(currentMonth.split('-')[1])
              const isPaid = status === 'paid'
              const isScheduled = status !== 'paid' && isPaymentScheduled(s, currentMonth)
              const enrolledMd = (() => {
                const [, mo, da] = (s.enrollment_date ?? '').split('-')
                return mo && da ? `${parseInt(mo)}/${parseInt(da)}` : ''
              })()
              const memo = s.memo?.trim()
              const memoColor = s.memo_color
              const memoCls = memoColor === 'green' ? 'bg-[var(--paid-bg)] text-[var(--paid-text)] px-1.5 py-0.5 rounded'
                : memoColor === 'red' ? 'bg-[var(--unpaid-bg)] text-[var(--unpaid-text)] px-1.5 py-0.5 rounded'
                : memoColor === 'yellow' ? 'bg-[var(--orange-dim)] text-[var(--scheduled-text)] px-1.5 py-0.5 rounded'
                : ''
              return (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: (idx < 8 ? idx * 0.025 : 0), duration: 0.2 }}
                >
                  <Link href={`/students/${s.id}`} className="block hover:bg-[var(--bg-card-hover)] active:bg-[var(--bg-elevated)] transition-colors">
                    <div className="flex items-center gap-2 px-4 py-1.5">
                      <span className="text-[11px] text-[var(--text-4)] mr-1 tabular-nums">{idx + 1}.</span>
                      <div className="flex-1 min-w-0 flex items-center gap-1.5">
                        <span className="text-sm font-medium text-[var(--text-1)] truncate">{s.name}</span>
                        {enrolledMd && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--blue-bg)] text-[var(--blue)] font-bold tabular-nums shrink-0">{enrolledMd}</span>
                        )}
                        <span className="text-[11px] text-[var(--text-4)] truncate">{s.gradeName}·{formatClassName(s.class)}</span>
                      </div>
                      <span className="text-[11px] text-[var(--text-4)] tabular-nums shrink-0">{formatWon(fee)}</span>
                      {isPaid ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--paid-bg)] text-[var(--paid-text)] shrink-0">
                          <CheckCircle2 className="w-3 h-3" strokeWidth={2.5} />
                          {month}/{dueDay} 납부
                        </span>
                      ) : isScheduled ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--scheduled-bg)] text-[var(--scheduled-text)] shrink-0">
                          <Clock className="w-3 h-3" strokeWidth={2.5} />
                          {month}/{dueDay} 예정
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--unpaid-bg)] text-[var(--unpaid-text)] shrink-0">
                          <AlertCircle className="w-3 h-3" strokeWidth={2.5} />
                          {month}/{dueDay} 미납
                        </span>
                      )}
                    </div>
                    {memo && (
                      <div className="flex justify-end px-4 pb-1">
                        <p className={`text-[11px] leading-tight ${memoCls || 'text-[var(--text-3)]'}`}>{memo}</p>
                      </div>
                    )}
                  </Link>
                </motion.div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 이번 달 퇴원 — 신규와 동일 row 컴팩트 패턴, red 톤. */}
      <AnimatePresence>
        {stats.withdrawnStudents.length > 0 && (
          <motion.div
            key="withdrawn-students"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1], delay: 0.18 }}
            className="card overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
              <UserMinus className="w-4 h-4 text-[var(--red)]" />
              <h2 className="text-[15px] font-bold text-[var(--text-1)]">퇴원</h2>
              <span className="text-[13px] font-bold text-[var(--red)] tabular-nums">{stats.withdrawnStudents.length}</span>
            </div>
            {stats.withdrawnStudents.map((s, idx) => {
              // 마지막 수업일 = 퇴원일 직전 가장 가까운 class day (퇴원 당일은 미수강 처리)
              const lastClassMd = (() => {
                if (!s.withdrawal_date) return ''
                const d = getLastClassDate(new Date(s.withdrawal_date), s.class?.class_days)
                return `${d.getMonth() + 1}/${d.getDate()}`
              })()
              const memo = s.memo?.trim()
              const memoColor = s.memo_color
              const chipCls = memoColor === 'red' ? 'bg-[var(--unpaid-bg)] text-[var(--unpaid-text)]'
                : memoColor === 'yellow' ? 'bg-[var(--orange-dim)] text-[var(--scheduled-text)]'
                : memoColor === 'green' ? 'bg-[var(--paid-bg)] text-[var(--paid-text)]'
                : 'bg-[var(--bg-elevated)] text-[var(--text-3)]'
              const isRefundChip = memoColor === 'red' || memoColor === 'yellow' || memoColor === 'green'
              const isLoading = togglingId === s.id
              // 처리 완료(결제취소·환불완료) 칩은 환불액 표시 안 함. 대기 상태(red/yellow + '환불' 포함)만 환불액 자동 계산.
              const isPending = !!memo && (memoColor === 'red' || memoColor === 'yellow') && memo.includes('환불') && !memo.startsWith('환불완료')
              const refundAmount = isPending && s.enrollment_date && s.withdrawal_date
                ? calcRefund(
                    getStudentFee(s, s.class),
                    new Date(s.enrollment_date),
                    new Date(s.withdrawal_date),
                    s.class?.class_days,
                    s.payment_due_day,
                  ).refundAmount
                : 0
              const chipText = isPending && refundAmount > 0
                ? `${memo} · ${formatWon(refundAmount)}`
                : memo
              return (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: (idx < 8 ? idx * 0.025 : 0), duration: 0.2 }}
                  className="block hover:bg-[var(--bg-card-hover)] active:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                  onClick={() => router.push(`/students/${s.id}`)}
                >
                  <div className="flex items-center gap-2 px-4 py-1.5">
                    <span className="text-[11px] text-[var(--text-4)] mr-1 tabular-nums">{idx + 1}.</span>
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className="text-sm font-medium text-[var(--text-1)] truncate">{s.name}</span>
                      {lastClassMd && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--unpaid-bg)] text-[var(--unpaid-text)] font-bold tabular-nums shrink-0" title="마지막 수업일">{lastClassMd}</span>
                      )}
                      <span className="text-[11px] text-[var(--text-4)] truncate">{s.gradeName}·{formatClassName(s.class)}</span>
                    </div>
                    {memo ? (
                      isRefundChip ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleRefundDone(s) }}
                          disabled={isLoading}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 max-w-[60%] truncate transition-opacity ${chipCls} ${isLoading ? 'opacity-50' : 'hover:opacity-80 active:scale-95'}`}
                          aria-label={memoColor === 'green' ? '완료 해제' : '완료 체크'}
                        >
                          {memo === '결제취소' ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <g opacity="0.5" transform="rotate(180 12 12)">
                                <path d="m22 2-7 20-4-9-9-4Z" />
                                <path d="M22 2 11 13" />
                              </g>
                              <line x1="3.5" y1="3.5" x2="20.5" y2="20.5" />
                            </svg>
                          ) : memo?.startsWith('환불완료') ? (
                            <RotateCcw className="w-3 h-3" strokeWidth={2.5} />
                          ) : memo?.includes('환불') ? (
                            <RotateCcw className="w-3 h-3" strokeWidth={2.5} />
                          ) : null}
                          {chipText}
                        </button>
                      ) : (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 max-w-[60%] truncate ${chipCls}`}>{memo}</span>
                      )
                    ) : (() => {
                      // memo 없을 때: 5월 청구서 status로 폴백 표시
                      const billStatus = billStatusByStudent.get(s.id)
                      if (billStatus === 'paid') {
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--paid-bg)] text-[var(--paid-text)] shrink-0">
                            <CheckCircle2 className="w-3 h-3" strokeWidth={2.5} />
                            결제완료
                          </span>
                        )
                      }
                      if (billStatus === 'destroyed') {
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--unpaid-bg)] text-[var(--unpaid-text)] shrink-0">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <g transform="translate(-1.6 0.3) rotate(-8 7 12)">
                                <path d="M2 4 a2 2 0 0 1 2 -2 h8 v18 h-8 a2 2 0 0 1 -2 -2 z" />
                                <path d="M2 4 l10 6.5" />
                              </g>
                              <g transform="translate(1.6 0.3) rotate(8 17 12)">
                                <path d="M12 2 h8 a2 2 0 0 1 2 2 v14 a2 2 0 0 1 -2 2 h-8 z" />
                                <path d="M22 4 l-10 6.5" />
                              </g>
                            </svg>
                            청구서 파기
                          </span>
                        )
                      }
                      if (billStatus === 'cancelled') {
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--unpaid-bg)] text-[var(--unpaid-text)] shrink-0">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <g opacity="0.5" transform="rotate(180 12 12)">
                                <path d="m22 2-7 20-4-9-9-4Z" />
                                <path d="M22 2 11 13" />
                              </g>
                              <line x1="3.5" y1="3.5" x2="20.5" y2="20.5" />
                            </svg>
                            결제 취소
                          </span>
                        )
                      }
                      if (billStatus === 'sent') {
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--orange-dim)] text-[var(--scheduled-text)] shrink-0">
                            <Clock className="w-3 h-3" strokeWidth={2.5} />
                            미결제
                          </span>
                        )
                      }
                      return (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--unpaid-bg)] text-[var(--unpaid-text)] shrink-0">
                          <UserMinus className="w-3 h-3" strokeWidth={2.5} />
                          퇴원
                        </span>
                      )
                    })()}
                  </div>
                </motion.div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 미납·예정·선생님별·반별·학년별 구획은 memo — 늦게 오는 데이터(선생님 목록·경고 수·지난달 납부)가
          도착할 때 수십 개 행을 다시 렌더하지 않는다 (2026-09-27 동작품질 배치2 #3). 모양·순서 그대로. */}
      <OverdueSection students={stats.overdueStudents} currentMonth={currentMonth} paidByStudentId={paidByStudentId} />

      <ScheduledSection students={stats.scheduledStudents} currentMonth={currentMonth} paidByStudentId={paidByStudentId} />

      {/* 월별 매출 추이 — 자기 데이터는 카드 안에서 따로 로드(대시보드 skeleton 지연 금지) */}
      <FadeInUp delay={0.24}>
        <StatsMiniCard />
      </FadeInUp>

      <TeacherSalesSection teachers={teachers} grades={grades} currentMonth={currentMonth} paidByStudentId={paidByStudentId} />

      <ClassCountSection grades={grades} currentMonth={currentMonth} />

      <GradeFeeSection grades={grades} currentMonth={currentMonth} paidByStudentId={paidByStudentId} />
    </div>
  )
}

type PaidMap = Map<string, number>

const OverdueSection = memo(function OverdueSection({ students, currentMonth, paidByStudentId }: { students: DashStudent[]; currentMonth: string; paidByStudentId: PaidMap }) {
  const getStudentPaid = (studentId: string) => paidByStudentId.get(studentId) ?? 0
  return (
    <>
      {/* 미납 — 학년별 그룹화 (75명+ 끝없이 나열되던 문제 보완. spring-health Action Required 패턴) */}
      <FadeInUp delay={0.2} className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-[17px] font-bold text-[var(--text-1)]">미납</h2>
          {students.length > 0 && <span className="text-[13px] font-bold text-[var(--red)]">{students.length}</span>}
        </div>
        {students.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="미납 학생이 없습니다" description="이번 달은 모두 납부 완료됐어요" />
        ) : (
          (() => {
            // 학년별로 그룹: gradeName 단위 묶음 + 카운트 헤더
            const groups = new Map<string, DashStudent[]>()
            for (const s of students) {
              const key = s.gradeName
              if (!groups.has(key)) groups.set(key, [])
              groups.get(key)!.push(s)
            }
            const month = parseInt(currentMonth.split('-')[1])
            return (
              <div className="space-y-4">
                {Array.from(groups.entries()).map(([gradeName, group], gi) => (
                  <motion.div
                    key={gradeName}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: (gi < 8 ? gi * 0.04 : 0), duration: 0.25 }}
                  >
                    <div className="flex items-center gap-2 mb-1.5 px-1">
                      <span className="text-[12px] font-bold text-[var(--text-3)] tracking-tight">{gradeName}</span>
                      <span className="text-[11px] font-semibold text-[var(--text-4)] tabular-nums">{group.length}</span>
                    </div>
                    <div className="space-y-0">
                      {group.map((s, idx) => {
                        const fee = getStudentFee(s, s.class)
                        const paid = getStudentPaid(s.id)
                        const dueDay = getPaymentDueDay(s)
                        return (
                          <motion.div
                            key={s.id}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: (idx < 8 ? idx * 0.02 : 0), duration: 0.22 }}
                          >
                            <Link href={`/students/${s.id}`}
                              className="flex items-center gap-3 py-1.5 border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-card-hover)] -mx-2 px-2 rounded-xl transition-colors">
                              <div className="flex-1 min-w-0">
                                <span className="text-[14px] font-semibold text-[var(--text-1)]">{s.name}</span>
                                {s.enrollment_date?.startsWith(currentMonth) && (
                                  <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded-md bg-[var(--blue-bg)] text-[var(--blue)] font-bold">신규</span>
                                )}
                                <span className="text-[12px] text-[var(--text-4)] ml-2">{formatClassName(s.class)}</span>
                              </div>
                              <span className="text-[12px] text-[var(--text-4)] tabular-nums">{formatWon((fee - paid))}</span>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-[var(--unpaid-bg)] text-[var(--unpaid-text)]">
                                <AlertCircle className="w-3 h-3" />
                                {month}/{dueDay} 미납
                              </span>
                            </Link>
                          </motion.div>
                        )
                      })}
                    </div>
                  </motion.div>
                ))}
              </div>
            )
          })()
        )}
      </FadeInUp>
    </>
  )
})

const ScheduledSection = memo(function ScheduledSection({ students, currentMonth, paidByStudentId }: { students: DashStudent[]; currentMonth: string; paidByStudentId: PaidMap }) {
  const getStudentPaid = (studentId: string) => paidByStudentId.get(studentId) ?? 0
  return (
    <>
      {/* 예정 */}
      {students.length > 0 && (
        <FadeInUp delay={0.22} className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-[17px] font-bold text-[var(--text-1)]">예정</h2>
            <span className="text-[13px] font-bold text-[var(--scheduled-text)]">{students.length}</span>
          </div>
          <div className="space-y-0">
            {students.map((s, idx) => {
              const fee = getStudentFee(s, s.class)
              const paid = getStudentPaid(s.id)
              const dueDay = getPaymentDueDay(s)
              const month = parseInt(currentMonth.split('-')[1])
              return (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28, delay: (idx < 8 ? idx * 0.03 : 0) }}
                >
                  <Link href={`/students/${s.id}`}
                    className="flex items-center gap-3 py-1.5 border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-card-hover)] -mx-2 px-2 rounded-xl transition-colors">
                    <div className="flex-1 min-w-0">
                      <span className="text-[14px] font-semibold text-[var(--text-1)]">{s.name}</span>
                      {s.enrollment_date?.startsWith(currentMonth) && (
                        <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded-md bg-[var(--blue-bg)] text-[var(--blue)] font-bold">신규</span>
                      )}
                      <span className="text-[12px] text-[var(--text-4)] ml-2">{s.gradeName} · {formatClassName(s.class)}</span>
                    </div>
                    <span className="text-[12px] text-[var(--text-4)] tabular-nums">{formatWon((fee - paid))}</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-[var(--scheduled-bg)] text-[var(--scheduled-text)]">
                      <Clock className="w-3 h-3" />
                      {month}/{dueDay} 예정
                    </span>
                  </Link>
                </motion.div>
              )
            })}
          </div>
        </FadeInUp>
      )}
    </>
  )
})

const TeacherSalesSection = memo(function TeacherSalesSection({ teachers, grades, currentMonth, paidByStudentId }: { teachers: Teacher[]; grades: GradeWithClasses[]; currentMonth: string; paidByStudentId: PaidMap }) {
  const getStudentPaid = (studentId: string) => paidByStudentId.get(studentId) ?? 0
  return (
    <>
      {/* 선생님별 매출 */}
      {teachers.length > 0 && grades.length > 0 && (() => {
        const teacherStats = teachers.map(teacher => {
          const teacherClasses = grades.flatMap(g => g.classes.filter(c => c.teacher_id === teacher.id))
          // 이번달 재원했던 퇴원생 포함 — 상단 수납액 카드(전체 payments 합)와 분모가 같아야
          // 카드 합계와 선생님별 합계가 일치함. !withdrawal_date로 전부 제외하면 이달 중 퇴원한
          // 학생의 납부액이 breakdown에서만 빠져 어긋났음 (2026-07-10 전수점검 M4)
          const teacherStudents = teacherClasses.flatMap(c =>
            getActiveStudents(c.students ?? [], currentMonth).map(s => ({ ...s, class: c }))
          )
          const totalFee = teacherStudents.reduce((sum, s) => sum + getStudentFee(s, s.class), 0)
          const totalPaid = teacherStudents.reduce((sum, s) => sum + getStudentPaid(s.id), 0)
          return { teacher, totalFee, totalPaid, studentCount: teacherStudents.length, classCount: teacherClasses.length }
        }).filter(t => t.studentCount > 0)
        if (teacherStats.length === 0) return null
        const grandFee = teacherStats.reduce((sum, t) => sum + t.totalFee, 0)
        const grandPaid = teacherStats.reduce((sum, t) => sum + t.totalPaid, 0)
        return (
          <FadeInUp delay={0.25} className="card p-5">
            <h2 className="text-[17px] font-bold text-[var(--text-1)] mb-4">선생님별 매출</h2>
            {teacherStats.map(({ teacher, totalFee, totalPaid, studentCount, classCount }) => (
              <div key={teacher.id} className="flex items-center justify-between py-3.5 border-b border-[var(--border)] last:border-b-0">
                <div>
                  <span className="text-[15px] font-semibold text-[var(--text-1)]">{teacher.name}</span>
                  <span className="text-[13px] text-[var(--text-4)] ml-2">{classCount}반 · {studentCount}명</span>
                </div>
                <div className="text-right">
                  <p className="text-[15px] font-bold text-[var(--text-1)] tabular-nums">{formatWon(totalFee)}</p>
                  <p className="text-[12px] text-[var(--text-4)]">수납 {formatNumber(totalPaid)}</p>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between pt-4 mt-1">
              <span className="text-[15px] font-bold text-[var(--text-1)]">합계</span>
              <div className="text-right">
                <span className="text-[15px] font-bold text-[var(--text-1)] tabular-nums">{formatWon(grandFee)}</span>
                <p className="text-[12px] text-[var(--text-4)]">수납 {formatNumber(grandPaid)}</p>
              </div>
            </div>
          </FadeInUp>
        )
      })()}
    </>
  )
})

const ClassCountSection = memo(function ClassCountSection({ grades, currentMonth }: { grades: GradeWithClasses[]; currentMonth: string }) {
  return (
    <>
      {/* 반별 인원수 */}
      {grades.length > 0 && (() => {
        const classData = grades.flatMap(g =>
          g.classes.map(c => ({
            name: c.name,
            grade: g.name,
            subject: c.subject ?? null,
            count: getActiveStudents(c.students ?? [], currentMonth).filter(s => !s.withdrawal_date).length,
          }))
        ).filter(c => c.count > 0)
        const maxCount = Math.max(...classData.map(c => c.count), 1)
        const subjectColor = (s: string | null) =>
          s === '수학' ? 'var(--blue)' : s === '영어' ? 'var(--green)' : 'var(--text-4)'
        return (
          <FadeInUp delay={0.3} className="card p-5">
            <h2 className="text-[17px] font-bold text-[var(--text-1)] mb-5">반별 인원</h2>
            <div className="space-y-3">
              {classData.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 min-w-0">
                    <div className="text-[10px] font-medium leading-tight truncate flex items-center gap-1">
                      <span className="text-[var(--text-4)]">{c.grade}</span>
                      {c.subject && (
                        <>
                          <span className="text-[var(--text-4)] opacity-50">·</span>
                          <span style={{ color: subjectColor(c.subject) }}>{c.subject}</span>
                        </>
                      )}
                    </div>
                    <div className="text-[13px] text-[var(--text-2)] font-semibold leading-tight truncate">{c.name}</div>
                  </div>
                  <div className="flex-1 h-8 bg-[var(--bg-card-hover)] rounded-xl overflow-hidden relative">
                    {/* 막대는 너비(width) 대신 transform 으로 채운다(#3) — 너비 스프링(약 1.5초)은 매 프레임 문서 전체 레이아웃을
                        일으켜 로드 직후 스크롤이 끊겼다. 트랙 너비의 막대를 왼쪽으로 (100-비율)% 밀어 두고 트랙이 잘라 보인다:
                        오른쪽 끝의 궤적·둥근 끝·스프링·지연·값 변화 애니메이션이 예전과 같다. */}
                    <motion.div
                      className="h-full w-full rounded-xl"
                      initial={{ x: '-100%' }}
                      animate={{ x: `${Math.max((c.count / maxCount) * 100, 10) - 100}%` }}
                      transition={{ type: 'spring', stiffness: 80, damping: 20, delay: i < 8 ? i * 0.05 : 0 }}
                      style={{ background: subjectColor(c.subject) }}
                    />
                    <span className="absolute inset-y-0 right-3 flex items-center text-[13px] font-bold text-[var(--text-3)]">{c.count}</span>
                  </div>
                </div>
              ))}
            </div>
          </FadeInUp>
        )
      })()}
    </>
  )
})

const GradeFeeSection = memo(function GradeFeeSection({ grades, currentMonth, paidByStudentId }: { grades: GradeWithClasses[]; currentMonth: string; paidByStudentId: PaidMap }) {
  const getStudentPaid = (studentId: string) => paidByStudentId.get(studentId) ?? 0
  return (
    <>
      {/* 학년별 총액 */}
      {grades.length > 0 && (() => {
        // 합계는 '표시된 행들의 합' — stats.totalFee(퇴원생 제외)와 분모가 달라
        // 이달 퇴원생이 있으면 행을 다 더해도 합계와 안 맞았다 (2026-08-13 라인리뷰)
        const gradeRows = grades.map(grade => {
          const gradeStudents = grade.classes.flatMap(c =>
            getActiveStudents(c.students ?? [], currentMonth).map(s => ({ ...s, class: c })) // 퇴원생 포함 — M4, 위 선생님별과 동일
          )
          return {
            grade,
            gradeStudents,
            gradeFee: gradeStudents.reduce((sum, s) => sum + getStudentFee(s, s.class), 0),
            gradePaid: gradeStudents.reduce((sum, s) => sum + getStudentPaid(s.id), 0),
          }
        }).filter(r => r.gradeStudents.length > 0)
        const gradeTotalFee = gradeRows.reduce((sum, r) => sum + r.gradeFee, 0)
        return (
        <FadeInUp delay={0.35} className="card p-5">
          <h2 className="text-[17px] font-bold text-[var(--text-1)] mb-4">학년별 원비</h2>
          {gradeRows.map(({ grade, gradeStudents, gradeFee, gradePaid }) => {
            return (
              <div key={grade.id} className="flex items-center justify-between py-3.5 border-b border-[var(--border)] last:border-b-0">
                <div>
                  <span className="text-[15px] font-semibold text-[var(--text-1)]">{grade.name}</span>
                  <span className="text-[13px] text-[var(--text-4)] ml-2">{gradeStudents.length}명</span>
                </div>
                <div className="text-right">
                  <p className="text-[15px] font-bold text-[var(--text-1)] tabular-nums">{formatWon(gradeFee)}</p>
                  <p className="text-[12px] text-[var(--text-4)]">수납 {formatNumber(gradePaid)}</p>
                </div>
              </div>
            )
          })}
          <div className="flex items-center justify-between pt-4 mt-1">
            <span className="text-[15px] font-bold text-[var(--text-1)]">합계</span>
            <span className="text-[15px] font-bold text-[var(--text-1)] tabular-nums">{formatWon(gradeTotalFee)}</span>
          </div>
        </FadeInUp>
        )
      })()}
    </>
  )
})
