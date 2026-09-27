'use client'

import { toast } from 'sonner'
import { useState, useCallback, useRef, useMemo, useEffect, useLayoutEffect } from 'react'
import { usePullToRefresh } from '@/lib/usePullToRefresh'
import { ChevronRight, ChevronDown, Check, ClipboardList, Plus, Send, Mail, Loader2, CreditCard, Banknote, ArrowLeftRight, X, Clock, SearchX, AlertCircle, Bell, Split, UserMinus, RotateCcw, CheckCircle2, BadgeCheck, Camera } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import type { Student, Payment, PaymentMethod, GradeWithClasses } from '@/types'
import { formatWon, formatClassName } from '@/lib/format'
import { getStudentFee, getStudentBaseFee, getStudentElectivesFee, hasSplitDueDays, getPaymentStatus, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS, PAYMENT_METHOD_LABELS, parseClassDays, DAY_LABELS, getLastClassDate } from '@/types'
import PaymentModal from '@/components/PaymentModal'
import StudentModal from '@/components/StudentModal'
import PaymentsHeader from '@/components/payments/PaymentsHeader'
import PaymentDayFilterPicker, { type DayFilterValue, type PaymentFilter } from '@/components/payments/PaymentDayFilterPicker'
import DatePickerPopup from '@/components/payments/DatePickerPopup'
import MethodPickerPopup from '@/components/payments/MethodPickerPopup'
import { getPrevMonth, getPaymentDueDay, isPaymentScheduled, getUnpaidLabelText, getActiveStudents, isWithdrawnStudent, safeMutate, decodePaymentMemo, stripBillTags, useGrades, usePayments, revalidateGrades, revalidatePayments, getTodayString, injectPayment, swrFetcher, isBatchExcluded, isBatchExcludedNoBill, buildBillSettledSet, judgePrevMonthUnpaid, isOverdueUnsent } from '@/lib/utils'
import { billingPhone } from '@/lib/student-codes'
import { METHOD_OPTIONS_SHORT } from '@/lib/constants'
import { getRegularTuitionTitle, getElectivesTuitionTitle, REGULAR_TUITION_MESSAGE } from '@/lib/billing-title'
import { formatKst } from '@/lib/schedule'
import { applyDefaultExpansion } from '@/lib/defaultExpansion'
import { TERMINAL_STATUSES, IN_PROGRESS_STATUSES } from '@/lib/withdrawalStatuses'
import { PaymentsSkeleton } from '@/components/Skeleton'
import BillSendModal from '@/components/BillSendModal'
import BulkBillSendModal, { type BulkBillTarget } from '@/components/BulkBillSendModal'
import BillActionModal from '@/components/BillActionModal'
import StudentDetailModal from '@/components/StudentDetailModal'
import WithdrawActionMenu, { type WithdrawActionTarget } from '@/components/WithdrawActionMenu'
import AiFilterButton from '@/components/payments/AiFilterButton'
import { AnimatePresence } from 'framer-motion'
import { motion, usePaperReducedMotion, ICON_PRESS } from '@/components/paperMotion'
import { hitSlopVars, SLOP_ROW_TRAILING, SLOP_ROW_SPLIT_FIRST, SLOP_ROW_SPLIT_LAST, SLOP_FAN_PILL, SLOP_FAN_MIDDLE, SLOP_FAN_LAST } from '@/lib/hitSlop'
import { PullRefreshIndicator, usePullRefreshIndicator } from '@/components/PullRefreshIndicator'
import { TButton } from '@/components/motion'
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
  sent_at: string
  is_regular_tuition?: boolean
  bill_type?: 'regular' | 'electives'
  resend_count?: number
  last_resend_at?: string | null
  overdue_sms_count?: number
  last_overdue_sms_at?: string | null
  bill_note?: string | null
}

// BillStatus는 "이 학생에게 이번 달 청구서를 어떤 상태로 처리했는가" (청구서 레벨).
// types/index.ts 의 PaymentStatus('paid'|'partial'|'unpaid')와는 다른 도메인:
//   - BillStatus.paid = 청구서가 '완납 처리'된 상태 (청구 행위의 결과)
//   - PaymentStatus.paid = 실제 납부 합계가 수업료 이상인 상태 (납부 레벨)
// 둘 다 'paid' 문자열을 쓰지만 결코 섞지 말 것. 항상 변수 맥락으로 구분.
type BillStatus = 'unsent' | 'sent' | 'paid' | 'cancelled' | 'destroyed' | 'scheduled'

interface QueueEntry {
  id: string
  student_id: string
  billing_month: string
  send_type: 'single' | 'split' | 'reissue'
  scheduled_at: string
  is_regular_tuition: boolean
  bill_type?: 'regular' | 'electives'
  created_at: string
}

interface MonthMemoSave {
  month: string
  updatedAt: string | null
  pending: string | null
  ready: boolean
  running: boolean
  conflict: boolean
  timer: ReturnType<typeof setTimeout> | null
}

// SWR 결과가 아직 없을 때 쓰는 **고정** 빈 배열 (2026-09-27 동작품질 배치2 #2).
// `data: x = []` 는 로딩 중 렌더마다 새 [] 를 만들어 → 그 배열에 기댄 memo(Map·Set·필터)가 매번 새로 생기고 →
// 기본 펼침 effect 가 매 커밋 다시 돌아 setState → 또 렌더(검수 실측: 로딩 500ms 동안 커밋 59회 +
// 'Maximum update depth' 경고). 참조가 고정이면 데이터가 실제로 올 때만 파생값이 바뀐다.
// 얼려 둔다 — 누가 제자리 변경(push 등)을 하면 조용히 공유 상태가 오염되는 대신 바로 드러나게.
const EMPTY: never[] = Object.freeze([]) as unknown as never[]

// 명단 아이콘 버튼 터치 영역(#1) — 보이는 22px 는 그대로, 버튼 안 투명 가상 요소로 확장. 기하는 src/lib/hitSlop.ts.
const HIT_ROW = hitSlopVars(SLOP_ROW_TRAILING)
const HIT_SPLIT_FIRST = hitSlopVars(SLOP_ROW_SPLIT_FIRST)
const HIT_SPLIT_LAST = hitSlopVars(SLOP_ROW_SPLIT_LAST)
const HIT_FAN_PILL = hitSlopVars(SLOP_FAN_PILL)
const HIT_FAN_MIDDLE = hitSlopVars(SLOP_FAN_MIDDLE)
const HIT_FAN_LAST = hitSlopVars(SLOP_FAN_LAST)

const FILTER_LABELS: Record<PaymentFilter, string> = {
  all: '전체',
  unpaid: '미납',
  // 2026-09-12 운영자님 지시 — "날짜 지났는데 청구서 안 보낸 애들"을 한 번에 보고 일괄 발송
  overdue_unsent: '청구지연',
}

/** 명단 줄 '지난달:' 표시용 — 결제선생 콜백이 붙인 [bill:…] 태그는 사람이 볼 이유가 없다(운영자님).
 *  저장된 메모는 그대로(태그는 콜백 멱등·취소 판정에 쓰인다). 태그만 있던 메모면 결제수단 이름으로 대신 보여 준다. */
function prevMemoLabel(memo: string, method: PaymentMethod | null): string {
  const { cleanMemo } = decodePaymentMemo(memo)
  if (cleanMemo) return cleanMemo
  if (method === 'payssam' || method === 'remote' || /\[bill:/.test(memo)) return '결제선생'
  return memo
}

export default function PaymentsPage() {
  const today = getTodayString()

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const prevMonth = getPrevMonth(selectedMonth)
  const { data: grades = EMPTY, error: gradesError, isLoading: gradesLoading } = useGrades<GradeWithClasses[]>()
  const { data: payments = EMPTY, error: paymentsError, isLoading: paymentsLoading } = usePayments<Payment[]>(selectedMonth)
  const { data: prevPayments = EMPTY, isLoading: prevPaymentsLoading } = usePayments<Payment[]>(prevMonth)

  const loading = gradesLoading || paymentsLoading
  const error = gradesError || paymentsError

  // 인라인 납부 폼
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null)
const [detailStudentId, setDetailStudentId] = useState<string | null>(null)
  const [inlineDate, setInlineDate] = useState(today)
  const [inlineMethod, setInlineMethod] = useState<PaymentMethod>('card')
  const [inlineSuccess, setInlineSuccess] = useState<string | null>(null)
  const [inlineSubmitting, setInlineSubmitting] = useState<string | null>(null)
  const [inlineSlideOut, setInlineSlideOut] = useState<string | null>(null)
  const [showMethodPicker, setShowMethodPicker] = useState(false)
  const [inlineMemo, setInlineMemo] = useState('')
  const [inlineMemoFromPrev, setInlineMemoFromPrev] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const dateButtonRef = useRef<HTMLButtonElement>(null)
  const methodButtonRef = useRef<HTMLButtonElement>(null)

  // 모달
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [selectedStudentFee, setSelectedStudentFee] = useState(0)
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null)
  const [selectedPrevMemo, setSelectedPrevMemo] = useState<string | null>(null)
  const [selectedPrevMethod, setSelectedPrevMethod] = useState<PaymentMethod | null>(null)

  // 스와이프 — 좌측(비고)은 다중 선택, 우측(결제특이사항)은 단일
  const [selectedMemoIds, setSelectedMemoIds] = useState<Set<string>>(new Set())
  const [swipeOpenPayId, setSwipeOpenPayId] = useState<string | null>(null)
  const [editMemoValue, setEditMemoValue] = useState('')
  const [editMemoColor, setEditMemoColor] = useState<string | null>(null)
  const [editPayMemoValue, setEditPayMemoValue] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  // 다중선택 툴바 위치 — React 상태가 아니라 rAF 에서 요소 transform 으로 직접 쓴다 (2026-09-26 C08)
  const bulkToolbarRef = useRef<HTMLDivElement>(null)
  const bulkToolbarTopRef = useRef(8)
  const touchRef = useRef<{
    startX: number; startY: number; currentX: number
    id: string; el: HTMLElement
    decided: boolean; isHorizontal: boolean
    baseOffset: number; wasOpen: boolean
    pointerId: number; captured: boolean
  } | null>(null)
  const wasSwiped = useRef(false)

  // 학생 추가 모달
  const [showStudentModal, setShowStudentModal] = useState(false)
  const [addStudentClassId, setAddStudentClassId] = useState<string | null>(null)

  // 청구서 발송 모달
  const [billSendTarget, setBillSendTarget] = useState<{ studentId: string; studentName: string; phone: string; amount: number; subject: string | null; className: string | null; electives: string[]; billType?: 'regular' | 'electives' } | null>(null)
  const [billActionTarget, setBillActionTarget] = useState<{ studentId: string; studentName: string; phone: string; billId: string; amount: number; status: 'sent' | 'paid' | 'cancelled'; subject: string | null; paymentDueDay: number | null } | null>(null)
  // 퇴원생 환불/청구서 처리 메뉴
  const [withdrawMenuTarget, setWithdrawMenuTarget] = useState<WithdrawActionTarget | null>(null)
  // 처리완료 퇴원 섹션 접힘 토글 (default 접힘) — 2026-05-23 사용자 지시
  const [completedWithdrawnExpanded, setCompletedWithdrawnExpanded] = useState(false)
  const [bulkBillTarget, setBulkBillTarget] = useState<{ className: string; targets: BulkBillTarget[]; studentClsMap?: Map<string, ClassWithStudents>; excludedNote?: string } | null>(null)
  // 일괄 재발송 (이미 sent 상태 + 결제일 지난 학생 알림 재푸시)
  const [bulkResendTarget, setBulkResendTarget] = useState<{ targets: BulkBillTarget[]; billIds: Map<string, string> } | null>(null)

  // 청구서 현황 (결제선생 발송/결제/취소 상태)
  const { data: bills = EMPTY, mutate: mutateBills, isLoading: billsLoading } = useSWR<BillRecord[]>(
    `/api/billing?month=${selectedMonth}`,
    swrFetcher,
    { refreshInterval: 30000 }
  )

  // 지난달 청구서 — '지난달 미납' 배지 판정 보강용 (2026-08-27 카리나 건).
  // 이월 차감 등 조정 금액 청구(스냅샷 요금 < 청구액)를 완납한 학생이 스냅샷 대비 모자라
  // 미납으로 오판되던 것: 지난달 청구가 존재하고 전부 종결(paid 포함, sent 잔존 0)이면 완납 취급.
  const { data: prevBills = EMPTY } = useSWR<BillRecord[]>(
    `/api/billing?month=${prevMonth}`,
    swrFetcher,
    { refreshInterval: 60000 }
  )
  const prevBillSettledByStudent = useMemo(() => buildBillSettledSet(prevBills), [prevBills])

  // 월별 요금 스냅샷 — 과거 달 완납/미납 판정용. 요금 인상 후에도 과거 달 표시가 안 뒤바뀌게 (2026-07-02)
  // 과거 달만 스냅샷 사용, 현재/미래 달은 라이브 요금 (월 중 요금 수정이 즉시 반영되도록)
  const { data: feeSnapshotRows = EMPTY, isLoading: feeSnapshotsLoading } = useSWR<{ student_id: string; month: string; fee: number }[]>(
    `/api/fee-snapshots?months=${selectedMonth},${prevMonth}`,
    swrFetcher,
  )
  const feeSnapshots = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of Array.isArray(feeSnapshotRows) ? feeSnapshotRows : []) map.set(`${r.student_id}|${r.month}`, r.fee)
    return map
  }, [feeSnapshotRows])
  const currentKstMonth = getTodayString().slice(0, 7)
  // 스냅샷 = "그 달 확정 요금" 정본(agent 도구와 동일 독트린). 현재 달 포함 — 이월 차감·상계로
  // 확정 요금이 조정된 학생이 '오늘까지만' 부분납부(노란)로 보이던 경계 버그 제거(2026-08-31 운영자님:
  // "종결된 건인데 왜 노란표시를 해놓냐"). 미래 달만 라이브. ⚠️ 월중 반요금 수정은 그 달 스냅샷을
  // 같이 정정해야 화면에 반영된다(PUT /api/fee-snapshots) — 안 하면 다음 달부터 반영.
  const feeForMonth = useCallback((studentId: string, month: string, liveFee: number) =>
    month <= currentKstMonth ? (feeSnapshots.get(`${studentId}|${month}`) ?? liveFee) : liveFee,
  [feeSnapshots, currentKstMonth])
  // 정규(regular) / 선택과목(electives) 청구서를 분리해서 보관 — 같은 학생에 두 개 공존 가능
  const billsByStudent = useMemo(() => {
    const map = new Map<string, { regular?: BillRecord; electives?: BillRecord }>()
    for (const b of bills) {
      if (b.is_regular_tuition === false) continue
      const slot: 'regular' | 'electives' = b.bill_type === 'electives' ? 'electives' : 'regular'
      const cur = map.get(b.student_id) ?? {}
      // 같은 type의 더 오래된 row가 있다면 최신으로 갱신 (sent_at 기준)
      const existing = cur[slot]
      if (!existing || new Date(b.sent_at).getTime() > new Date(existing.sent_at).getTime()) {
        cur[slot] = b
        map.set(b.student_id, cur)
      }
    }
    return map
  }, [bills])

  // 레거시 단일 진입점 — 분할이 아닌 경우 regular만 반환
  const billByStudent = useMemo(() => {
    const map = new Map<string, BillRecord>()
    for (const [sid, slots] of billsByStudent) {
      if (slots.regular) map.set(sid, slots.regular)
    }
    return map
  }, [billsByStudent])

  // 보충비 청구(비정규) — 납부탭/특강탭 어디에도 안 뜨던 사각지대라 학생 줄에 배지로 표시 (2026-07-18 원장 지시).
  // 정규 집계엔 절대 섞지 않는다(위 map들은 is_regular_tuition===false를 계속 걸러냄). 표시 전용.
  const supplementBillByStudent = useMemo(() => {
    const map = new Map<string, BillRecord>()
    for (const b of bills) {
      if (b.is_regular_tuition !== false) continue
      if ((b.bill_note ?? '') !== '보충비') continue
      if (b.status !== 'sent' && b.status !== 'paid') continue // 파기/취소분은 표시 안 함
      const cur = map.get(b.student_id)
      if (!cur || new Date(b.sent_at).getTime() > new Date(cur.sent_at).getTime()) map.set(b.student_id, b)
    }
    return map
  }, [bills])

  // 분할 청구 sent 상태 학생: bill_note가 '분할'로 시작하는 sent 청구서 ≥2건
  const splitSentByStudent = useMemo(() => {
    const map = new Map<string, BillRecord[]>()
    for (const b of bills) {
      if (b.is_regular_tuition === false) continue
      if (b.status !== 'sent') continue
      if (!(b.bill_note || '').startsWith('분할')) continue
      const arr = map.get(b.student_id) ?? []
      arr.push(b)
      map.set(b.student_id, arr)
    }
    return map
  }, [bills])

  // 분할 청구 전체(sent + paid + cancelled): 모달에 건별 상태 표시용
  const splitAllByStudent = useMemo(() => {
    const map = new Map<string, BillRecord[]>()
    for (const b of bills) {
      if (b.is_regular_tuition === false) continue
      if (!(b.bill_note || '').startsWith('분할')) continue
      const arr = map.get(b.student_id) ?? []
      arr.push(b)
      map.set(b.student_id, arr)
    }
    return map
  }, [bills])

  // 퇴원생 월별 처리 상태 (이번달까지 정리 / 계좌환불 완료) — 학생 memo 대신 월별 독립 (2026-05-30)
  const { data: withdrawalStatuses = EMPTY, mutate: mutateWithdrawalStatus, isLoading: withdrawalStatusLoading } = useSWR<{ student_id: string; status: string }[]>(
    `/api/withdrawal-status?billing_month=${selectedMonth}`,
    swrFetcher,
    { refreshInterval: 30000 },
  )
  const withdrawalStatusByStudent = useMemo(() => {
    const map = new Map<string, string>()
    for (const w of withdrawalStatuses) map.set(w.student_id, w.status)
    return map
  }, [withdrawalStatuses])

  // 동명이인(같은 이름+학년+과목)인 학생 id 집합 → 이름 뒤에 반 알파벳을 붙여 구분 (2026-06-16 사용자 지시)
  // 과목/학년이 다르면 동명이인 취급 X.
  const duplicateNameStudentIds = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const g of grades) {
      for (const c of (g.classes ?? [])) {
        for (const s of (c.students ?? [])) {
          const key = `${s.name}|${g.name}|${c.subject ?? ''}`
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key)!.push(s.id)
        }
      }
    }
    const ids = new Set<string>()
    for (const arr of groups.values()) if (arr.length > 1) arr.forEach(id => ids.add(id))
    return ids
  }, [grades])

  // 타임락 예약 큐 (pending 상태 — 영업시간 외 발송 요청)
  const { data: queueEntries = EMPTY, isLoading: queueLoading } = useSWR<QueueEntry[]>(
    `/api/billing/queue?month=${selectedMonth}`,
    swrFetcher,
    { refreshInterval: 30000 }
  )
  const queuesByStudent = useMemo(() => {
    const map = new Map<string, { regular?: QueueEntry; electives?: QueueEntry }>()
    for (const q of queueEntries) {
      if (q.is_regular_tuition === false) continue
      const slot: 'regular' | 'electives' = q.bill_type === 'electives' ? 'electives' : 'regular'
      const cur = map.get(q.student_id) ?? {}
      if (!cur[slot]) {
        cur[slot] = q
        map.set(q.student_id, cur)
      }
    }
    return map
  }, [queueEntries])

  // 학생별 memo 맵 — bill row가 없는 결제취소 케이스의 시각적 표시용
  const studentMemoById = useMemo(() => {
    const m = new Map<string, string | null>()
    grades.forEach(g => g.classes.forEach(c => (c.students ?? []).forEach(s => {
      m.set(s.id, s.memo ?? null)
    })))
    return m
  }, [grades])

  const getBillStatus = useCallback((studentId: string, billType: 'regular' | 'electives' = 'regular'): BillStatus => {
    const slots = billsByStudent.get(studentId)
    const bill = slots?.[billType]
    if (!bill) {
      const qSlots = queuesByStudent.get(studentId)
      if (qSlots?.[billType]) return 'scheduled'
      // 결제취소 메모가 있으면 시각적으로 cancelled 표시 (bill row가 없어도)
      if (studentMemoById.get(studentId) === '결제취소') return 'cancelled'
      return 'unsent'
    }
    if (bill.status === 'paid') return 'paid'
    if (bill.status === 'cancelled') return 'cancelled'
    if (bill.status === 'destroyed') return 'destroyed'
    return 'sent'
  }, [billsByStudent, queuesByStudent, studentMemoById])

  // ─── 청구서 일괄발송 ───────────────────────────────────────────
  const [batchSending, setBatchSending] = useState<string | null>(null)
  // 분할 즉시발송 연타/중복 가드 (발송 중인 학생 id)
  const [splitSendingId, setSplitSendingId] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [batchResultToast, setBatchResultToast] = useState<string | null>(null)
  const [cancellingBatch, setCancellingBatch] = useState(false)
  const cancelBatchRef = useRef(false)

  // 반 접기/펼치기 (기본: 접힘)
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set())
  const toggleClass = (classId: string) => {
    setExpandedClasses(prev => {
      const next = new Set(prev)
      if (next.has(classId)) next.delete(classId); else next.add(classId)
      return next
    })
  }

  // 통합 필터 (전체/미납 토글 + 결제일 직접입력)
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all')
  const [customStart, setCustomStart] = useState<number | null>(null)
  const [customEnd, setCustomEnd] = useState<number | null>(null)
  const customActive = customStart !== null || customEnd !== null
  const customLabel = (() => {
    if (customStart !== null && customEnd !== null && customStart !== customEnd) {
      return `${Math.min(customStart, customEnd)}일~${Math.max(customStart, customEnd)}일`
    }
    return `${customStart ?? customEnd ?? ''}일`
  })()

  // 적용값은 페이지 소유, 달력 초안은 피커 인스턴스 소유(취소 시 폐기).
  const [dayPickerOpen, setDayPickerOpen] = useState(false)
  const dayPickerButtonRef = useRef<HTMLButtonElement>(null)
  const openDayPicker = useCallback(() => setDayPickerOpen(true), [])
  const applyDayPicker = useCallback((value: DayFilterValue) => {
    setPaymentFilter(value.filter)
    setCustomStart(value.start)
    setCustomEnd(value.end)
    setDayPickerOpen(false)
  }, [])
  const clearDayPicker = useCallback(() => {
    setCustomStart(null)
    setCustomEnd(null)
    setPaymentFilter(prev => prev === 'overdue_unsent' ? 'all' : prev)
    setDayPickerOpen(false)
  }, [])
  const [monthMemo, setMonthMemo] = useState('')
  // 로드 실패와 '메모 없음'을 구분 — 실패한 빈칸에 한 글자만 쳐도 서버 메모를 통째로 덮어쓴다 (2026-08-13 라인리뷰 P2)
  const [monthMemoStatus, setMonthMemoStatus] = useState<'loading' | 'loaded' | 'failed' | 'save_failed' | 'conflict'>('loading')

  // AI 필터 (검색요정)
  const [aiFilterIds, setAiFilterIds] = useState<Set<string> | null>(null)
  const [aiFilterDesc, setAiFilterDesc] = useState('')
  const [aiFilterLoading, setAiFilterLoading] = useState(false)

  const monthMemoSaveRef = useRef<MonthMemoSave | null>(null)
  const memoSaveChainRef = useRef<Promise<void>>(Promise.resolve())
  const flushMonthMemo = useCallback((state: MonthMemoSave) => {
    if (!state.ready || state.running || state.conflict || state.pending === null) return
    state.running = true
    // 완료 전에 입력이 바뀌면 pending 한 칸만 교체한다. 다음 PUT은 직전 응답의 버전으로 보낸다.
    memoSaveChainRef.current = memoSaveChainRef.current.then(async () => {
      try {
        while (state.pending !== null && !state.conflict) {
          const content = state.pending
          state.pending = null
          try {
            const res = await fetch('/api/monthly-memo', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ month: state.month, content, baseUpdatedAt: state.updatedAt }),
            })
            if (res.status === 409) {
              // 새 서버 버전으로 자동 재전송하면 타 기기 내용을 다시 덮는다. 로컬 편집은 그대로 둔다.
              state.conflict = true
              if (monthMemoSaveRef.current === state) setMonthMemoStatus('conflict')
              toast.error('다른 기기에서 수정됨 — 로컬 메모를 보관한 뒤 새로고침하세요')
              break
            }
            if (!res.ok) throw new Error('월별 메모 저장 실패')
            const data = await res.json()
            state.updatedAt = data.updated_at
            if (monthMemoSaveRef.current === state) setMonthMemoStatus('loaded')
          } catch {
            if (monthMemoSaveRef.current === state) setMonthMemoStatus('save_failed')
            toast.error('월별 메모 저장 실패 — 편집 내용은 화면에 보존됩니다')
          }
        }
      } finally {
        state.running = false
      }
    })
  }, [])

  // 월별 메모 로드 — DB에서 (기기 간 공유)
  useEffect(() => {
    let cancelled = false
    const state: MonthMemoSave = { month: selectedMonth, updatedAt: null, pending: null, ready: false, running: false, conflict: false, timer: null }
    monthMemoSaveRef.current = state
    setMonthMemoStatus('loading')
    ;(async () => {
      try {
        // 월 이동 직전의 저장까지 완료 후 읽는다. 이전 월 응답은 새 월 내용·버전을 건드리지 않는다.
        await memoSaveChainRef.current
        if (cancelled) return
        const res = await fetch(`/api/monthly-memo?month=${selectedMonth}`)
        if (!res.ok) { if (!cancelled) { setMonthMemoStatus('failed'); toast.error('월별 메모를 불러오지 못했습니다 — 덮어쓰기 방지로 편집을 잠갔습니다') } ; return }
        const data = await res.json()
        if (!cancelled) {
          state.updatedAt = data.updated_at ?? null
          state.ready = true
          setMonthMemo(data.content ?? '')
          setMonthMemoStatus('loaded')
        }
      } catch {
        if (!cancelled) { setMonthMemoStatus('failed'); toast.error('월별 메모를 불러오지 못했습니다 — 덮어쓰기 방지로 편집을 잠갔습니다') }
      }
    })()
    return () => {
      cancelled = true
      if (state.timer) clearTimeout(state.timer)
      if (monthMemoSaveRef.current === state) monthMemoSaveRef.current = null
      flushMonthMemo(state)
    }
  }, [selectedMonth, flushMonthMemo])

  // 편집 디바운스 저장 — 진행 중이면 최신 편집 하나만 대기.
  const saveMonthMemo = useCallback((content: string) => {
    const state = monthMemoSaveRef.current
    if (!state?.ready || state.month !== selectedMonth) return // 로드 안 된 상태의 저장 = 서버 메모 덮어쓰기
    state.pending = content
    if (state.timer) clearTimeout(state.timer)
    if (!state.running) state.timer = setTimeout(() => flushMonthMemo(state), 500)
  }, [selectedMonth, flushMonthMemo])

  const fetchData = useCallback(() => {
    revalidateGrades()
    revalidatePayments(selectedMonth)
    revalidatePayments(prevMonth)
  }, [selectedMonth, prevMonth])

  // ─── Memoized data ────────────────────────────────────────────
  const allStudents = useMemo(() =>
    grades.flatMap(g => g.classes.flatMap(c =>
      getActiveStudents(c.students ?? [], selectedMonth).map(s => ({ ...s, class: c }))
    )), [grades, selectedMonth])

  // 과목별 → 학년별 그룹핑
  type ClassWithStudents = GradeWithClasses['classes'][number]
  const subjectGradeGroups = useMemo(() => {
    const subjectMap = new Map<string, Map<string, { gradeName: string; classes: ClassWithStudents[] }>>()
    grades.forEach(grade => {
      grade.classes.forEach(cls => {
        const subject = cls.subject || '기타'
        if (!subjectMap.has(subject)) subjectMap.set(subject, new Map())
        const gradeMap = subjectMap.get(subject)!
        if (!gradeMap.has(grade.id)) gradeMap.set(grade.id, { gradeName: grade.name, classes: [] })
        gradeMap.get(grade.id)!.classes.push(cls as ClassWithStudents)
      })
    })
    return Array.from(subjectMap.entries()).map(([subject, gradeMap]) => ({
      subject,
      grades: Array.from(gradeMap.entries()).map(([gradeId, data]) => ({ gradeId, ...data })),
    }))
  }, [grades])

  const paymentsByStudentId = useMemo(() => {
    const map = new Map<string, Payment[]>()
    for (const p of payments) {
      const arr = map.get(p.student_id) ?? []
      arr.push(p)
      map.set(p.student_id, arr)
    }
    return map
  }, [payments])

  const prevMemoByStudentId = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const p of prevPayments) {
      if (!map.has(p.student_id)) map.set(p.student_id, p.memo || null)
    }
    return map
  }, [prevPayments])

  const prevMethodByStudentId = useMemo(() => {
    const map = new Map<string, PaymentMethod>()
    for (const p of prevPayments) {
      if (!map.has(p.student_id)) map.set(p.student_id, p.method as PaymentMethod)
    }
    return map
  }, [prevPayments])

  const prevPaidByStudentId = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of prevPayments) {
      map.set(p.student_id, (map.get(p.student_id) ?? 0) + p.amount)
    }
    return map
  }, [prevPayments])

  // '지난달 미납' 공용 판정 — 행 배지와 일괄청구 제외가 같은 기준을 봐야 한다 (2026-08-27 운영자님 지시).
  // 조정 청구 완납(prevBillSettled)은 미납 아님. 로딩 중엔 판정 유보(false) — 배지도 같은 가드.
  const isPrevMonthUnpaid = useCallback((s: Student, liveFee: number): boolean => {
    if (prevPaymentsLoading) return false
    if (isWithdrawnStudent(s)) return false
    // 지난달 요금은 feeForMonth(과거 달만 스냅샷)를 거치지 않고 스냅샷을 직접 우선한다.
    // 다음 달 탭을 월말에 미리 보면 지난달==현재 달이라 gate 에 걸려 정정 스냅샷(상계 0원 등)이
    // 무시된다(2026-08-29 손흥민). '지난달 판정은 그 달 확정 요금'이라는 2026-07-02 취지 그대로.
    const prevFee = feeSnapshots.get(`${s.id}|${prevMonth}`) ?? liveFee
    return judgePrevMonthUnpaid(
      s, prevMonth,
      prevFee,
      prevPaidByStudentId.get(s.id) ?? 0,
      prevBillSettledByStudent.has(s.id),
    )
  }, [prevPaymentsLoading, prevMonth, feeSnapshots, prevPaidByStudentId, prevBillSettledByStudent])

  // ─── Helpers ──────────────────────────────────────────────────
  const navigateMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const getStudentPayments = useCallback((studentId: string) =>
    paymentsByStudentId.get(studentId) ?? []
  , [paymentsByStudentId])

  const getPrevMemo = useCallback((studentId: string): string | null =>
    prevMemoByStudentId.get(studentId) ?? null
  , [prevMemoByStudentId])

  const getPrevMethod = useCallback((studentId: string): PaymentMethod | null =>
    prevMethodByStudentId.get(studentId) ?? null
  , [prevMethodByStudentId])

  const getDueDay = useCallback((student: Student): number =>
    student.payment_due_day ?? getPaymentDueDay(student)
  , [])

  function checkScheduled(student: Student, month: string): boolean {
    return isPaymentScheduled(student, month, student.payment_due_day ?? undefined)
  }

  // ─── 통합 필터 ──────────────────────────────────────────────
  // 정규/선택과목 결제일이 다른 학생은 두 날짜 중 하나라도 매칭되면 통과 (양쪽 다 표시)
  const passesFilter = useCallback((s: Student, cls: ClassWithStudents): boolean => {
    // AI 필터가 적용중이면 최우선
    if (aiFilterIds !== null && !aiFilterIds.has(s.id)) return false
    const split = hasSplitDueDays(s)
    const regularDue = s.payment_due_day ?? getPaymentDueDay(s)
    const electivesDue = split ? s.electives_payment_due_day! : null
    const dueDays = [regularDue, electivesDue].filter((d): d is number => typeof d === 'number')

    // 수동 결제일 입력이 있으면 최우선 — 드롭다운 필터 무시
    if (customStart !== null || customEnd !== null) {
      if (dueDays.length === 0) return false
      const lo = customStart ?? customEnd!
      const hi = customEnd ?? customStart!
      const min = Math.min(lo, hi); const max = Math.max(lo, hi)
      return dueDays.some(d => d >= min && d <= max)
    }
    if (paymentFilter === 'all') return true
    if (paymentFilter === 'overdue_unsent') {
      // 🔴 결제일과 청구 상태는 **같은 청구 유형끼리** 봐야 한다 (2026-09-12 코드 검수 P2).
      // 정규는 5일·발송완료, 선택과목은 20일·미발송인 학생을 12일에 보면
      // '지난 결제일(정규) + 미발송(선택)'을 섞어 지연으로 잘못 잡는다 — 실제 늦은 청구서는 없다.
      const hasPayments = (paymentsByStudentId.get(s.id) ?? []).length > 0
      const totalFee = feeForMonth(s.id, selectedMonth, getStudentFee(s, cls))
      const regularOverdue = isOverdueUnsent({
        duePassed: !isPaymentScheduled(s, selectedMonth, regularDue),
        billStatus: getBillStatus(s.id, 'regular'),
        hasPayments,
        // 분할 결제일 학생의 정규분은 선택과목비를 뺀 금액이 청구 대상이다
        fee: split ? getStudentBaseFee(s, cls) : totalFee,
      })
      if (regularOverdue) return true
      if (!split || electivesDue === null) return false
      return isOverdueUnsent({
        duePassed: !isPaymentScheduled(s, selectedMonth, electivesDue),
        billStatus: getBillStatus(s.id, 'electives'),
        hasPayments,
        fee: getStudentElectivesFee(s),
      })
    }
    if (paymentFilter === 'unpaid') {
      const paid = (paymentsByStudentId.get(s.id) ?? []).reduce((sum, p) => sum + p.amount, 0)
      const status = getPaymentStatus(paid, feeForMonth(s.id, selectedMonth, getStudentFee(s, cls)))
      if (status === 'paid') return false
      if (status === 'unpaid' && isPaymentScheduled(s, selectedMonth, s.payment_due_day ?? undefined)) return false
      return true
    }
    return true
  // isPaymentScheduled가 내부에서 Date를 읽는다. 날짜가 바뀌면 명단/반 집계도 다시 평가한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiFilterIds, customStart, customEnd, paymentFilter, paymentsByStudentId, selectedMonth, feeForMonth, getBillStatus, today])

  // 달력은 현재 범위/전체·미납에 종속되지 않는다. 일반 행과 같은 재원 범위 + AI 교집합.
  // passesFilter의 지연 판정 입력을 그대로 사용하며 두 유형의 날짜를 각각 수집한다.
  const overdueCalendar = useMemo(() => {
    const ids = new Set<string>()
    const days = new Set<number>()
    const adjustedDays = new Set<number>()
    const [year, month] = selectedMonth.split('-').map(Number)
    const lastDay = new Date(year, month, 0).getDate()
    // today는 날짜 경과 후 재진입의 캐시 키. isPaymentScheduled도 현재 날짜를 읽는다.
    for (const s of allStudents) {
      if (s.withdrawal_date || (aiFilterIds !== null && !aiFilterIds.has(s.id))) continue
      const cls = s.class
      const split = hasSplitDueDays(s)
      const regularDue = s.payment_due_day ?? getPaymentDueDay(s)
      const hasPayments = (paymentsByStudentId.get(s.id) ?? []).length > 0
      const totalFee = feeForMonth(s.id, selectedMonth, getStudentFee(s, cls))
      const add = (day: number, billType: 'regular' | 'electives', fee: number) => {
        if (!isOverdueUnsent({
          duePassed: !isPaymentScheduled(s, selectedMonth, day),
          billStatus: getBillStatus(s.id, billType), hasPayments, fee,
        })) return
        ids.add(s.id)
        days.add(Math.min(day, lastDay))
        if (day > lastDay) adjustedDays.add(day)
      }
      add(regularDue, 'regular', split ? getStudentBaseFee(s, cls) : totalFee)
      if (split) add(s.electives_payment_due_day!, 'electives', getStudentElectivesFee(s))
    }
    return { days, studentCount: ids.size, adjustedDays, asOf: today }
  }, [allStudents, aiFilterIds, paymentsByStudentId, getBillStatus, feeForMonth, selectedMonth, today])

  const sendOneBill = useCallback(async (student: Student, cls: ClassWithStudents): Promise<'sent' | 'scheduled' | 'failed'> => {
    const phone = billingPhone(student)
    const fee = getStudentFee(student, cls)
    if (!phone || fee <= 0) return 'failed'

    // 분할결제 설정된 학생은 저장된 금액 그대로 N개 발송
    if (student.split_billing_parts && student.split_billing_amounts && student.split_billing_amounts.length === student.split_billing_parts) {
      const { data } = await safeMutate<{ code?: string }>('/api/payssam/split-send', 'POST', {
        studentId: student.id,
        studentName: student.name,
        phone: phone.replace(/-/g, ''),
        billingMonth: selectedMonth,
        amounts: student.split_billing_amounts,
        persist: false,
      })
      if (data?.code === 'SCHEDULED') return 'scheduled'
      if (data?.code === '0000') return 'sent'
      return 'failed'
    }

    // 정규 결제일 ≠ 선택과목 결제일: 정규/선택 2건으로 분리 발송 (각 결제일에 맞춰)
    if (hasSplitDueDays(student)) {
      const cleanPhone = phone.replace(/-/g, '')
      const regularAmount = getStudentBaseFee(student, cls)
      const electivesAmount = getStudentElectivesFee(student)
      const results: Array<'sent' | 'scheduled' | 'failed'> = []
      const codeToResult = (code?: string): 'sent' | 'scheduled' | 'failed' =>
        code === 'SCHEDULED' ? 'scheduled' : code === '0000' ? 'sent' : 'failed'

      if (regularAmount > 0) {
        const { data } = await safeMutate<{ code?: string }>('/api/payssam/send', 'POST', {
          studentId: student.id,
          studentName: student.name,
          phone: cleanPhone,
          amount: regularAmount,
          // 분리발송의 정규 건은 정규분만 — 제목에 "+확통" 붙이지 않기 (선택과목은 별건, 2026-07-10)
          productName: getRegularTuitionTitle(cls.subject, selectedMonth, cls.name, null),
          message: REGULAR_TUITION_MESSAGE,
          billingMonth: selectedMonth,
          billType: 'regular',
        })
        results.push(codeToResult(data?.code))
      }
      if (electivesAmount > 0) {
        const { data } = await safeMutate<{ code?: string }>('/api/payssam/send', 'POST', {
          studentId: student.id,
          studentName: student.name,
          phone: cleanPhone,
          amount: electivesAmount,
          productName: getElectivesTuitionTitle(selectedMonth, student.electives),
          message: REGULAR_TUITION_MESSAGE,
          billingMonth: selectedMonth,
          billType: 'electives',
        })
        results.push(codeToResult(data?.code))
      }
      if (results.length === 0) return 'failed'
      if (results.includes('failed')) return 'failed'
      if (results.includes('scheduled')) return 'scheduled'
      return 'sent'
    }

    const { data } = await safeMutate<{ code?: string }>('/api/payssam/send', 'POST', {
      studentId: student.id,
      studentName: student.name,
      phone: phone.replace(/-/g, ''),
      amount: fee,
      productName: getRegularTuitionTitle(cls.subject, selectedMonth, cls.name, student.electives),
      message: REGULAR_TUITION_MESSAGE,
      billingMonth: selectedMonth,
      billType: 'regular',
    })
    if (data?.code === 'SCHEDULED') return 'scheduled'
    if (data?.code === '0000') return 'sent'
    return 'failed'
  }, [selectedMonth])

  const executeBulkSend = useCallback(async () => {
    if (!bulkBillTarget) return
    const { targets, studentClsMap } = bulkBillTarget

    const items: Array<{ student: Student; cls: ClassWithStudents }> = []
    if (studentClsMap) {
      for (const t of targets) {
        const c = studentClsMap.get(t.studentId)
        const s = c?.students?.find(st => st.id === t.studentId)
        if (s && c) items.push({ student: s, cls: c })
      }
    }

    setBulkBillTarget(null)

    cancelBatchRef.current = false
    setCancellingBatch(false)
    setBatchSending('__filter__')
    setBatchProgress({ done: 0, total: items.length })

    const counts = { sent: 0, scheduled: 0, failed: 0 }
    for (let i = 0; i < items.length; i++) {
      if (cancelBatchRef.current) break
      const result = await sendOneBill(items[i].student, items[i].cls)
      counts[result]++
      setBatchProgress({ done: i + 1, total: items.length })
      if (cancelBatchRef.current) break
      if (i < items.length - 1) await new Promise(r => setTimeout(r, 500))
    }

    setBatchSending(null)
    setBatchProgress(null)
    setCancellingBatch(false)
    cancelBatchRef.current = false

    // 결과 토스트
    const parts: string[] = []
    if (counts.sent) parts.push(`${counts.sent}건 발송`)
    if (counts.scheduled) parts.push(`${counts.scheduled}건 예약(영업시간 외)`)
    if (counts.failed) parts.push(`${counts.failed}건 실패`)
    if (parts.length > 0) {
      setBatchResultToast(parts.join(' · '))
      setTimeout(() => setBatchResultToast(null), 4500)
    }

    mutateBills()
  }, [bulkBillTarget, sendOneBill, mutateBills])

  const cancelBatch = useCallback(() => {
    cancelBatchRef.current = true
    setCancellingBatch(true)
  }, [])

  // ─── 일괄 재발송 (sent 상태 + 결제일 지남) ───────────────────
  // 노란색 편지(sent) 학생 중 결제일이 지났고 아직 결제 안 한 사람들에게 카톡 알림 재푸시.
  // 이미 결제(payssam paid)했거나 다른 수단 납부했으면 자동 제외 (UI에서도, API에서도 ALREADY_PAID 체크).
  const resendableTargets = useMemo(() => {
    const targets: BulkBillTarget[] = []
    const billIds = new Map<string, string>()
    const today = new Date()
    for (const grade of grades) {
      for (const cls of grade.classes ?? []) {
        const classStudents = getActiveStudents(cls.students ?? [], selectedMonth)
        for (const s of classStudents) {
          const bill = billByStudent.get(s.id)
          if (!bill || bill.status !== 'sent') continue
          // 다른 수단 결제 여부
          const alreadyPaid = (paymentsByStudentId.get(s.id) ?? []).length > 0
          if (alreadyPaid) continue
          // 결제일 지났는지 — payment_due_day 우선, 없으면 등록일 일자.
          // 오늘 달이 아니라 '보는 달' 기준으로 만든다 — 오늘 기준이면 과거 달을 보며 재발송할 때
          // 대상 판정이 이번 달 결제일에 좌우된다. 28 고정 대신 그 달 말일로 클램프 (2026-08-13 라인리뷰)
          const dueDay = getPaymentDueDay(s)
          const [sy, sm] = selectedMonth.split('-').map(Number)
          const lastDayOfMonth = new Date(sy, sm, 0).getDate()
          const dueDate = new Date(sy, sm - 1, Math.min(dueDay, lastDayOfMonth))
          if (dueDate > today) continue
          targets.push({ studentId: s.id, studentName: s.name, className: `${grade.name}·${formatClassName(cls)}`, amount: bill.amount })
          billIds.set(s.id, bill.bill_id)
        }
      }
    }
    return { targets, billIds }
  }, [grades, selectedMonth, billByStudent, paymentsByStudentId])

  const openBulkResendModal = useCallback(() => {
    if (resendableTargets.targets.length === 0) return
    setBulkResendTarget(resendableTargets)
  }, [resendableTargets])

  const executeBulkResend = useCallback(async () => {
    if (!bulkResendTarget) return
    const { targets, billIds } = bulkResendTarget
    setBulkResendTarget(null)
    cancelBatchRef.current = false
    setCancellingBatch(false)
    setBatchSending('__resend__')
    setBatchProgress({ done: 0, total: targets.length })

    let resent = 0, scheduled = 0, alreadyPaid = 0, failed = 0
    for (let i = 0; i < targets.length; i++) {
      if (cancelBatchRef.current) break
      const billId = billIds.get(targets[i].studentId)
      if (!billId) { failed++; setBatchProgress({ done: i + 1, total: targets.length }); continue }
      try {
        const res = await fetch('/api/payssam/resend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ billId }),
        })
        const data = await res.json().catch(() => ({}))
        if (data.code === 'SCHEDULED') scheduled++
        else if (data.code === '0000') resent++
        else if (data.code === 'ALREADY_PAID') alreadyPaid++
        else failed++
      } catch {
        failed++
      }
      setBatchProgress({ done: i + 1, total: targets.length })
      if (i < targets.length - 1 && !cancelBatchRef.current) await new Promise(r => setTimeout(r, 500))
    }

    setBatchSending(null)
    setBatchProgress(null)
    setCancellingBatch(false)
    cancelBatchRef.current = false

    const parts: string[] = []
    if (resent) parts.push(`${resent}건 재발송`)
    if (scheduled) parts.push(`${scheduled}건 예약(영업시간 외)`)
    if (alreadyPaid) parts.push(`${alreadyPaid}건 이미결제(자동제외)`)
    if (failed) parts.push(`${failed}건 실패`)
    if (parts.length > 0) {
      setBatchResultToast(parts.join(' · '))
      setTimeout(() => setBatchResultToast(null), 5000)
    }
    mutateBills()
  }, [bulkResendTarget, mutateBills])

  // ─── AI 필터 (검색요정) — 납부 컨텍스트 기반 ──
  const handleAiFilter = useCallback(async (query: string) => {
    setAiFilterLoading(true)
    const allForFilter = grades.flatMap(g => g.classes.flatMap(c =>
      getActiveStudents((c as ClassWithStudents).students ?? [], selectedMonth).map(s => ({ ...s, class: c as ClassWithStudents }))
    ))

    const [prevY, prevM] = prevMonth.split('-').map(Number)
    const studentContext = allForFilter.map(s => {
      const currPays = paymentsByStudentId.get(s.id) ?? []
      const prevPays = prevPayments.filter(p => p.student_id === s.id)
      const fee = getStudentFee(s, s.class)
      const dueDay = getDueDay(s)
      const paid = currPays.reduce((sum, p) => sum + p.amount, 0)
      const status = getPaymentStatus(paid, fee)
      const currMemo = currPays.find(p => p.memo && p.memo.trim())?.memo?.trim() || null
      const prevMemo = prevPays.find(p => p.memo && p.memo.trim())?.memo?.trim() || null
      const currMethod = currPays[0]?.method || null
      const prevMethod = prevPays[0]?.method || null
      const paymentDate = currPays[0]?.payment_date ?? null
      const prevPayDate = prevPays
        .map(p => p.payment_date)
        .filter(Boolean)
        .sort()[0] || null

      // 지난달 결제일 대비 지연일수 (due_day 없으면 null)
      let prevDaysLate: number | null = null
      if (prevPayDate && dueDay) {
        const payD = new Date(prevPayDate + 'T00:00:00')
        const dueD = new Date(prevY, prevM - 1, dueDay)
        prevDaysLate = Math.floor((payD.getTime() - dueD.getTime()) / (24 * 60 * 60 * 1000))
      }

      return {
        id: s.id,
        name: s.name,
        grade: '',
        class_name: s.class?.name || '',
        subject: s.class?.subject || null,
        fee,
        due_day: dueDay,
        paid,
        status,
        payment_method: currMethod,
        payment_date: paymentDate,
        current_memo: currMemo,
        prev_memo: prevMemo,
        prev_payment_method: prevMethod,
        prev_payment_date: prevPayDate,
        prev_days_late: prevDaysLate,
        is_amount_modified: s.custom_fee != null,
        electives: s.electives ?? [],
        phone_available: !!(s.parent_phone || s.phone),
      }
    })

    try {
      const res = await fetch('/api/agent/filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, context: { students: studentContext, billing_month: selectedMonth } }),
      })
      const data = await res.json()
      if (!res.ok) {
        // 서버 에러(500 등)를 "결과 없음" 필터 적용으로 오인하지 않기 (2026-07-10 전수점검 C12)
        toast.error(data.error || 'AI 필터 처리 실패')
        return
      }
      if (data.student_ids && data.student_ids.length > 0) {
        setAiFilterIds(new Set(data.student_ids))
        setAiFilterDesc(data.description || '필터 적용')
      } else {
        setAiFilterIds(new Set())
        setAiFilterDesc(data.description || '결과 없음')
      }
    } catch {
      toast.error('AI 필터 처리 중 오류가 발생했습니다.')
    }
    setAiFilterLoading(false)
  }, [grades, selectedMonth, prevMonth, paymentsByStudentId, prevPayments, getDueDay])

  const clearAiFilter = useCallback(() => {
    setAiFilterIds(null)
    setAiFilterDesc('')
  }, [])

  // 현재 필터에 해당하는 모든 반의 미납 학생을 한방에 발송
  const openFilterBulkBillModal = useCallback(() => {
    const targets: BulkBillTarget[] = []
    const studentClsMap = new Map<string, ClassWithStudents>()
    const prevUnpaidNames: string[] = []
    // 정규 청구서는 이미 나갔고 **선택과목분만** 늦은 학생 — 일괄은 정규 기준으로 도니 여기서 빠진다.
    // 그대로 태우면 정규 청구서가 한 장 더 나간다(sendOneBill 은 분할 결제일 학생에게 정규+선택을 함께 보낸다).
    // 그래서 제외하되 **누가 빠졌는지 모달에 적어** 개별 발송으로 넘긴다. (2026-09-12 코드 검수 P2)
    const electivesOnlyNames: string[] = []
    for (const grade of grades) {
      for (const cls of grade.classes ?? []) {
        const classStudents = getActiveStudents(cls.students ?? [], selectedMonth).filter(s => passesFilter(s, cls as ClassWithStudents))
        for (const s of classStudents) {
          const phone = billingPhone(s)
          const fee = getStudentFee(s, cls as ClassWithStudents)
          // 다른 결제수단으로 이미 선결제 완료된 학생은 제외
          const alreadyPaid = (paymentsByStudentId.get(s.id) ?? []).length > 0
          if (isBatchExcluded(s, selectedMonth)) continue // 이 달만 일괄 제외 지정
          if (paymentFilter === 'overdue_unsent' && phone && fee > 0 && !alreadyPaid && billByStudent.has(s.id)) {
            electivesOnlyNames.push(s.name)
          }
          if (!phone || fee <= 0 || billByStudent.has(s.id) || alreadyPaid) continue
          // 지난달 미납 학생은 일괄에서 제외 (2026-08-27 운영자님 지시)
          if (isPrevMonthUnpaid(s, fee)) { prevUnpaidNames.push(s.name); continue }
          targets.push({
            studentId: s.id,
            studentName: s.name,
            className: formatClassName(cls),
            amount: fee,
          })
          studentClsMap.set(s.id, cls as ClassWithStudents)
        }
      }
    }
    if (targets.length === 0) {
      // 어제 만든 안내(excludedNote)는 모달 안에 있었다 — 대상이 전원 '선택과목분만 지연'이면
      // 모달이 안 열려 안내에 도달할 길이 없었다. 그 경우 명단을 토스트로 직접 띄운다.
      // (2026-09-13 코드 검수 High)
      if (electivesOnlyNames.length) {
        toast.info(`선택과목분만 지연된 ${electivesOnlyNames.length}명은 일괄로 못 보냅니다 — 개별 발송: ${electivesOnlyNames.join('·')}`)
      }
      return
    }
    const labelPrefix = customActive ? customLabel : FILTER_LABELS[paymentFilter]
    setBulkBillTarget({
      className: `${labelPrefix} 일괄`,
      targets,
      studentClsMap,
      excludedNote: [
        prevUnpaidNames.length ? `지난달 미납 ${prevUnpaidNames.length}명 제외: ${prevUnpaidNames.join('·')}` : '',
        electivesOnlyNames.length ? `선택과목분만 지연된 ${electivesOnlyNames.length}명은 개별 발송: ${electivesOnlyNames.join('·')}` : '',
      ].filter(Boolean).join(' / ') || undefined,
    })
  }, [grades, selectedMonth, passesFilter, billByStudent, paymentFilter, paymentsByStudentId, customActive, customLabel, isPrevMonthUnpaid])

  // ─── Visible sections (스크롤 아코디언용) ───────────────────────
  type SectionRef = { key: string; classIds: string[] }
  const visibleSections = useMemo<SectionRef[]>(() => {
    const list: SectionRef[] = []
    for (const { subject, grades: sgs } of subjectGradeGroups) {
      for (const { gradeId, classes: gcs } of sgs) {
        const classIds: string[] = []
        for (const cls of gcs) {
          const active = getActiveStudents(cls.students ?? [], selectedMonth)
          const students = active.filter(s => passesFilter(s, cls))
          if (students.length > 0) classIds.push(cls.id)
        }
        if (classIds.length === 0) continue
        list.push({ key: `${subject}__${gradeId}`, classIds })
      }
    }
    return list
  }, [subjectGradeGroups, selectedMonth, passesFilter])

  // 반별 납부 통계 (paidCount/totalCount/isFullyPaid)
  const classStats = useMemo(() => {
    const map = new Map<string, { paidCount: number; totalCount: number; isFullyPaid: boolean }>()
    for (const g of grades) {
      for (const cls of g.classes) {
        // 퇴원생 제외 — 별도 섹션에 표시(2026-05-19 사용자 지시). 반 stats에서도 제외 안 하면
        // 퇴원생이 분모에 남아 paidCount<totalCount가 되고 isFullyPaid=false → 반이 안 접힘.
        const active = getActiveStudents(cls.students ?? [], selectedMonth).filter(s => !s.withdrawal_date)
        // '이 달만 일괄 제외 + 청구 없음'만 분모에서 뺀다 — 행 배지의 '이달 청구없음' 판정과
        // **같은 헬퍼**(isBatchExcludedNoBill)를 쓴다. 제외월이어도 개별 청구가 나갔으면 분모에
        // 남아야 한다: 무조건 빼면 그 학생이 빨간 미납인데 반은 완납으로 접혀 미납자가 숨는다
        // (2026-08-05 정국 — 배지 1cf9f0d 와 분모 77fd71c 기준이 갈려 생긴 실회귀, 코드 검수).
        const filtered = active
          .filter(s => {
            const slots = billsByStudent.get(s.id)
            return !isBatchExcludedNoBill(s, selectedMonth, !!(slots?.regular || slots?.electives))
          })
          .filter(s => passesFilter(s, cls))
        const paidCount = filtered.filter(s => {
          const paid = (paymentsByStudentId.get(s.id) ?? []).reduce((sum, p) => sum + p.amount, 0)
          // 행 배지(displayFee)와 동일하게 그 달 요금(과거=스냅샷) 기준 — 요금 인상 후 과거 달에서
          // 행은 전부 완납인데 헤더 카운트만 미납으로 어긋나던 불일치 (2026-07-10 전수점검)
          return getPaymentStatus(paid, feeForMonth(s.id, selectedMonth, getStudentFee(s, cls))) === 'paid'
        }).length
        const totalCount = filtered.length
        // 카드·간편결제(PAY)인데 영수증 사진 미등록 학생이 있으면 아직 할 일이 남음 → 완료(접힘) 처리 안 함 (2026-06-20 사용자 지시)
        const hasReceiptPending = filtered.some(s => {
          const latest = (paymentsByStudentId.get(s.id) ?? [])[0]
          return latest && (latest.method === 'card' || latest.method === 'pay') && (latest.receipt_images?.length ?? 0) === 0
        })
        map.set(cls.id, {
          paidCount,
          totalCount,
          isFullyPaid: totalCount > 0 && paidCount === totalCount && !hasReceiptPending,
        })
      }
    }
    return map
  }, [grades, selectedMonth, passesFilter, paymentsByStudentId, feeForMonth, billsByStudent])

  // 명단 표시 가드 — 아래 렌더에서도 쓴다.
  // billsLoading 포함: 청구서 상태가 늦게 오면 결제완료 건이 잠깐 미발송 아이콘으로 보여 재발송 오판 유발 (2026-07-02)
  // feeSnapshotsLoading 포함: 과거 달 진입 시 스냅샷 도착 전 라이브(인상된) 요금으로 판정돼
  // 완납 학생이 잠깐 미납으로 깜빡임 (rule.swr_loading_guard, 2026-07-10 전수점검)
  const dataLoading = loading || billsLoading || feeSnapshotsLoading || withdrawalStatusLoading || queueLoading

  // 기본: 보이는 반 전부 펼침 + 전원납부 완료 반은 자동 접힘
  useEffect(() => {
    const allIds = visibleSections.flatMap(s => s.classIds)
    if (allIds.length === 0) return
    // 바뀐 게 없으면 같은 Set 을 돌려받아 React 가 재렌더를 건너뛴다(#2 — 예전엔 매번 새 Set).
    // 규칙(미납 반 펼침·완납 반 접힘)은 그대로다.
    setExpandedClasses(prev => applyDefaultExpansion(prev, allIds.map(id => [id, !!classStats.get(id)?.isFullyPaid] as const)))
  }, [visibleSections, classStats])

  // 2026-09-26 C05 — 명단이 **처음 나타나는 렌더**에 기본 펼침이 이미 들어가 있게 한다.
  // 위 effect 는 페인트 **후**에 돌아서, 명단이 먼저 접힌(또는 이전 달 상태) 채 그려진 뒤 반 20여 개가 동시에
  // 높이 애니메이션을 했다(튕김·CLS). 데이터가 다 온 첫 렌더에서 한 번만 렌더 도중 상태를 맞춘다
  // (React '렌더 중 상태 조정' 패턴 → 커밋 전 재렌더). 반의 AnimatePresence initial={false} 라 첫 등장은
  // 애니메이션이 없다. 로딩(월 이동)으로 돌아가면 다시 무장한다. 이후 데이터 변화의 재적용은 위 effect 그대로.
  // 플래그로 한 번만 도는 조건이라 입력 참조가 매 렌더 바뀌어도 렌더 루프가 생기지 않는다.
  const [firstRevealApplied, setFirstRevealApplied] = useState(false)
  if (dataLoading) {
    if (firstRevealApplied) setFirstRevealApplied(false)
  } else if (!firstRevealApplied) {
    const allIds = visibleSections.flatMap(s => s.classIds)
    if (allIds.length > 0) {
      setFirstRevealApplied(true)
      setExpandedClasses(prev => applyDefaultExpansion(prev, allIds.map(id => [id, !!classStats.get(id)?.isFullyPaid] as const)))
    }
  }

  // 학생 행 펼침 시 자동 스크롤 — 우측 아이콘(Send/Mail/수납)이 화면 밖으로 밀리지 않게.
  // 2026-09-26 C05: 예전엔 120ms 타이머로 320ms 높이 애니메이션 **도중**에 재서 최종 높이를 과소 측정했고
  // 두 움직임(높이·부드러운 스크롤)이 겹쳤다. 지금은 인라인 폼 높이 애니메이션이 **끝난 뒤**
  // (onAnimationComplete) 한 번 잰다. 동작 줄이기에선 애니메이션이 없으므로 다음 프레임에 잰다.
  const reducedMotion = usePaperReducedMotion()
  const revealExpandedRow = useCallback((studentId: string) => {
    const el = document.querySelector(`[data-student-row="${studentId}"]`) as HTMLElement | null
    if (!el) return
    const rect = el.getBoundingClientRect()
    const viewportH = window.innerHeight
    const isMobile = !window.matchMedia('(min-width: 640px)').matches
    const bottomNavH = isMobile ? 80 : 0
    const desiredBottom = viewportH - bottomNavH
    const margin = 8
    if (rect.bottom > desiredBottom) {
      window.scrollBy({ top: rect.bottom - desiredBottom + margin, behavior: reducedMotion ? 'auto' : 'smooth' })
    }
  }, [reducedMotion])
  useEffect(() => {
    if (!expandedStudentId || !reducedMotion) return
    const frame = requestAnimationFrame(() => revealExpandedRow(expandedStudentId))
    return () => cancelAnimationFrame(frame)
  }, [expandedStudentId, reducedMotion, revealExpandedRow])

  // 펼쳐진 팬(fan) 외부 클릭 시 닫기 — 단, 날짜/결제수단 피커 포탈은 제외
  useEffect(() => {
    if (!expandedStudentId) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest(`[data-student-row="${expandedStudentId}"]`)) return
      // 포탈로 뜨는 피커 내부 클릭이면 무시 (피커는 자체 backdrop으로 닫힘)
      if (target.closest('[data-picker-portal]')) return
      setExpandedStudentId(null)
      setShowDatePicker(false)
      setShowMethodPicker(false)
    }
    // 팬이 열린 프레임에 즉시 닫히는 것 방지
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onPointerDown)
      document.addEventListener('touchstart', onPointerDown, { passive: true })
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [expandedStudentId])

  // ─── Swipe handlers (swipe-action-guide.md 기반) ──────────────
  const SPRING = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
  const EASE_OUT = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
  const MEMO_W = 160  // 왼쪽 비고 패널 너비 (단일 선택: 라벨+색상테이프+저장)
  const BADGE_W = 48  // 다중 선택 시 배지만 표시하는 너비
  const PAY_W = 150   // 오른쪽 결제 특이사항 패널 너비 (헤더: 배지+저장)

  const rowOffset = useCallback((id: string): number => {
    if (selectedMemoIds.has(id)) return selectedMemoIds.size >= 2 ? BADGE_W : MEMO_W
    if (swipeOpenPayId === id) return -PAY_W
    return 0
  }, [selectedMemoIds, swipeOpenPayId])

  // 다중선택 툴바를 제일 위 선택 학생 행 위에 플로팅 — 아래쪽에서 선택해도 가깝게 뜨도록
  useLayoutEffect(() => {
    if (selectedMemoIds.size < 2) return
    let rafId: number | null = null
    const update = () => {
      rafId = null
      let topY = Infinity
      for (const id of selectedMemoIds) {
        const el = document.querySelector(`[data-student-row="${id}"]`) as HTMLElement | null
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (rect.top < topY) topY = rect.top
      }
      const el = bulkToolbarRef.current
      if (isFinite(topY)) {
        const h = el?.offsetHeight ?? 50
        bulkToolbarTopRef.current = Math.max(topY - h - 6, 8)
      }
      // 스크롤 프레임마다 페이지 전체를 다시 그리던 setState(top) 대신 transform 만 쓴다(레이아웃 없음)
      if (el) el.style.transform = `translate3d(0, ${bulkToolbarTopRef.current}px, 0)`
    }
    const schedule = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [selectedMemoIds])

  const handleTouchStart = (e: React.PointerEvent, studentId: string) => {
    if (expandedStudentId) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    const baseOffset = rowOffset(studentId)
    touchRef.current = {
      startX: e.clientX, startY: e.clientY, currentX: e.clientX,
      id: studentId, el, decided: false, isHorizontal: false,
      baseOffset, wasOpen: baseOffset !== 0,
      pointerId: e.pointerId, captured: false,
    }
    // 포인터 캡처를 즉시 걸면 자식 버튼의 click 이벤트가 row로 redirect되어 데스크탑 클릭이 안 먹힘.
    // 가로 스와이프로 결정된 시점(handleTouchMove)에만 캡처를 건다.
  }

  const handleTouchMove = (e: React.PointerEvent) => {
    if (!touchRef.current) return
    const dx = e.clientX - touchRef.current.startX
    const dy = e.clientY - touchRef.current.startY
    touchRef.current.currentX = e.clientX

    if (!touchRef.current.decided) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        touchRef.current.decided = true
        touchRef.current.isHorizontal = Math.abs(dx) > Math.abs(dy)
        // 가로 스와이프로 판정된 시점에서만 포인터 캡처 (click 이벤트 보존)
        if (touchRef.current.isHorizontal && !touchRef.current.captured) {
          try {
            touchRef.current.el.setPointerCapture(touchRef.current.pointerId)
            touchRef.current.captured = true
          } catch {}
        }
      }
      return
    }
    if (!touchRef.current.isHorizontal) return

    const baseOffset = touchRef.current.baseOffset ?? 0
    let raw = baseOffset + dx

    // sqrt 감쇠 — 왼쪽 한계 -PAY_W, 오른쪽 한계 +MEMO_W (다중선택 중에도 rubber-band는 MEMO_W까지)
    const rightLimit = MEMO_W
    if (raw < -PAY_W) raw = -PAY_W - Math.sqrt(Math.abs(raw + PAY_W)) * 2
    else if (raw > rightLimit) raw = rightLimit + Math.sqrt(raw - rightLimit) * 2

    touchRef.current.el.style.transition = 'none'
    touchRef.current.el.style.transform = `translateX(${raw}px)`
  }

  const animateRowTo = (id: string, x: number, transition: string = SPRING) => {
    const el = document.querySelector(`[data-swipe-row="${id}"]`) as HTMLElement | null
    if (el) { el.style.transition = transition; el.style.transform = `translateX(${x}px)` }
  }

  const handleTouchEnd = () => {
    if (!touchRef.current) return
    const { el, id, isHorizontal, startX, currentX } = touchRef.current
    const dx = currentX - startX
    const baseOffset = touchRef.current.baseOffset ?? 0
    const wasOpen = touchRef.current.wasOpen
    const wasMemoSelected = selectedMemoIds.has(id)
    const wasPayOpen = swipeOpenPayId === id
    const prevCount = selectedMemoIds.size

    el.style.transition = SPRING

    if (isHorizontal && Math.abs(dx) > 10) {
      wasSwiped.current = true
      setTimeout(() => { wasSwiped.current = false }, 200)
    }

    if (!isHorizontal) {
      el.style.transform = wasOpen ? `translateX(${baseOffset}px)` : 'translateX(0)'
      touchRef.current = null
      return
    }

    const addMemoSelection = () => {
      // 2번째 추가 시 기존 선택 행을 MEMO_W → BADGE_W 축소
      if (prevCount === 1) {
        selectedMemoIds.forEach(prevId => animateRowTo(prevId, BADGE_W))
      }
      const target = prevCount >= 1 ? BADGE_W : MEMO_W
      el.style.transform = `translateX(${target}px)`
      const student = allStudents.find(s => s.id === id)
      setSelectedMemoIds(prev => {
        const next = new Set(prev); next.add(id); return next
      })
      if (student && prevCount === 0) {
        setEditMemoValue(student.memo ?? '')
        setEditMemoColor(student.memo_color ?? null)
      }
    }

    const removeMemoSelection = () => {
      // 재스와이프로 해제 — EASE_OUT 부드러운 복귀
      el.style.transition = EASE_OUT
      el.style.transform = 'translateX(0)'
      setSelectedMemoIds(prev => {
        const next = new Set(prev); next.delete(id); return next
      })
      // 2개 → 1개 축소 시 남은 행을 BADGE_W → MEMO_W 확장
      if (prevCount === 2) {
        const remaining = Array.from(selectedMemoIds).find(sid => sid !== id)
        if (remaining) animateRowTo(remaining, MEMO_W)
      }
    }

    // 우로 밀기
    if (dx > 60) {
      if (wasPayOpen) {
        // 결제특이사항 닫고 비고 선택으로 전환
        setSwipeOpenPayId(null)
        addMemoSelection()
      } else if (!wasMemoSelected) {
        // 비고 선택에 추가
        addMemoSelection()
      } else {
        // 이미 선택됨 → 재스와이프로 해제
        removeMemoSelection()
      }
    }
    // 좌로 밀기
    else if (dx < -60) {
      if (wasMemoSelected) {
        // 비고 선택에서 해제 (해당 학생만)
        removeMemoSelection()
      } else if (selectedMemoIds.size > 0) {
        // 다른 학생이 비고 활성화 중 → 전체 해제 (EASE_OUT)
        el.style.transition = EASE_OUT
        el.style.transform = wasOpen ? `translateX(${baseOffset}px)` : 'translateX(0)'
        selectedMemoIds.forEach(prevId => animateRowTo(prevId, 0, EASE_OUT))
        setSelectedMemoIds(new Set())
        setEditMemoValue('')
        setEditMemoColor(null)
      } else if (wasPayOpen) {
        // 결제특이사항 닫기
        el.style.transition = EASE_OUT
        el.style.transform = 'translateX(0)'
        setSwipeOpenPayId(null)
      } else {
        // 결제특이사항 열기
        el.style.transform = `translateX(-${PAY_W}px)`
        setSwipeOpenPayId(id)
        const sp = paymentsByStudentId.get(id) ?? []
        const { cleanMemo } = decodePaymentMemo(sp[0]?.memo)
        setEditPayMemoValue(cleanMemo ?? '')
      }
    }
    // 임계값 미달 → 원위치
    else {
      el.style.transform = wasOpen ? `translateX(${baseOffset}px)` : 'translateX(0)'
    }

    touchRef.current = null
  }

  const closeAllMemoSelections = () => {
    selectedMemoIds.forEach(id => animateRowTo(id, 0, EASE_OUT))
    setSelectedMemoIds(new Set())
    setEditMemoValue('')
    setEditMemoColor(null)
  }

  const closeSwipeEdit = () => {
    if (swipeOpenPayId) {
      animateRowTo(swipeOpenPayId, 0, EASE_OUT)
      setSwipeOpenPayId(null)
    }
    if (selectedMemoIds.size > 0) closeAllMemoSelections()
  }

  const handleSaveMemo = async (studentId: string) => {
    const memo = editMemoValue.trim() || null
    const { error } = await safeMutate(`/api/students/${studentId}`, 'PUT', { memo, memo_color: editMemoColor })
    if (error) { toast.error('저장 실패'); return }
    closeSwipeEdit()
    await fetchData()
  }

  const handleBulkSaveMemo = async () => {
    if (selectedMemoIds.size === 0) return
    setBulkSaving(true)
    const memo = editMemoValue.trim() || null
    const ids = Array.from(selectedMemoIds)
    const results = await Promise.all(
      ids.map(id => safeMutate(`/api/students/${id}`, 'PUT', { memo, memo_color: editMemoColor }))
    )
    setBulkSaving(false)
    const failed = results.filter(r => r.error).length
    if (failed > 0) { toast.error(`${failed}건 저장 실패`); return }
    closeAllMemoSelections()
    await fetchData()
  }

  const handleSavePayMemo = async (studentId: string) => {
    const sp = paymentsByStudentId.get(studentId) ?? []
    const payment = sp[0]
    if (!payment) { toast.error('이번 달 납부 기록이 없어 결제 특이사항을 저장할 수 없습니다'); return }
    const memo = editPayMemoValue.trim() || null
    const { error } = await safeMutate(`/api/payments/${payment.id}`, 'PUT', { memo })
    if (error) { toast.error('저장 실패'); return }
    closeSwipeEdit()
    await fetchData()
  }

  // ─── Inline payment ──────────────────────────────────────────
  const handleExpand = (studentId: string) => {
    if (wasSwiped.current) return
    closeSwipeEdit()
    if (expandedStudentId === studentId) { setExpandedStudentId(null); return }
    setExpandedStudentId(studentId)
    setInlineDate(today)
    const prevPayment = prevPayments.find(p => p.student_id === studentId)
    // prevPayment의 method가 'payssam'이면 무시(자동 callback에서만 등록) → 디폴트 'card'
    const prevM = prevPayment?.method as PaymentMethod | undefined
    setInlineMethod(prevM && prevM !== 'payssam' ? prevM : 'card')
    setShowMethodPicker(false)
    setShowDatePicker(false)
    const prev = stripBillTags(getPrevMemo(studentId)) // 지난달 결제선생 태그는 수동 납부로 복사하지 않는다(2026-09-27, verifier)
    setInlineMemo(prev)
    setInlineMemoFromPrev(!!prev)
  }

  const handleInlineSubmit = async (studentId: string, fee: number) => {
    // student-specific 가드: 같은 학생의 결제 중복만 막기 (다른 학생 stuck 상태와 무관하게 진행)
    if (inlineSuccess === studentId || inlineSubmitting === studentId) return
    setInlineSubmitting(studentId)
    try {
      const { data: created, error } = await safeMutate<Payment>('/api/payments', 'POST', {
        student_id: studentId, amount: fee, method: inlineMethod,
        payment_date: inlineDate, billing_month: selectedMonth,
        ...(inlineMemo.trim() ? { memo: inlineMemo.trim() } : {}),
      })
      if (error) {
        setInlineSubmitting(null)
        toast.error(`결제 처리 실패: ${error}`)
        return
      }
      // Optimistic: 응답 받은 결제 row를 SWR 캐시에 즉시 주입 → UI 즉시 반영
      if (created) injectPayment(selectedMonth, created)
      setInlineSubmitting(null)
      setInlineSuccess(studentId)
      // 체크 표시 후 우측으로 슬라이드하며 접힘
      setTimeout(() => {
        setInlineSlideOut(studentId)
      }, 400)
      setTimeout(async () => {
        await fetchData()
        setInlineSuccess(null)
        setInlineSlideOut(null)
        setExpandedStudentId(null)
      }, 1000)
    } catch (e) {
      setInlineSubmitting(null)
      toast.error(`결제 처리 오류: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ─── Modal handlers ───────────────────────────────────────────
  const handleOpenModal = (studentId: string, fee: number) => {
    if (wasSwiped.current) return
    const existing = payments.find(p => p.student_id === studentId)
    setSelectedStudentId(studentId)
    setSelectedStudentFee(fee)
    setSelectedPayment(existing || null)
    setSelectedPrevMemo(getPrevMemo(studentId))
    const prevPayment = prevPayments.find(p => p.student_id === studentId)
    setSelectedPrevMethod(prevPayment?.method as PaymentMethod || null)
    setShowPaymentModal(true)
  }

  const handleSavePayment = async (data: Partial<Payment>) => {
    const { data: created, error } = await safeMutate<Payment>('/api/payments', 'POST', data)
    if (error) { toast.error(`납부 저장 실패: ${error}`); return }
    fetchData()
    return created ? { id: created.id } : undefined
  }

  const handleUpdatePayment = async (paymentId: string, data: Partial<Payment>) => {
    const { error } = await safeMutate(`/api/payments/${paymentId}`, 'PUT', data)
    if (error) { toast.error(`수정 실패: ${error}`); return }
    setSelectedPayment(prev => prev && prev.id === paymentId ? { ...prev, ...data } as Payment : prev)
    fetchData()
  }

  const handleDeletePayment = async (paymentId: string) => {
    const { error } = await safeMutate(`/api/payments/${paymentId}`, 'DELETE')
    if (error) { toast.error(`삭제 실패: ${error}`); return }
    setShowPaymentModal(false)
    setSelectedPayment(null)
    fetchData()
  }

  // ─── Pull-to-refresh ──────────────────────────────────────
  // 공용 훅으로 대체 — 인라인 구현엔 try/finally가 없어 refresh 실패 시 스피너가 멈춰있던 잠재버그도 함께 해소.
  const PULL_THRESHOLD = 60
  // 표시(컨테이너 translate·아이콘 회전/크기/투명도)는 rAF 에서 DOM 에 직접 쓴다 — touchmove 마다
  // 페이지 전체를 다시 그리던 것 제거(2026-09-26 C07). 임계·새로고침 흐름은 그대로.
  const pullVisual = usePullRefreshIndicator(PULL_THRESHOLD)
  const { containerRef, isRefreshing } = usePullToRefresh({
    onRefresh: async () => { fetchData() },
    threshold: PULL_THRESHOLD,
    onPull: pullVisual.onPull,
  })

  // ─── Student add ────────────────────────────────────────────
  const handleAddStudent = (classId: string) => {
    setAddStudentClassId(classId)
    setShowStudentModal(true)
  }

  const handleSaveStudent = async (data: Partial<Student>) => {
    const { data: saved, error } = await safeMutate<{ _codeConflict?: 'none' | 'middle' | 'both'; _attendanceCode?: string }>('/api/students', 'POST', data)
    if (error) { toast.error(`학생 등록 실패: ${error}`); return }
    if (saved?._codeConflict === 'middle') toast.warning(`출결코드 뒷자리가 중복되어 가운데 번호 ${saved._attendanceCode}로 등록했습니다`)
    else if (saved?._codeConflict === 'both') toast.error(`출결코드가 뒷자리·가운데 모두 중복됩니다. 수동 확인 필요 (현재 ${saved._attendanceCode})`)
    setShowStudentModal(false)
    fetchData()
  }

  // ─── Render ───────────────────────────────────────────────────
  // (dataLoading 은 위 '명단 표시 가드'에서 계산 — 기본 펼침 첫 적용과 같은 값을 쓴다)

  // 학생 1줄 렌더 — 일반 반 목록 + 퇴원 "처리중/처리완료" 반에서 동일하게 재사용 (2026-05-30 사용자 지시)
  // classLabel: 퇴원 반처럼 여러 학년·반이 섞일 때 이름 옆에 원래 학년·반 표시
  const renderStudentRow = (student: Student, cls: ClassWithStudents, idx: number, classLabel?: string) => {
                      const fee = getStudentFee(student, cls) // 청구·모달 기본금액은 항상 현재 요금
                      const displayFee = feeForMonth(student.id, selectedMonth, fee) // 상태 판정은 그 달 요금(과거=스냅샷)
                      const studentPayments = getStudentPayments(student.id)
                      const paid = studentPayments.reduce((s, p) => s + p.amount, 0)
                      const status = getPaymentStatus(paid, displayFee)
                      const scheduled = status === 'unpaid' && checkScheduled(student, selectedMonth)
                      const isSplit = hasSplitDueDays(student)
                      const slots = billsByStudent.get(student.id)
                      const electivesPaid = slots?.electives?.status === 'paid'
                      const regularPaid = slots?.regular?.status === 'paid'
                      // 분할발송 상태에서 선택과목만 결제완료된 경우 → 노란색 + "선택과목 결제완료"
                      const electivesOnlyPaid = isSplit && status !== 'paid' && electivesPaid && !regularPaid
                      const regularOnlyPaid = isSplit && status !== 'paid' && regularPaid && !electivesPaid
                      // 요금 미설정(custom_fee 없음 + 반 요금 0)은 가짜 완납 대신 회색 "요금미설정" 표시 (2026-07-02)
                      // custom_fee=0 명시(의도적 무료)는 기존대로 완납 취급
                      const feeUnset = displayFee <= 0 && student.custom_fee == null
                      // '이 달만 일괄 제외'는 그 달에 **청구 자체가 없다**는 뜻이다(반이동 정산·초과결제 차감 등).
                      // 그런데 상태는 여전히 unpaid 라 빨간 '미납'이 떴다 — 볼 때마다 안 낸 것처럼 보인다.
                      // 2026-08-05 운영자님 "8월은 태연 없도록": 회색 '이달 청구없음'으로 바꾼다.
                      // ⚠️ 색만 바꾸면 반쪽이다 — **classStats 분모에서도 빼야** 반이 완납으로 접힌다(둘은 짝이다).
                      // 🔴 청구서가 실제로 나갔으면 '청구없음'이 아니다 — 2026-08-05 정국 실측:
                      //   제외 표시를 유지한 채 개별 청구 400,000 을 보냈는데 화면은 '이달 청구없음'이라 말했다.
                      //   제외는 '일괄에서 빼라'는 뜻이지 '청구가 없다'는 뜻이 아니다. 청구가 있으면 그 상태를 보여라.
                      const batchExcluded = isBatchExcludedNoBill(student, selectedMonth, !!(slots?.regular || slots?.electives))
                      const displayColors = feeUnset || (batchExcluded && status === 'unpaid')
                        ? { bg: 'var(--bg-elevated)', text: 'var(--text-3)' }
                        : electivesOnlyPaid
                        ? { bg: 'var(--orange-dim)', text: 'var(--scheduled-text)' }
                        : scheduled ? { bg: 'var(--scheduled-bg)', text: 'var(--scheduled-text)' } : PAYMENT_STATUS_COLORS[status]
                      let displayLabel = ''
                      if (batchExcluded && status === 'unpaid') {
                        displayLabel = '이달 청구없음'
                      } else if (feeUnset) {
                        displayLabel = '요금미설정'
                      } else if (electivesOnlyPaid) {
                        displayLabel = '선택과목 결제완료'
                      } else if (regularOnlyPaid) {
                        displayLabel = '정규원비 결제완료'
                      } else if (status === 'unpaid') {
                        displayLabel = getUnpaidLabelText(student, selectedMonth, student.payment_due_day ?? undefined)
                      } else if (studentPayments.length > 0) {
                        // 배지는 학생의 고정 결제일 (scheduled due day) — 실제 납부일과 무관
                        const billingMonth = parseInt(selectedMonth.split('-')[1])
                        displayLabel = `${billingMonth}/${getDueDay(student)} 납부`
                      } else {
                        displayLabel = PAYMENT_STATUS_LABELS[status]
                      }
                      const prevMemo = getPrevMemo(student.id)
                      const prevMethod = getPrevMethod(student.id)
                      // 'remote'(비대면)은 이전 결제선생 레거시 표기 → payssam과 동일 취급
                      const prevMethodNonPayssam = prevMethod && prevMethod !== 'payssam' && prevMethod !== 'remote' ? prevMethod : null
                      const currentMemo = studentPayments[0]?.memo
                      const isExpanded = expandedStudentId === student.id && status === 'unpaid'
                      const isSuccess = inlineSuccess === student.id
                      const isSubmitting = inlineSubmitting === student.id
                      const { cleanMemo } = decodePaymentMemo(currentMemo)
                      const hasMemo = !!(prevMemo || cleanMemo || student.memo || prevMethodNonPayssam)
                      const isMemoSelected = selectedMemoIds.has(student.id)
                      const isPayOpen = swipeOpenPayId === student.id
                      const isSwipeOpen = isMemoSelected || isPayOpen
                      const openSide: 'left' | 'right' | null = isMemoSelected ? 'left' : isPayOpen ? 'right' : null
                      const isMultiSelect = selectedMemoIds.size >= 2
                      const isSoleMemoSelection = isMemoSelected && selectedMemoIds.size === 1
                      const memoColor = student.memo_color ?? null
                      const nameHighlight = memoColor === 'yellow' ? 'bg-[var(--orange-dim)] text-[var(--scheduled-text)] px-2 py-0.5'
                        : memoColor === 'green' ? 'bg-[var(--paid-bg)] text-[var(--paid-text)] px-2 py-0.5'
                        : memoColor === 'red' ? 'bg-[var(--unpaid-bg)] text-[var(--unpaid-text)] px-2 py-0.5'
                        : ''
                      const tornTapeStyle = memoColor ? {
                        clipPath: 'polygon(3% 0%, 12% 4%, 24% 0%, 38% 5%, 52% 0%, 66% 4%, 80% 0%, 92% 5%, 100% 12%, 96% 30%, 100% 50%, 97% 70%, 100% 88%, 94% 100%, 82% 96%, 68% 100%, 54% 95%, 40% 100%, 26% 96%, 12% 100%, 4% 94%, 0% 82%, 4% 64%, 0% 48%, 3% 30%, 0% 14%)',
                        display: 'inline-block',
                      } : undefined
                      const withdrawn = isWithdrawnStudent(student)
                      // 지난달 미납 판정 — 공용 함수(isPrevMonthUnpaid)로: 스냅샷 요금 비교(2026-07-02) +
                      // 조정 청구 완납은 미납 아님(2026-08-27 카리나) + 일괄청구 제외와 동일 기준.
                      const prevUnpaid = isPrevMonthUnpaid(student, fee)

                      // 2026-07-03 사용자 지시: 결제일 임박했는데 아직 결제선생 청구서가 안 나간 학생 표시.
                      // 청구서 발송(scheduled/sent/paid)되면 조건에서 빠져 배지 자동 소멸. 자동 발송은 하지 않음(리마인더만).
                      const billUnsentRegular = getBillStatus(student.id, 'regular') === 'unsent'
                      const daysUntilDue = getDueDay(student) - parseInt(getTodayString().slice(8, 10))
                      const billDueSoon = selectedMonth === currentKstMonth && status === 'unpaid' && billUnsentRegular
                        && !withdrawn && !!(student.parent_phone || student.phone) && displayFee > 0
                        && daysUntilDue <= 3 // 결제일 3일 전부터 (지나도 계속 표시)
                      const billDueLabel = daysUntilDue < 0 ? '청구 지연' : daysUntilDue === 0 ? '청구 D-day' : `청구 D-${daysUntilDue}`

                      // 분할발송 학생용 청구서 아이콘 (정규/선택과목 각각 자기 라이프사이클)
                      // 비분할 학생도 동일 helper 사용 — billType='regular' 고정
                      const renderBillIconButton = (st: Student, c: ClassWithStudents, billType: 'regular' | 'electives') => {
                        const billStatus = getBillStatus(st.id, billType)
                        const bill = billsByStudent.get(st.id)?.[billType]
                        const queueEntry = queuesByStudent.get(st.id)?.[billType]
                        const scheduledAtKst = queueEntry ? formatKst(new Date(queueEntry.scheduled_at)) : null
                        const labelPrefix = isSplit ? (billType === 'electives' ? '선택과목 ' : '정규 ') : ''
                        // 분할발송에서 한쪽만 paid면 노란색, 둘 다 paid면 파란색
                        const partialPaid = isSplit && billStatus === 'paid' && !(electivesPaid && regularPaid)
                        const styles: Record<BillStatus, { fg: string; bg: string; title: string }> = {
                          unsent:    { fg: 'var(--text-4)', bg: 'var(--bg-elevated)', title: `${labelPrefix}카톡 청구서 발송` },
                          sent:      { fg: 'var(--scheduled-text)', bg: 'var(--orange-dim)',  title: `${labelPrefix}발송됨 — 탭하여 파기` },
                          scheduled: { fg: 'var(--scheduled-text)', bg: 'var(--orange-dim)',  title: scheduledAtKst ? `${labelPrefix}타임락 예약 — ${scheduledAtKst} KST 자동 발송` : `${labelPrefix}타임락 예약됨` },
                          paid:      partialPaid
                            ? { fg: 'var(--scheduled-text)', bg: 'var(--orange-dim)', title: `${labelPrefix}결제완료 — 탭하여 취소` }
                            : { fg: 'var(--blue)', bg: 'var(--blue-dim)', title: `${labelPrefix}수납 완료 — 탭하여 취소` },
                          cancelled: { fg: 'var(--red)',    bg: 'var(--red-dim)',     title: `${labelPrefix}결제 취소됨 — 탭하여 재발송` },
                          destroyed: { fg: 'var(--red)',     bg: 'var(--red-dim)',     title: `${labelPrefix}청구서 파기됨 — 탭하여 재발송` },
                        }
                        const sty = styles[billStatus]
                        const resendCount = bill?.resend_count ?? 0
                        const showBadge = billStatus === 'sent' && resendCount > 0
                        const smsCount = bill?.overdue_sms_count ?? 0
                        const showSmsBadge = smsCount > 0
                        const sendAmount = isSplit
                          ? (billType === 'electives' ? getStudentElectivesFee(st) : getStudentBaseFee(st, c))
                          : fee
                        return (
                          <motion.button
                            key={billType}
                            whileTap={ICON_PRESS}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (billStatus === 'scheduled') return
                              if ((billStatus === 'sent' || billStatus === 'paid') && bill) {
                                setBillActionTarget({
                                  studentId: st.id,
                                  studentName: st.name,
                                  phone: billingPhone(st),
                                  billId: bill.bill_id,
                                  amount: bill.amount,
                                  status: billStatus,
                                  subject: c.subject ?? null,
                                  paymentDueDay: st.payment_due_day ?? null,
                                })
                              } else {
                                const parentPhone = billingPhone(st)
                                setBillSendTarget({
                                  studentId: st.id,
                                  studentName: st.name,
                                  phone: parentPhone,
                                  amount: sendAmount,
                                  subject: c.subject ?? null,
                                  className: c.name ?? null,
                                  // 분리발송의 정규 건 제목에 "+확통" 방지 — 금액에 선택과목이 포함될 때만 전달 (2026-07-10)
                                  electives: isSplit && billType === 'regular' ? [] : (st.electives ?? []),
                                  billType,
                                })
                              }
                            }}
                            className="hit-slop p-1 rounded-lg shrink-0 hover:opacity-80 transition-[color,background-color] duration-300 flex items-center justify-center overflow-visible"
                            style={{ color: sty.fg, backgroundColor: sty.bg, ...(isSplit ? (billType === 'regular' ? HIT_SPLIT_FIRST : HIT_SPLIT_LAST) : HIT_ROW) }}
                            aria-label={showBadge ? `${sty.title} — 재발송 ${resendCount}회` : sty.title}
                            title={showBadge ? `${sty.title} · 재발송 ${resendCount}회` : sty.title}
                          >
                            <span key={billStatus} className="flex items-center justify-center animate-fade-in">
                              {billStatus === 'sent' ? (
                                <Mail className="w-3.5 h-3.5" />
                              ) : billStatus === 'paid' ? (
                                <Send className="w-3.5 h-3.5" style={{ transform: 'rotate(180deg)' }} />
                              ) : billStatus === 'cancelled' ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                  <g opacity="0.5" transform="rotate(180 12 12)">
                                    <path d="m22 2-7 20-4-9-9-4Z" />
                                    <path d="M22 2 11 13" />
                                  </g>
                                  <line x1="3.5" y1="3.5" x2="20.5" y2="20.5" />
                                </svg>
                              ) : billStatus === 'destroyed' ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                  <g transform="translate(-1.6 0.3) rotate(-8 7 12)">
                                    <path d="M2 4 a2 2 0 0 1 2 -2 h8 v18 h-8 a2 2 0 0 1 -2 -2 z" />
                                    <path d="M2 4 l10 6.5" />
                                    <path d="M12 2 l-1 1.5 l1 1.5 l-1 1.5 l1 1.5 l-1 1.5 l1 1.5 l-1 1.5 l1 1.5 l-1 1.5 l1 1.5 l-1 1.5" strokeWidth="1.5" />
                                  </g>
                                  <g transform="translate(1.6 0.3) rotate(8 17 12)">
                                    <path d="M12 2 l1 1.5 l-1 1.5 l1 1.5 l-1 1.5 l1 1.5 l-1 1.5 l1 1.5 l-1 1.5 l1 1.5 l-1 1.5 l1 1.5" strokeWidth="1.5" />
                                    <path d="M12 2 h8 a2 2 0 0 1 2 2 v14 a2 2 0 0 1 -2 2 h-8 z" />
                                    <path d="M22 4 l-10 6.5" />
                                  </g>
                                </svg>
                              ) : (
                                <Send className="w-3.5 h-3.5" />
                              )}
                            </span>
                            {billStatus === 'scheduled' && (
                              <span
                                className="absolute -bottom-1 -right-1 w-[12px] h-[12px] rounded-full flex items-center justify-center animate-fade-in"
                                style={{ background: 'var(--orange)', color: 'var(--on-action)' }}
                                aria-hidden
                              >
                                <Clock className="w-[8px] h-[8px]" strokeWidth={3} />
                              </span>
                            )}
                            {showBadge && (
                              <span
                                className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full flex items-center justify-center text-[9px] font-bold leading-none animate-fade-in"
                                style={{ background: 'var(--red)', color: 'var(--on-action)' }}
                                aria-hidden
                              >
                                {resendCount}
                              </span>
                            )}
                            {showSmsBadge && billStatus !== 'scheduled' && (
                              <span
                                className="absolute -bottom-1 -right-1 min-w-[14px] h-[7px] px-[2px] rounded-[2px] flex items-center justify-center font-bold leading-none tracking-tight animate-fade-in"
                                style={{ background: 'var(--blue)', color: 'var(--on-action)', fontSize: '5.5px' }}
                                title={smsCount > 1 ? `미납 안내 문자 ${smsCount}회 발송` : '미납 안내 문자 발송됨'}
                                aria-label={smsCount > 1 ? `미납 안내 문자 ${smsCount}회 발송됨` : '미납 안내 문자 발송됨'}
                              >
                                SMS
                              </span>
                            )}
                          </motion.button>
                        )
                      }

                      return (
                        <div key={student.id} data-student-row={student.id} className="relative">
                          {/* 위층: 행 높이 (좌/우 패널 헤더 + 메인 콘텐츠) */}
                          <div className="relative overflow-hidden">
                            {/* 왼쪽 패널 헤더 — 비고 라벨 + 색상 테이프 + 저장 (다중선택 시 배지만) */}
                            <div data-edit-panel className={`absolute inset-y-0 left-0 ${isMultiSelect ? 'w-[48px] justify-center' : 'w-[160px] gap-1.5 px-2'} flex items-center bg-[var(--bg-elevated)] transition-[width] duration-300 ease-out`} onClick={e => e.stopPropagation()}>
                              {isMultiSelect ? (
                                <div className="w-6 h-6 rounded-full bg-[var(--blue-bg)] flex items-center justify-center">
                                  <Check className="w-3.5 h-3.5 text-[var(--blue)]" strokeWidth={3} />
                                </div>
                              ) : (
                                <>
                                  <span className="text-[10px] font-bold text-[var(--text-3)] shrink-0">비고</span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {(['yellow', 'green', 'red'] as const).map(c => {
                                      const bg = c === 'yellow' ? 'bg-[var(--orange-dim)]' : c === 'green' ? 'bg-[var(--paid-bg)]' : 'bg-[var(--unpaid-bg)]'
                                      const active = editMemoColor === c
                                      return (
                                        <TButton
                                          key={c}
                                          type="button"
                                          onClick={() => setEditMemoColor(active ? null : c)}
                                          className={`w-6 h-3 rounded-[2px] ${bg} ${active ? 'ring-1 ring-[var(--text-1)] shadow-md' : 'opacity-60'}`}
                                          style={{ transform: 'skewX(-10deg)' }}
                                          aria-label={`색상 ${c}`}
                                        />
                                      )
                                    })}
                                  </div>
                                  <TButton onClick={() => handleSaveMemo(student.id)} className="ml-auto p-1.5 bg-[var(--blue-bg)] hover:bg-[var(--blue-dim)] text-[var(--blue)] rounded-full shrink-0 transition-colors" aria-label="저장">
                                    <Check className="w-3.5 h-3.5" strokeWidth={3} />
                                  </TButton>
                                </>
                              )}
                            </div>

                            {/* 오른쪽 패널 헤더 — "결제특이사항" 배지 + 저장 */}
                            <div data-edit-panel className="absolute inset-y-0 right-0 w-[150px] flex items-center justify-between gap-1.5 px-2 bg-[var(--bg-elevated)]" onClick={e => e.stopPropagation()}>
                              <span className="text-[10px] font-bold text-[var(--scheduled-text)] px-2 py-0.5 rounded-full bg-[var(--orange-dim)] shrink-0">결제특이사항</span>
                              <TButton onClick={() => handleSavePayMemo(student.id)} className="p-1.5 bg-[var(--blue-bg)] hover:bg-[var(--blue-dim)] text-[var(--blue)] rounded-full shrink-0 transition-colors" aria-label="저장">
                                <Check className="w-3.5 h-3.5" strokeWidth={3} />
                              </TButton>
                            </div>

                            {/* 메인 콘텐츠 */}
                            <div
                              data-swipe-row={student.id}
                              className="relative bg-[var(--bg-card)] z-10"
                              onPointerDown={e => handleTouchStart(e, student.id)}
                              onPointerMove={handleTouchMove}
                              onPointerUp={handleTouchEnd}
                              onPointerCancel={handleTouchEnd}
                              style={{ transform: `translateX(${rowOffset(student.id)}px)`, transition: SPRING, touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none' }}
                            >
                            <div className={`flex items-center gap-2 px-4 py-0 ${
                              status === 'unpaid' && !isExpanded && !withdrawn ? 'cursor-pointer active:bg-[var(--bg-card-hover)]' : ''
                            } ${withdrawn ? 'opacity-60' : ''}`}
                              onClick={status === 'unpaid' && !isExpanded && !withdrawn ? () => handleExpand(student.id) : undefined}
                            >
                              <TButton
                                type="button"
                                className="flex-1 min-w-0 text-left"
                                onClick={e => {
                                  e.stopPropagation()
                                  if (wasSwiped.current) return
                                  if (withdrawn) {
                                    // 퇴원생 이름 탭 → 최종처분 메뉴 (계좌환불 완료/이번달까지 정리/퇴원 취소 + 환불계산기)
                                    // 결제선생 결제취소·청구서 파기는 청구 아이콘(BillActionModal)에서 처리
                                    setWithdrawMenuTarget({
                                      studentId: student.id,
                                      studentName: student.name,
                                      fee: getStudentFee(student, cls),
                                      enrollmentDate: student.enrollment_date,
                                      withdrawalDate: student.withdrawal_date,
                                      classDays: cls?.class_days,
                                      paymentDueDay: student.payment_due_day,
                                      phone: billingPhone(student),
                                      regularBillStatus: billByStudent.get(student.id)?.status ?? null,
                                    })
                                  } else {
                                    setDetailStudentId(student.id)
                                  }
                                }}
                              >
                                <span className="text-[11px] text-[var(--text-4)] mr-1 tabular-nums">{idx + 1}.</span>
                                <span className={`text-sm font-medium ${nameHighlight} ${withdrawn ? 'line-through decoration-red-500 decoration-2 text-[var(--text-4)]' : ''}`} style={tornTapeStyle}>{student.name}{duplicateNameStudentIds.has(student.id) && cls?.name ? <span className="text-[var(--blue)]">{formatClassName(cls)}</span> : ''}</span>
                                {(student.electives ?? []).length > 0 && (
                                  <span className="text-[11px] text-[var(--text-4)] ml-1.5">{(student.electives ?? []).join('/')}</span>
                                )}
                                {classLabel && (
                                  <span className="text-[9px] text-[var(--text-4)] ml-1.5 align-middle">{classLabel}</span>
                                )}
                                {/* 📵 = 청구서 수신자(결제선생 recipient) 기준 보호자 연락처 미등록.
                                    아버지 수신이면 아버지폰, 어머니 수신이면 어머니폰을 본다(반대편 번호로 폴백).
                                    학생 본인폰은 보호자 연락처가 아니므로 배지 판단에서 제외. (2026-07-17 원장 지시) */}
                                {!withdrawn && !(student.payssam_recipient === 'father'
                                  ? (student.parent_father_phone || student.parent_phone)
                                  : (student.parent_phone || student.parent_father_phone)) && (
                                  <span className="text-[9px] ml-1 px-1 py-0.5 rounded-full bg-[var(--orange-dim)] text-[var(--scheduled-text)] font-bold" title="보호자 연락처 미등록">📵</span>
                                )}
                                {!withdrawn && !(student.school ?? '').trim() && (
                                  <span className="text-[9px] ml-1 px-1 py-0.5 rounded-full bg-[var(--blue-dim)] text-[var(--blue)] font-bold" title="학교 미입력 — 학생 상세에서 입력">🏫?</span>
                                )}
                                {withdrawn && student.withdrawal_date && (() => {
                                  const d = getLastClassDate(new Date(student.withdrawal_date), cls?.class_days)
                                  return <span className="text-[10px] text-[var(--red)] ml-1.5" title="마지막 수업일">~{d.getMonth() + 1}/{d.getDate()}</span>
                                })()}
                                {!withdrawn && student.enrollment_date?.startsWith(selectedMonth) && (
                                  <span className="text-[9px] ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--blue-bg)] text-[var(--blue)] font-bold">신규</span>
                                )}
                                {!withdrawn && !student.phone && (
                                  <span className="text-[9px] ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--orange-dim)] text-[var(--scheduled-text)] font-bold" title="학생 본인 전화 미등록">학생번호 등록 필요</span>
                                )}
                                {prevUnpaid && (
                                  <span className="text-[9px] ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--unpaid-bg)] text-[var(--unpaid-text)] font-bold" title="지난달 미납">지난달 미납</span>
                                )}
                                {isBatchExcluded(student, selectedMonth) && (
                                  <span className="text-[9px] ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--orange-dim)] text-[var(--scheduled-text)] font-bold" title="이 달 정규 일괄청구에서 제외됨 — 개별 발송 필요">일괄 제외</span>
                                )}
                                {/* 보충비(비정규 별도청구) 배지 — 정규/특강 어디에도 안 뜨던 것 가시화 (2026-07-18 원장 지시) */}
                                {(() => {
                                  const sup = supplementBillByStudent.get(student.id)
                                  if (!sup) return null
                                  const paid = sup.status === 'paid'
                                  const amt = sup.amount % 10000 === 0 ? `${sup.amount / 10000}만` : formatWon(sup.amount)
                                  return (
                                    <span
                                      className="text-[9px] ml-1.5 px-1.5 py-0.5 rounded-full font-bold"
                                      style={paid
                                        ? { background: 'var(--paid-bg)', color: 'var(--paid-text)' }
                                        : { background: 'var(--orange-dim)', color: 'var(--scheduled-text)' }}
                                      title={`보충비 ${formatWon(sup.amount)} — ${paid ? '결제완료' : '미납(청구서 발송됨)'}`}
                                    >
                                      보충 {amt} {paid ? '완납' : '미납'}
                                    </span>
                                  )
                                })()}
                                {/* 결제일 임박 + 청구서 미발송 리마인더 (2026-07-03). 청구서 발송하면 조건에서 빠져 자동 소멸 */}
                                {billDueSoon && (
                                  <span
                                    className={`inline-flex items-center gap-0.5 text-[9px] ml-1.5 px-1.5 py-0.5 rounded-full font-bold animate-fade-in align-middle ${daysUntilDue < 0 ? 'bg-[var(--unpaid-bg)] text-[var(--unpaid-text)]' : 'bg-[var(--orange-dim)] text-[var(--scheduled-text)]'}`}
                                    title={daysUntilDue < 0 ? '결제일 지남 · 청구서 미발송' : '결제일 임박 · 청구서 미발송'}
                                  >
                                    <Send className="w-2.5 h-2.5" strokeWidth={2.5} /> {billDueLabel}
                                  </span>
                                )}
                                {/* 카드·간편결제(PAY) + 영수증 사진 미등록 → 등록 안내 배지 (2026-05-23, 페이 추가 2026-06-16)
                                    배지 탭 = 납부 모달(영수증 업로드) 직행 (2026-08-24 운영자님 — 청구서가 파기 상태면
                                    빨간 아이콘만 눈에 띄어 영수증 등록 진입로를 못 찾던 문제) */}
                                {(() => {
                                  const latest = studentPayments[0]
                                  if (!latest || (latest.method !== 'card' && latest.method !== 'pay')) return null
                                  if ((latest.receipt_images?.length ?? 0) > 0) return null
                                  const mlabel = latest.method === 'pay' ? '간편결제' : '카드결제'
                                  return (
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      onClick={(e) => { e.stopPropagation(); handleOpenModal(student.id, fee) }}
                                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); handleOpenModal(student.id, fee) } }}
                                      className="inline-flex items-center gap-0.5 text-[9px] ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--orange-dim)] text-[var(--scheduled-text)] font-bold animate-pulse align-middle cursor-pointer"
                                      title={`${mlabel} 영수증 사진 등록 필요 — 탭하여 촬영/업로드`}
                                    >
                                      <Camera className="w-2.5 h-2.5" strokeWidth={2.5} /> 영수증 등록
                                    </span>
                                  )
                                })()}
                              </TButton>

                              {/* 2026-07-03: 인라인 납부 폼을 이름 줄 아래층으로 이동 — 같은 줄에 있으면 이름이 눌려 2줄로 꺾이고 정렬이 깨짐 */}
                              {(
                                <>
                                  {studentPayments.length > 0 && status !== 'unpaid' && (() => {
                                    const p = studentPayments[0]
                                    const { otherMethod } = decodePaymentMemo(p.memo)
                                    const methodLabel = otherMethod || PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS]
                                    // 회색 접두어는 실제 납부일
                                    const pDate = new Date(p.payment_date)
                                    const labelText = `${pDate.getMonth() + 1}/${pDate.getDate()} ${methodLabel}`
                                    return (
                                      <motion.span
                                        key={labelText}
                                        initial={{ opacity: 0, y: -3 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.18 }}
                                        className="text-[10px] text-[var(--text-4)] whitespace-nowrap"
                                      >
                                        {labelText}
                                      </motion.span>
                                    )
                                  })()}
                                  {(() => {
                                    // 색상만으로 구분되던 배지에 leading 아이콘 페어 (색맹 접근성)
                                    const isScheduled = displayLabel.includes('예정')
                                    const StatusIcon = status === 'paid' ? Check : isScheduled ? Clock : AlertCircle
                                    return status !== 'unpaid' ? (
                                      <motion.button
                                        key={`${status}-${displayLabel}`}
                                        initial={{ opacity: 0, scale: 0.85 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ type: 'spring', stiffness: 520, damping: 24 }}
                                        whileTap={{ scale: 0.985, transition: { duration: 0.09 } }}
                                        onClick={(e) => { e.stopPropagation(); handleOpenModal(student.id, fee) }}
                                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap cursor-pointer hover:opacity-80 transition-opacity"
                                        style={{ backgroundColor: displayColors.bg, color: displayColors.text }}
                                        role="status"
                                      >
                                        <StatusIcon className="w-3 h-3" strokeWidth={2.5} />
                                        {displayLabel}
                                      </motion.button>
                                    ) : (
                                      <motion.span
                                        key={displayLabel}
                                        initial={{ opacity: 0, scale: 0.85 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ type: 'spring', stiffness: 520, damping: 24 }}
                                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
                                        style={{ backgroundColor: displayColors.bg, color: displayColors.text }}
                                        role="status"
                                      >
                                        <StatusIcon className="w-3 h-3" strokeWidth={2.5} />
                                        {displayLabel}
                                      </motion.span>
                                    )
                                  })()}
                                  {/* 퇴원생도 일반 줄과 동일한 결제수단/청구 아이콘 로직 (카드결제 완료 → 카드 아이콘, 미납 → 청구 봉투 등). 2026-05-30 */}
                                  {(() => {
                                    // 퇴원생 월별 처리 상태 → 전용 빨간 아이콘, 클릭 시 최종처분 메뉴. 결제/청구 아이콘보다 우선. (2026-05-30)
                                    if (withdrawn) {
                                      const ws = withdrawalStatusByStudent.get(student.id)
                                      // 청구서 파기/결제취소는 billStatus(destroyed/cancelled)로 일반 아이콘이 뜨므로 전용 불필요.
                                      // 월별 기록으로만 알 수 있는 계좌환불 완료·이번달까지 정리만 전용 아이콘.
                                      const StatusIc = ws === 'refund_done' ? RotateCcw
                                        : ws === 'settle' ? CheckCircle2
                                        : ws === 'resettled_paid' ? BadgeCheck
                                        : ws === 'resettle_pending' ? Loader2
                                        : ws === 'resettle_scheduled' ? Clock
                                        : ws === 'resettle_refund_failed' ? AlertCircle
                                        : null
                                      // 정산 처리중/예약됨 = 아직 진행중(결제대기) → 주황. 클릭 시 퇴원 메뉴로 상세 확인.
                                      const isPending = !!ws && (IN_PROGRESS_STATUSES as readonly string[]).includes(ws)
                                      if (StatusIc) {
                                        const title = ws === 'refund_done' ? '계좌환불 완료'
                                          : ws === 'resettled_paid' ? '취소후 재청구 결제완료'
                                          : ws === 'resettle_pending' ? '정산 처리중 — 정산분 결제대기'
                                          : ws === 'resettle_scheduled' ? '정산 예약됨 — 영업시간에 자동발송'
                                          : ws === 'resettle_refund_failed' ? '⚠️ 정산분은 결제됐으나 기존 결제 환불 실패 — 수동 환불 필요'
                                          : '이번달까지 정리'
                                        // 재청구 결제완료는 '완료'라 초록, 처리중/예약은 주황, 나머지(후속작업 표시)는 빨강
                                        const isPaidStatus = ws === 'resettled_paid'
                                        return (
                                          <motion.button
                                            type="button"
                                            whileTap={ICON_PRESS}
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setWithdrawMenuTarget({
                                                studentId: student.id,
                                                studentName: student.name,
                                                fee: getStudentFee(student, cls),
                                                enrollmentDate: student.enrollment_date,
                                                withdrawalDate: student.withdrawal_date,
                                                classDays: cls?.class_days,
                                                paymentDueDay: student.payment_due_day,
                                                phone: billingPhone(student),
                                                regularBillStatus: billByStudent.get(student.id)?.status ?? null,
                                              })
                                            }}
                                            className="hit-slop p-1 rounded-lg shrink-0 transition-colors hover:opacity-80 flex items-center justify-center"
                                            style={{ ...(isPaidStatus ? { color: 'var(--paid-text)', background: 'var(--paid-bg)' } : isPending ? { color: 'var(--scheduled-text)', background: 'var(--orange-dim)' } : { color: 'var(--red)', background: 'var(--red-dim)' }), ...HIT_ROW }}
                                            title={title}
                                            aria-label={title}
                                          >
                                            <StatusIc className={`w-3.5 h-3.5${ws === 'resettle_pending' ? ' animate-spin' : ''}`} />
                                          </motion.button>
                                        )
                                      }
                                    }
                                    // SPLIT 학생: 정규+선택과목 두 개 아이콘 나란히 렌더 (각각 자기 청구서 라이프사이클)
                                    if (isSplit) {
                                      const phone = billingPhone(student)
                                      if (!phone) return null
                                      return (
                                        <div className="flex items-center gap-1 shrink-0">
                                          {renderBillIconButton(student, cls, 'regular')}
                                          {renderBillIconButton(student, cls, 'electives')}
                                        </div>
                                      )
                                    }

                                    // 분할 청구 모두 paid: 초록 갈라진 화살표 (paid 결제수단 아이콘 대신)
                                    const allSplit = splitAllByStudent.get(student.id)
                                    if (allSplit && allSplit.length >= 2 && allSplit.every(b => b.status === 'paid')) {
                                      const firstBill = [...allSplit].sort((a, b) => (a.bill_note || '').localeCompare(b.bill_note || ''))[0]
                                      const totalAmount = allSplit.reduce((sum, b) => sum + (b.amount ?? 0), 0)
                                      return (
                                        <motion.button
                                          key="split-paid"
                                          initial={{ scale: 0.4, opacity: 0, rotate: -25 }}
                                          animate={{ scale: 1, opacity: 1, rotate: 0 }}
                                          transition={{ type: 'spring', stiffness: 460, damping: 24 }}
                                          whileTap={ICON_PRESS}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setBillActionTarget({
                                              studentId: student.id,
                                              studentName: student.name,
                                              phone: billingPhone(student),
                                              billId: firstBill.bill_id,
                                              amount: totalAmount,
                                              status: 'paid',
                                              subject: null,
                                              paymentDueDay: student.payment_due_day ?? null,
                                            })
                                          }}
                                          className="hit-slop p-1 rounded-lg shrink-0 hover:opacity-80 flex items-center justify-center"
                                          style={{ color: 'var(--on-action)', background: 'var(--blue)', ...HIT_ROW }}
                                          aria-label={`분할 청구 ${allSplit.length}건 모두 결제완료`}
                                          title={`분할 청구 ${allSplit.length}건 모두 결제완료`}
                                        >
                                          <Split className="w-3.5 h-3.5" />
                                        </motion.button>
                                      )
                                    }

                                    // 분할 청구 sent ≥2건: 갈라지는 화살표(Split) 아이콘 — 클릭 시 BillActionModal 첫 분할 진입
                                    const splitBills = splitSentByStudent.get(student.id)
                                    if (splitBills && splitBills.length >= 2 && status !== 'paid') {
                                      const firstBill = [...splitBills].sort((a, b) => (a.bill_note || '').localeCompare(b.bill_note || ''))[0]
                                      const totalAmount = splitBills.reduce((sum, b) => sum + (b.amount ?? 0), 0)
                                      return (
                                        <motion.button
                                          key="split-sent"
                                          initial={{ scale: 0.4, opacity: 0, rotate: -25 }}
                                          animate={{ scale: 1, opacity: 1, rotate: 0 }}
                                          transition={{ type: 'spring', stiffness: 460, damping: 24 }}
                                          whileTap={ICON_PRESS}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setBillActionTarget({
                                              studentId: student.id,
                                              studentName: student.name,
                                              phone: billingPhone(student),
                                              billId: firstBill.bill_id,
                                              amount: totalAmount,
                                              status: 'sent',
                                              subject: null,
                                              paymentDueDay: student.payment_due_day ?? null,
                                            })
                                          }}
                                          className="hit-slop p-1 rounded-lg shrink-0 hover:opacity-80 flex items-center justify-center"
                                          style={{ color: 'var(--scheduled-text)', background: 'var(--orange-dim)', ...HIT_ROW }}
                                          aria-label={`분할 청구 ${splitBills.length}건 발송됨 — 탭하여 관리`}
                                          title={`분할 청구 ${splitBills.length}건 발송됨 — 탭하여 관리`}
                                        >
                                          <Split className="w-3.5 h-3.5" />
                                        </motion.button>
                                      )
                                    }

                                    // 납부 완료 → 결제수단별 아이콘 (배경 전부 파란색으로 통일, 심볼만 다르게)
                                    if (status === 'paid' && studentPayments.length > 0) {
                                      const method = studentPayments[0].method
                                      const bill = billByStudent.get(student.id)
                                      const PayIcon = ({ className }: { className?: string }) => (
                                        <span className={`inline-flex items-center justify-center font-extrabold tracking-tight ${className ?? ''}`} style={{ fontSize: '8px', lineHeight: 1 }}>PAY</span>
                                      )
                                      const methodSymbol: Record<string, { Icon: typeof Check; rotate?: number; title: string }> = {
                                        payssam:  { Icon: Send,          rotate: 180, title: '결제선생 완료 — 탭하여 취소' },
                                        card:     { Icon: CreditCard,                 title: '카드결제 — 탭하여 편집' },
                                        cash:     { Icon: Banknote,                   title: '현금결제 — 탭하여 편집' },
                                        transfer: { Icon: ArrowLeftRight,             title: '계좌이체 — 탭하여 편집' },
                                        pay:      { Icon: PayIcon as unknown as typeof Check, title: '간편결제(PAY) — 탭하여 편집' },
                                      }
                                      const s = methodSymbol[method] ?? { Icon: Check, title: '납부 완료 — 탭하여 편집' }
                                      const IconComp = s.Icon
                                      return (
                                        <motion.button
                                          key={method}
                                          initial={{ scale: 0.4, opacity: 0, rotate: -90 }}
                                          animate={{ scale: 1, opacity: 1, rotate: 0 }}
                                          transition={{ type: 'spring', stiffness: 520, damping: 22 }}
                                          whileTap={ICON_PRESS}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            if (method === 'payssam' && bill?.status === 'paid') {
                                              setBillActionTarget({
                                                studentId: student.id,
                                                studentName: student.name,
                                                phone: billingPhone(student),
                                                billId: bill.bill_id,
                                                amount: bill.amount,
                                                status: 'paid',
                                                subject: null,
                                                paymentDueDay: student.payment_due_day ?? null,
                                              })
                                            } else {
                                              handleOpenModal(student.id, fee)
                                            }
                                          }}
                                          className="hit-slop p-1 rounded-lg transition-colors shrink-0 hover:opacity-80 flex items-center justify-center"
                                          style={{ color: 'var(--blue)', background: 'var(--blue-dim)', ...HIT_ROW }}
                                          aria-label={s.title}
                                          title={s.title}
                                        >
                                          <IconComp className="w-3.5 h-3.5" style={s.rotate ? { transform: `rotate(${s.rotate}deg)` } : undefined} />
                                        </motion.button>
                                      )
                                    }

                                    // 미납/부분납 → 결제선생 발송/파기 플로우 (전화번호 있을 때만)
                                    if (!(student.parent_phone || student.phone)) return null
                                    // 분할 설정된 학생 + 미발송: 회색 갈라진 화살표로 다음 분할 발송 예정 표시
                                    const hasSplitSetup = (student.split_billing_parts ?? 0) >= 2 && Array.isArray(student.split_billing_amounts) && student.split_billing_amounts.length >= 2
                                    if (hasSplitSetup && !billByStudent.get(student.id)) {
                                      const phone = billingPhone(student)
                                      const amounts = student.split_billing_amounts as number[]
                                      const partsCount = amounts.length
                                      const total = amounts.reduce((s, n) => s + n, 0)
                                      return (
                                        <motion.button
                                          key="split-pending"
                                          initial={{ scale: 0.4, opacity: 0, rotate: -25 }}
                                          animate={{ scale: 1, opacity: 1, rotate: 0 }}
                                          transition={{ type: 'spring', stiffness: 460, damping: 24 }}
                                          whileTap={ICON_PRESS}
                                          disabled={splitSendingId === student.id}
                                          onClick={async (e) => {
                                            e.stopPropagation()
                                            if (splitSendingId) return
                                            // 2026-07-02 사용자 지시: 학부모 발송은 실수 한 번에 못 나가게 — 발송 직전 명시적 confirm 필수
                                            const breakdown = amounts.map(a => formatWon(a)).join(' + ')
                                            if (!confirm(`${student.name} 분할 청구서 ${partsCount}건을 발송할까요?\n\n${breakdown} = ${formatWon(total)}\n수신: ${phone}\n\n⚠️ 학부모에게 실제 청구서가 발송됩니다.`)) return
                                            setSplitSendingId(student.id)
                                            // 분할 즉시 발송 (저장된 분할 설정 사용)
                                            // 응답 무검사였음 — 실패해도 아무 신호가 없었다 (2026-08-13 라인리뷰 P2)
                                            try {
                                              const r = await fetch('/api/payssam/split-send', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                  studentId: student.id,
                                                  studentName: student.name,
                                                  phone,
                                                  billingMonth: selectedMonth,
                                                  amounts,
                                                  persist: false,
                                                }),
                                              })
                                              const data = await r.json().catch(() => ({}))
                                              if (r.ok && data.code === 'SCHEDULED') {
                                                toast.success(`${student.name}: 영업시간 외 — ${data.scheduled_at_kst ?? ''} 예약 발송`)
                                              } else if (r.ok && data.code === '0000') {
                                                if (Array.isArray(data.destroyFailed) && data.destroyFailed.length > 0) {
                                                  toast.error(`${student.name}: 발송 완료 — 기존 청구서 ${data.destroyFailed.length}건 파기 실패, 수동 파기 필요 (이중결제 위험)`)
                                                } else {
                                                  toast.success(`${student.name}: 분할 청구서 ${partsCount}건 발송 완료`)
                                                }
                                              } else if (data.code === 'PARTIAL') {
                                                toast.error(`${student.name}: ${data.msg ?? '일부만 발송됨'}`)
                                              } else {
                                                toast.error(`${student.name}: 분할 발송 실패 — ${data.error || data.msg || `HTTP ${r.status}`}`)
                                              }
                                            } catch {
                                              toast.error(`${student.name}: 분할 발송 실패 — 네트워크 오류`)
                                            } finally {
                                              setSplitSendingId(null)
                                              mutateBills()
                                            }
                                          }}
                                          className="hit-slop p-1 rounded-lg shrink-0 hover:opacity-80 flex items-center justify-center disabled:opacity-50"
                                          style={{ color: 'var(--text-3)', background: 'var(--bg-elevated)', ...HIT_ROW }}
                                          aria-label={`분할 청구 예정 — ${partsCount}건 합 ${formatWon(total)} (탭하면 확인 후 발송)`}
                                          title={`분할 청구 예정 — ${partsCount}건 합 ${formatWon(total)} (탭하면 확인 후 발송)`}
                                        >
                                          <Split className="w-3.5 h-3.5" />
                                        </motion.button>
                                      )
                                    }
                                    return renderBillIconButton(student, cls, 'regular')
                                  })()}
                                </>
                              )}
                            </div>
                            {/* 인라인 납부 폼 — 이름 줄 아래 전폭 레이어 (2026-07-03: 이름 정렬 깨짐 수정) */}
                            <AnimatePresence initial={false}>
                              {isExpanded && (
                                <motion.div
                                  key="inline-pay-form"
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{
                                    height: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
                                    opacity: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
                                  }}
                                  onAnimationComplete={definition => {
                                    // 펼침(height:auto)이 끝났을 때만 — 접힘(exit) 완료에는 재지 않는다
                                    if ((definition as { height?: unknown })?.height === 'auto') revealExpandedRow(student.id)
                                  }}
                                  style={{ overflow: 'visible' }}
                                >
                                  <div
                                    className="flex items-center gap-1.5 px-4 pb-2 transition-all duration-500 ease-in-out"
                                    style={inlineSlideOut === student.id ? { transform: 'translateX(100px)', opacity: 0 } : undefined}
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <TButton
                                      ref={dateButtonRef}
                                      type="button"
                                      onClick={() => {
                                        setShowDatePicker(!showDatePicker)
                                        setShowMethodPicker(false)
                                      }}
                                      className="fan-item px-2 py-1 rounded-full text-xs font-medium bg-[var(--orange-dim)] text-[var(--scheduled-text)] whitespace-nowrap shrink-0"
                                      aria-label="결제일 선택"
                                    >
                                      {(() => { const d = new Date(inlineDate); return `${d.getMonth()+1}/${d.getDate()}` })()}
                                      <span className="text-[9px] opacity-50 ml-0.5">▼</span>
                                    </TButton>
                                    <TButton
                                      ref={methodButtonRef}
                                      type="button"
                                      onClick={() => {
                                        setShowMethodPicker(!showMethodPicker)
                                        setShowDatePicker(false)
                                      }}
                                      className="fan-item px-2 py-1 rounded-full text-xs font-medium bg-[var(--blue-dim)] text-[var(--blue)] whitespace-nowrap shrink-0"
                                      aria-label="결제수단 선택"
                                    >
                                      {METHOD_OPTIONS_SHORT.find(([v]) => v === inlineMethod)?.[1]}
                                    </TButton>
                                    <div className="fan-item flex-1 min-w-0 relative">
                                      {inlineMemoFromPrev && inlineMemo && (
                                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 px-1 py-0.5 rounded text-[9px] font-semibold bg-[var(--orange-dim)] text-[var(--scheduled-text)] pointer-events-none">전달</span>
                                      )}
                                      <input
                                        type="text"
                                        value={inlineMemo}
                                        onChange={e => { setInlineMemo(e.target.value); setInlineMemoFromPrev(false) }}
                                        placeholder="비고"
                                        className={`w-full py-1 rounded-lg text-xs border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--blue)] placeholder-[var(--text-4)] ${inlineMemoFromPrev && inlineMemo ? 'pl-9 pr-2.5' : 'px-2.5'}`}
                                        aria-label="비고 입력"
                                      />
                                    </div>
                                    <TButton
                                      onClick={() => handleInlineSubmit(student.id, fee)}
                                      disabled={!!inlineSuccess || !!inlineSubmitting}
                                      whileTap={ICON_PRESS}
                                      style={HIT_FAN_PILL}
                                      className={`fan-item hit-slop px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-300 shrink-0 ${
                                        isSuccess ? 'bg-[var(--paid-bg)] text-[var(--paid-text)] scale-110' : isSubmitting ? 'bg-[var(--paid-bg)] text-[var(--paid-text)] opacity-60 scale-100' : 'bg-[var(--green-dim)] text-[var(--paid-text)] hover:opacity-80'
                                      }`}
                                      aria-label="납부 처리"
                                    >
                                      {isSuccess ? (
                                        <Check className="w-3.5 h-3.5 animate-[checkBounce_0.3s_ease-out]" strokeWidth={3} />
                                      ) : isSubmitting ? (
                                        <div className="w-3.5 h-3.5 border-2 border-[var(--paid-text)] border-t-transparent rounded-full animate-spin" />
                                      ) : '납부'}
                                    </TButton>
                                    <TButton
                                      onClick={() => {
                                        const parentPhone = billingPhone(student)
                                        setBillSendTarget({ studentId: student.id, studentName: student.name, phone: parentPhone, amount: fee, subject: cls.subject ?? null, className: cls.name ?? null, electives: student.electives ?? [] })
                                      }}
                                      whileTap={ICON_PRESS}
                                      style={HIT_FAN_MIDDLE}
                                      className="fan-item hit-slop p-1 text-[var(--scheduled-text)] hover:opacity-70 shrink-0"
                                      aria-label="청구서 발송"
                                      title="카톡 청구서 발송"
                                    >
                                      <Send className="w-3.5 h-3.5" />
                                    </TButton>
                                    <TButton
                                      onClick={() => handleOpenModal(student.id, fee)}
                                      whileTap={ICON_PRESS}
                                      style={HIT_FAN_LAST}
                                      className="fan-item hit-slop p-1 text-[var(--blue)] hover:opacity-70 shrink-0"
                                      aria-label="상세 납부 기록"
                                    >
                                      <ClipboardList className="w-3.5 h-3.5" />
                                    </TButton>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                            {!isExpanded && hasMemo && (
                              <div className="flex justify-end px-4 pb-0">
                                <div className="text-right">
                                  {cleanMemo && <p className="text-[11px] text-[var(--text-3)] leading-tight">{cleanMemo}</p>}
                                  {prevMemo && <p className="text-[11px] text-[var(--text-4)] leading-tight">지난달: {prevMemoLabel(prevMemo, prevMethod)}</p>}
                                  {prevMethodNonPayssam && (
                                    <p className="text-[11px] text-[var(--scheduled-text)] leading-tight">
                                      지난달: {PAYMENT_METHOD_LABELS[prevMethodNonPayssam]}
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}
                            </div>
                          </div>
                          {/* 아래층: 입력 공간 — 단일 선택일 때만 (다중선택은 상단 툴바) */}
                          {/* 비고 입력 — framer-motion height:auto (iOS Safari 포함 전브라우저 호환) */}
                          <AnimatePresence initial={false}>
                            {isSoleMemoSelection && (
                              <motion.div
                                key="memo-input"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{
                                  height: { duration: 0.38, ease: [0.22, 1, 0.36, 1] },
                                  opacity: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                                }}
                                style={{ overflow: 'hidden' }}
                              >
                                <div className="px-3 py-2 bg-[var(--bg-elevated)] border-t border-[var(--border)]" onClick={e => e.stopPropagation()}>
                                  <textarea
                                    value={editMemoValue}
                                    onChange={e => setEditMemoValue(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSaveMemo(student.id) }
                                    }}
                                    placeholder="비고 내용 (⌘Enter 저장)"
                                    rows={3}
                                    className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--blue)] resize-none leading-relaxed"
                                  />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                          {/* 결제특이사항 입력 — 동일 패턴 */}
                          <AnimatePresence initial={false}>
                            {isSwipeOpen && openSide === 'right' && (
                              <motion.div
                                key="pay-memo-input"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{
                                  height: { duration: 0.38, ease: [0.22, 1, 0.36, 1] },
                                  opacity: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                                }}
                                style={{ overflow: 'hidden' }}
                              >
                                <div className="px-3 py-2 bg-[var(--bg-elevated)] border-t border-[var(--border)]" onClick={e => e.stopPropagation()}>
                                  <input
                                    type="text"
                                    value={editPayMemoValue}
                                    onChange={e => setEditPayMemoValue(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSavePayMemo(student.id) }}
                                    placeholder="결제 특이사항"
                                    className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--blue)]"
                                  />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )
  }

  return (
    <>
      {/* 다중 선택 툴바 — 제일 위 선택된 학생 행 위에 플로팅.
          당겨서 새로고침이 컨테이너에 transform 을 거는 동안 position:fixed 기준 상자가 바뀌지 않도록
          컨테이너 **밖**에 둔다(툴바 클릭은 원래도 stopPropagation 이라 컨테이너 onClick 과 무관). */}
      <AnimatePresence>
        {selectedMemoIds.size >= 2 && (
          // 바깥 div = 위치(top 0 + rAF 가 쓰는 translate), 안쪽 motion = 등장·퇴장(y·opacity).
          // 두 transform 의 소유자를 나눠야 framer 의 y 가 위치를 덮어쓰지 않는다.
          <div
            key="bulk-toolbar"
            ref={bulkToolbarRef}
            className="fixed left-2 right-2 top-0 z-50"
            onClick={e => e.stopPropagation()}
          >
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
            className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl shadow-xl"
          >
            <div className="max-w-3xl mx-auto px-3 py-2 flex items-center gap-2">
              <TButton
                onClick={closeAllMemoSelections}
                className="p-1.5 rounded-full hover:bg-[var(--bg-card-hover)] text-[var(--text-3)] shrink-0"
                aria-label="선택 취소"
              >
                <X className="w-4 h-4" />
              </TButton>
              <span className="text-xs font-bold text-[var(--text-1)] tabular-nums shrink-0">
                {selectedMemoIds.size}명
              </span>
              <div className="flex items-center gap-1 shrink-0">
                {(['yellow', 'green', 'red'] as const).map(c => {
                  const bg = c === 'yellow' ? 'bg-[var(--orange-dim)]' : c === 'green' ? 'bg-[var(--paid-bg)]' : 'bg-[var(--unpaid-bg)]'
                  const active = editMemoColor === c
                  return (
                    <TButton
                      key={c}
                      type="button"
                      onClick={() => setEditMemoColor(active ? null : c)}
                      className={`w-7 h-3.5 rounded-[2px] ${bg} ${active ? 'ring-1 ring-[var(--text-1)] shadow-md' : 'opacity-60'}`}
                      style={{ transform: 'skewX(-10deg)' }}
                      aria-label={`색상 ${c}`}
                    />
                  )
                })}
              </div>
              <input
                type="text"
                value={editMemoValue}
                onChange={e => setEditMemoValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleBulkSaveMemo() }}
                placeholder="비고 (일괄 적용)"
                className="flex-1 min-w-0 px-2.5 py-1 rounded-lg text-xs border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--blue)] placeholder-[var(--text-4)]"
              />
              <TButton
                onClick={handleBulkSaveMemo}
                disabled={bulkSaving}
                className="p-1.5 bg-[var(--blue)] hover:opacity-80 text-[var(--on-action)] rounded-full shrink-0 shadow-sm transition-opacity disabled:opacity-50"
                aria-label="일괄 저장"
              >
                {bulkSaving ? (
                  <div className="w-3.5 h-3.5 border-2 border-[var(--on-action)] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
              </TButton>
            </div>
          </motion.div>
          </div>
        )}
      </AnimatePresence>

    <div ref={containerRef} onClick={() => { if (selectedMemoIds.size > 0 || swipeOpenPayId) closeSwipeEdit() }}>
      <PaymentsHeader
        month={selectedMonth} navigateMonth={navigateMonth}
        memo={monthMemo} memoStatus={monthMemoStatus}
        onMemoChange={content => { setMonthMemo(content); saveMonthMemo(content) }}
        loading={dataLoading || !!error}
        pullIndicator={
          // Pull-to-refresh 인디케이터 — 0 높이, 컨테이너가 내려가며 생긴 틈에 그린다(레이아웃 없음)
          <PullRefreshIndicator indicatorRef={pullVisual.indicatorRef} scaleRef={pullVisual.scaleRef} rotateRef={pullVisual.rotateRef} refreshing={isRefreshing} />
        }
        progress={batchSending && batchProgress ? (
          <div role="status" className="flex items-center justify-center gap-1.5 py-1 whitespace-nowrap">
            <Loader2 className="w-3 h-3 animate-spin text-[var(--scheduled-text)]" />
            <span className="text-[11px] font-bold text-[var(--scheduled-text)] tabular-nums">{batchProgress.done}/{batchProgress.total}</span>
            <TButton onClick={cancelBatch} disabled={cancellingBatch} className="px-1.5 py-0.5 rounded-md bg-[var(--red-dim)] text-[var(--red)] text-[10px] font-bold hover:opacity-80 disabled:opacity-50">
              {cancellingBatch ? '중단중' : '중단'}
            </TButton>
          </div>
        ) : null}
        filters={dataLoading || error ? <span role="status" className="text-xs text-[var(--text-3)]">{error ? '데이터 로딩 실패' : '납부 내역 로딩 중'}</span> : <>
        <AnimatePresence initial={false}>
          {batchSending !== '__filter__' && (() => {
            // 현재 필터(미납/결제일 직접입력)에 걸리는 모든 반의 발송가능 인원 합산.
            // 필터 미적용(전체+직접입력 없음)일 땐 비활성 — 명시적 의도 없는 일괄 발송 방지.
            // alreadyPaid/billByStudent.has 면 제외 — '발송 안한 사람' 만 대상.
            let eligibleCount = 0
            // 정규는 나갔고 선택과목분만 늦은 학생 — 일괄 대상은 아니지만 **사람이 알아야 한다**
            // (2026-09-13 코드 검수: 전원이 이 경우면 targets 가 비어 모달도 배지도 사라져
            //  어제 만든 안내에 도달할 길이 없었다)
            let electivesOnlyCount = 0
            for (const grade of grades) {
              for (const cls of grade.classes ?? []) {
                const classStudents = getActiveStudents(cls.students ?? [], selectedMonth).filter(s => passesFilter(s, cls as ClassWithStudents))
                for (const s of classStudents) {
                  const phone = billingPhone(s)
                  const fee = getStudentFee(s, cls as ClassWithStudents)
                  const alreadyPaid = (paymentsByStudentId.get(s.id) ?? []).length > 0
                  if (isBatchExcluded(s, selectedMonth)) continue // 이 달만 일괄 제외 지정
                  if (phone && fee > 0 && !billByStudent.has(s.id) && !alreadyPaid) eligibleCount++
                  else if (paymentFilter === 'overdue_unsent' && phone && fee > 0 && !alreadyPaid && billByStudent.has(s.id)) electivesOnlyCount++
                }
              }
            }
            const isFilterless = paymentFilter === 'all' && !customActive
            // 필터 미적용도 노출(비활성). 미납/직접입력 + 발송 가능 0명이면 숨김 —
            // 단 '개별 발송 필요' 인원이 있으면 그 안내 배지는 남긴다
            if (!isFilterless && eligibleCount === 0 && electivesOnlyCount === 0) return null
            const labelPrefix = customActive ? customLabel : FILTER_LABELS[paymentFilter]
            return (
              <motion.button
                key="filter-bulk-badge"
                type="button"
                onClick={() => {
                  if (isFilterless) {
                    toast.info('미납 또는 결제일 필터를 먼저 적용해주세요')
                    return
                  }
                  openFilterBulkBillModal()
                }}
                disabled={!!batchSending || (isFilterless ? false : eligibleCount === 0 && electivesOnlyCount === 0)}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                aria-disabled={isFilterless}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold shadow-sm active:opacity-70 disabled:opacity-50 whitespace-nowrap ${
                  isFilterless
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-4)] opacity-60 cursor-not-allowed'
                    : customActive
                      ? 'bg-[var(--orange-dim)] text-[var(--scheduled-text)]'
                      : 'bg-[var(--red-dim)] text-[var(--unpaid-text)]'
                }`}
                title={isFilterless
                  ? '미납 또는 결제일 필터를 먼저 적용해주세요'
                  : eligibleCount === 0
                    ? `선택과목분만 지연돼 일괄로 못 보내는 ${electivesOnlyCount}명 — 눌러서 명단 확인 후 개별 발송`
                    : `${labelPrefix} 조건의 미발송·미수납 학생 ${eligibleCount}명 일괄 발송`}
              >
                <Send className="w-3 h-3" />
                <span>{eligibleCount === 0 && electivesOnlyCount > 0 ? '개별 발송 필요' : `${labelPrefix} 일괄`}</span>
                <span className="tabular-nums opacity-70">{eligibleCount === 0 && electivesOnlyCount > 0 ? electivesOnlyCount : eligibleCount}</span>
              </motion.button>
            )
          })()}
          {/* 일괄 재발송 배지 — sent + 결제일 지남 + 미결제 학생 */}
          {batchSending !== '__resend__' && resendableTargets.targets.length > 0 && (
            <motion.button
              key="resend-bulk-badge"
              type="button"
              onClick={openBulkResendModal}
              disabled={!!batchSending}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--orange-dim)] text-[var(--scheduled-text)] shadow-sm active:opacity-70 disabled:opacity-50 whitespace-nowrap"
              title={`결제일 지난 미결제 ${resendableTargets.targets.length}명에게 카톡 알림 재발송`}
            >
              <Bell className="w-3 h-3" />
              <span>재발송</span>
              <span className="tabular-nums opacity-70">{resendableTargets.targets.length}</span>
            </motion.button>
          )}
        </AnimatePresence>
        <div className="flex items-center gap-1.5">
          <div className="relative flex items-center pr-1">
            <TButton
              type="button"
              onClick={openDayPicker}
              ref={dayPickerButtonRef}
              aria-haspopup="dialog"
              aria-expanded={dayPickerOpen}
              aria-label="결제일 선택"
              className={`px-3 py-1 rounded-full text-xs font-semibold shadow-sm transition-colors whitespace-nowrap ${
                (customActive || paymentFilter === 'overdue_unsent')
                  ? 'bg-[var(--blue-dim)] text-[var(--blue)]'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-2)] hover:bg-[var(--bg-card-hover)]'
              }`}
            >
              {paymentFilter === 'overdue_unsent' ? `청구지연 ${overdueCalendar.studentCount}` : customActive ? customLabel : '결제일'}
            </TButton>
            {(customActive || paymentFilter === 'overdue_unsent') && (
              <TButton
                type="button"
                onClick={clearDayPicker}
                aria-label="직접 입력 해제"
                className="absolute -right-1 -top-1 w-4 h-4 rounded-full bg-[var(--bg-elevated)] text-[var(--text-3)] text-[10px] leading-none flex items-center justify-center shadow-sm hover:text-[var(--text-1)]"
              >
                ×
              </TButton>
            )}
          </div>
          <TButton
            onClick={() => setPaymentFilter(prev => prev === 'unpaid' ? 'all' : 'unpaid')}
            disabled={customActive}
            aria-pressed={paymentFilter === 'unpaid'}
            className={`flex items-center justify-center px-3 py-1 rounded-full text-xs font-semibold transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap ${
              paymentFilter === 'unpaid'
                ? 'bg-[var(--red-dim)] text-[var(--unpaid-text)]'
                : 'bg-[var(--bg-elevated)] text-[var(--text-2)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            <span>{paymentFilter === 'overdue_unsent' ? FILTER_LABELS.unpaid : FILTER_LABELS[paymentFilter]}</span>
          </TButton>
        </div>
        </>}
      />
      <div data-payments-content>
      {dataLoading ? <PaymentsSkeleton showMonthNav={false} /> : error ? (
        <div className="text-center py-12">
          <p className="text-[var(--red)] mb-4">{error?.message || '데이터 로딩 실패'}</p>
          <TButton onClick={fetchData} className="px-4 py-2 bg-[var(--blue)] text-[var(--on-action)] rounded-lg hover:opacity-90">다시 시도</TButton>
        </div>
      ) : <>
      {/* 결과가 비어도 필터 진입/해제는 헤더에서 유지한다. */}
      {visibleSections.length === 0 && (customActive || paymentFilter !== 'all') && (
        <>
          <EmptyState
            icon={SearchX}
            title={customActive
              ? `${customLabel} 결제일인 학생은 없습니다`
              : `${FILTER_LABELS[paymentFilter]} 조건에 맞는 학생은 없습니다`}
            size="page"
          />
        </>
      )}

      {/* 과목별 → 학년별 납부 현황 */}
      {subjectGradeGroups.map(({ subject, grades: subjectGrades }) => {
        // 과목 전체에 표시할 학생이 있는지 확인
        const hasVisibleStudents = subjectGrades.some(({ classes: gradeClasses }) =>
          gradeClasses.some(cls => {
            const students = getActiveStudents(cls.students ?? [], selectedMonth).filter(s => passesFilter(s, cls))
            return students.length > 0
          })
        )
        if (!hasVisibleStudents) return null

        return (
          <div key={subject} className="mb-6">
            <div className="flex items-center mb-2 px-1">
              <h2 className="text-sm font-semibold text-[var(--text-3)]">{subject}</h2>
              <div className="flex-1" />
            </div>
            <div className="space-y-2">
            {subjectGrades.map(({ gradeId, gradeName, classes: gradeClasses }) => {
              // 이 학년에 표시할 학생이 있는지
              const hasGradeStudents = gradeClasses.some(cls => {
                const students = getActiveStudents(cls.students ?? [], selectedMonth).filter(s => passesFilter(s, cls))
                return students.length > 0
              })
              if (!hasGradeStudents) return null

              const gradeClassIds = gradeClasses.map(c => c.id)
              const isGradeExpanded = gradeClassIds.every(id => expandedClasses.has(id))

              const toggleGradeExpand = () => {
                setExpandedClasses(prev => {
                  const next = new Set(prev)
                  if (isGradeExpanded) gradeClassIds.forEach(id => next.delete(id))
                  else gradeClassIds.forEach(id => next.add(id))
                  return next
                })
              }

              return (
                <div key={gradeId} data-section-key={`${subject}__${gradeId}`}>
                  <div
                    className="bg-[var(--bg)] -mx-4 px-5 pt-1.5 pb-1.5 mb-1 flex items-center justify-between gap-x-3"
                  >
                    <TButton
                      onClick={toggleGradeExpand}
                      className="flex items-center gap-1 active:opacity-70 shrink-0"
                    >
                      <motion.div animate={{ rotate: isGradeExpanded ? 90 : 0 }} transition={{ type: 'spring', stiffness: 300, damping: 25 }}>
                        <ChevronRight className="w-4 h-4 text-[var(--text-3)]" />
                      </motion.div>
                      <span className="text-[15px] font-bold text-[var(--text-1)] tracking-tight whitespace-nowrap">{gradeName}</span>
                    </TButton>

                  </div>
                  <div className="card overflow-hidden">
                  {gradeClasses.map(cls => {
                // 퇴원생 제외 (2026-05-19 사용자 지시) — 별도 섹션으로 페이지 최하단에 모음
                const allClassStudents = getActiveStudents(cls.students ?? [], selectedMonth).filter(s => !s.withdrawal_date)
                let students = allClassStudents.filter(s => passesFilter(s, cls))
                students = [...students].sort((a, b) => {
                  const ao = a.order_index ?? 0
                  const bo = b.order_index ?? 0
                  if (ao !== bo) return ao - bo
                  return getDueDay(a) - getDueDay(b)
                })

                if (students.length === 0) return null

                // 헤더 배지도 classStats(자동접힘 판정)와 **같은 값**을 쓴다 — 분모·완납 판정이
                // 두 곳에 살면 '헤더는 3/4 미완납인데 반은 완납으로 접힘' 불일치가 재발한다 (2026-08-13 라인리뷰)
                const stat = classStats.get(cls.id)
                const paidCount = stat?.paidCount ?? 0
                const statTotal = stat?.totalCount ?? students.length
                const isFullyPaid = stat?.isFullyPaid ?? false
                const isClassExpanded = expandedClasses.has(cls.id)

                return (
                  <div key={cls.id}>
                    <div
                      className="px-4 py-2.5 bg-[var(--bg-card-hover)]/70 border-b border-[var(--border)] flex items-center cursor-pointer active:bg-[var(--bg-elevated)] select-none"
                      onClick={() => toggleClass(cls.id)}
                    >
                      <span className="text-sm font-medium text-[var(--text-3)]">{formatClassName(cls)}</span>
                      {(() => {
                        const teacherName = cls.teacher?.name
                        const days = parseClassDays(cls.class_days)
                        const dayStr = days?.length ? days.map(d => DAY_LABELS[d]).filter(Boolean).join('') : ''
                        if (!teacherName && !dayStr) return null
                        return (
                          <span className="text-[10px] text-[var(--text-4)] ml-1.5">
                            {teacherName}{teacherName && dayStr ? ' · ' : ''}{dayStr}
                          </span>
                        )
                      })()}
                      <span className="text-xs text-[var(--text-4)] ml-1.5">{cls.monthly_fee > 0 ? `${formatWon(cls.monthly_fee)}` : ''}</span>
                      {isFullyPaid ? (
                        <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--paid-bg)] text-[var(--paid-text)] tracking-tight">
                          전원납부 {paidCount}/{statTotal}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--text-4)] ml-2">{paidCount}/{statTotal}</span>
                      )}
                      <span className="flex-1" />
                      <TButton
                        onClick={(e) => { e.stopPropagation(); handleAddStudent(cls.id) }}
                        className="p-0.5 text-[var(--text-4)] hover:text-[var(--blue)] transition-colors"
                        aria-label={`${formatClassName(cls)}에 학생 추가`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </TButton>
                    </div>
                    <AnimatePresence initial={false}>
                    {isClassExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      style={{ overflow: 'hidden' }}
                    >
                    {students.map((student, idx) => renderStudentRow(student, cls, idx))}
                    </motion.div>
                    )}
                    </AnimatePresence>
                  </div>
                )
              })}
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        )
      })}

      {/* 퇴원 학생 — 페이지 최하단 별도 섹션. 처리중(위) + 처리완료(아래) 2분할 (2026-05-22 사용자 지시) */}
      {(() => {
        const withdrawnAll: { s: Student; cls: ClassWithStudents; gradeName: string }[] = []
        for (const g of grades) {
          for (const cls of (g.classes ?? [])) {
            for (const s of (cls.students ?? [])) {
              if (!s.withdrawal_date) continue
              // 퇴원생은 퇴원월부터 그 이후 모든 월에 계속 표시(승계). 미래월 퇴원 예약만 그 전 달엔 숨김.
              if (s.withdrawal_date.slice(0, 7) > selectedMonth) continue
              withdrawnAll.push({ s: s as Student, cls: cls as ClassWithStudents, gradeName: g.name })
            }
          }
        }
        if (withdrawnAll.length === 0) return null
        withdrawnAll.sort((a, b) => (b.s.withdrawal_date ?? '').localeCompare(a.s.withdrawal_date ?? ''))

        // 처리완료 판정:
        //   - 환불 진행중(memo에 '환불' 포함 + '환불완료'로 시작 X) → 처리중 (리사 같은 케이스)
        //   - memo가 환불완료/결제취소/청구서 파기 → 처리완료
        //   - memo 없고 bill_history가 cancelled/destroyed → 처리완료 (자동 분류)
        const isProcessCompleted = (s: Student): boolean => {
          const ws = withdrawalStatusByStudent.get(s.id)
          // 0) 사용자가 명시적으로 처리 마킹한 건(계좌환불 완료 / 이번달까지 정리 / 취소후 재청구 결제완료)은
          //    청구서가 미납(sent)으로 남아있어도 "끝낸 일"이므로 처리완료. 청구서/결제 상태 체크보다 우선. (2026-06-16)
          //    (전엔 sent 청구서 체크가 먼저라, 환불완료 눌러도 미납 청구서 때문에 처리중에 남던 버그)
          if (ws && (TERMINAL_STATUSES as readonly string[]).includes(ws)) return true
          const bs = getBillStatus(s.id, 'regular')
          // 1) 그 달 청구서가 살아있으면(미납/예약) 처리할 게 있음 → 처리중
          if (bs === 'sent' || bs === 'scheduled') return false
          // 2) 미환불 결제가 남아있으면 처리중 (카드·현금 등 외부결제는 환불 여부를 시스템이 모름)
          if ((paymentsByStudentId.get(s.id)?.length ?? 0) > 0) return false
          // 4) 청구서가 파기/취소됐고 결제도 없으면 처리완료 (결제취소/청구서파기는 그 달 청구서 상태로 판정)
          if (bs === 'cancelled' || bs === 'destroyed') return true
          return false
        }
        // 승계 규칙: 그 달(selectedMonth)에 표시할 학생만.
        //  - 당월 퇴원: 무조건 표시
        //  - 과거 퇴원: 그 달에 청구서/결제가 "있을 때만" 표시 (그 달치 처리할 게 있는 경우). 지난달에 정리 끝난 건 자동 제외.
        const hasMonthActivity = (sid: string) => billsByStudent.has(sid) || (paymentsByStudentId.get(sid)?.length ?? 0) > 0
        const carriedOver = withdrawnAll.filter(({ s }) => {
          const wmonth = (s.withdrawal_date ?? '').slice(0, 7)
          if (wmonth === selectedMonth) return true
          return hasMonthActivity(s.id)
        })
        // 처리중(취소/파기 필요)은 처리중 섹션, 처리완료는 처리완료 섹션으로 분류
        const pendingList = carriedOver.filter(({ s }) => !isProcessCompleted(s))
        const completedList = carriedOver.filter(({ s }) => isProcessCompleted(s))

        // 학년·반 라벨 — 퇴원 반은 여러 학년/반이 섞이므로 줄마다 원래 소속 표시 (2026-05-30 사용자 지시)
        const clsLabel = (e: { gradeName: string; cls: ClassWithStudents }) =>
          `${e.gradeName}·${formatClassName(e.cls)}`
        // "처리중" 반 — 일반 반 컨테이너 + 일반 학생 줄(renderStudentRow) 그대로 재사용
        const renderWithdrawnClass = (
          title: string,
          accent: string,
          list: { s: Student; cls: ClassWithStudents; gradeName: string }[],
        ) => (
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 bg-[var(--bg-card-hover)]/70 border-b border-[var(--border)] flex items-center gap-1.5">
              <UserMinus className="w-3.5 h-3.5" style={{ color: accent }} />
              <span className="text-sm font-medium" style={{ color: accent }}>{title}</span>
              <span className="text-[12px] font-bold tabular-nums" style={{ color: accent }}>{list.length}</span>
            </div>
            {list.map((entry, idx) => renderStudentRow(entry.s, entry.cls, idx, clsLabel(entry)))}
          </div>
        )

        return (
          <div className="space-y-6 mt-6">
            {pendingList.length > 0 && renderWithdrawnClass('퇴원 (처리중)', 'var(--orange)', pendingList)}
            {completedList.length > 0 && (
              <div className="card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setCompletedWithdrawnExpanded(v => !v)}
                  className="w-full flex items-center gap-1.5 px-4 py-2.5 text-left bg-[var(--bg-card-hover)]/70 border-b border-[var(--border)] hover:bg-[var(--bg-card-hover)] active:bg-[var(--bg-elevated)] transition-colors"
                  aria-expanded={completedWithdrawnExpanded}
                  aria-label={completedWithdrawnExpanded ? '처리완료 접기' : '처리완료 펼치기'}
                >
                  <UserMinus className="w-3.5 h-3.5 text-[var(--red)]" />
                  <span className="text-sm font-medium text-[var(--red)]">퇴원 (처리완료)</span>
                  <span className="text-[12px] font-bold text-[var(--red)] tabular-nums">{completedList.length}</span>
                  <ChevronDown
                    className="w-4 h-4 text-[var(--text-3)] ml-auto transition-transform"
                    style={{ transform: completedWithdrawnExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {completedWithdrawnExpanded && (
                    <motion.div
                      key="completed-list"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      style={{ overflow: 'hidden' }}
                    >
                      {completedList.map((entry, idx) => renderStudentRow(entry.s, entry.cls, idx, clsLabel(entry)))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        )
      })()}

      {allStudents.length === 0 && (
        <EmptyState title="등록된 학생이 없습니다" description="설정에서 학생을 먼저 추가해주세요" size="page" />
      )}

      </>}
      </div>
      {!dataLoading && !error && <>
      <AnimatePresence>
        {showPaymentModal && selectedStudentId && (
          <PaymentModal
            payment={selectedPayment}
            studentId={selectedStudentId}
            defaultBillingMonth={selectedMonth}
            defaultAmount={selectedStudentFee}
            prevMemo={selectedPrevMemo}
            prevMethod={selectedPrevMethod}
            onSave={handleSavePayment}
            onUpdate={handleUpdatePayment}
            onDelete={handleDeletePayment}
            onReceiptChange={fetchData}
            onClose={() => { setShowPaymentModal(false); setSelectedPayment(null); setExpandedStudentId(null); fetchData() }}
          />
        )}
      </AnimatePresence>


      <AnimatePresence>
        {showStudentModal && (
          <StudentModal
            grades={grades}
            defaultClassId={addStudentClassId}
            onSave={handleSaveStudent}
            onClose={() => setShowStudentModal(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {billSendTarget && (
          <BillSendModal
            studentId={billSendTarget.studentId}
            studentName={billSendTarget.studentName}
            phone={billSendTarget.phone}
            amount={billSendTarget.amount}
            subject={billSendTarget.subject}
            className={billSendTarget.className}
            billingMonth={selectedMonth}
            electives={billSendTarget.electives}
            billType={billSendTarget.billType}
            onClose={() => setBillSendTarget(null)}
            onSuccess={() => { fetchData(); mutateBills() }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detailStudentId && (
          <StudentDetailModal
            studentId={detailStudentId}
            onClose={() => setDetailStudentId(null)}
            onChange={fetchData}
          />
        )}
      </AnimatePresence>

      <WithdrawActionMenu
        target={withdrawMenuTarget}
        billingMonth={selectedMonth}
        onClose={() => setWithdrawMenuTarget(null)}
        onMarked={() => { fetchData(); mutateBills(); mutateWithdrawalStatus() }}
      />

      <AnimatePresence>
        {billActionTarget && (() => {
          const allSplit = splitAllByStudent.get(billActionTarget.studentId)
          const sortedSplit = allSplit ? [...allSplit].sort((a, b) => (a.bill_note || '').localeCompare(b.bill_note || '')) : []
          const splitInfo = sortedSplit.length >= 2
            ? {
                count: sortedSplit.length,
                amounts: sortedSplit.map(b => b.amount),
                statuses: sortedSplit.map(b => b.status as 'sent' | 'paid' | 'cancelled' | 'destroyed'),
                // 건별 id — 모달이 파기/취소/재발송을 건별 (billId, amount)로 실행하게 한다.
                // 없으면 합계로 POST돼 AMOUNT_MISMATCH 가드에 전부 막힌다 (2026-08-16 라인리뷰 high)
                billIds: sortedSplit.map(b => b.bill_id),
              }
            : undefined
          return (
            <BillActionModal
              studentId={billActionTarget.studentId}
              studentName={billActionTarget.studentName}
              phone={billActionTarget.phone}
              billId={billActionTarget.billId}
              amount={billActionTarget.amount}
              status={billActionTarget.status}
              billingMonth={selectedMonth}
              onClose={() => setBillActionTarget(null)}
              onSuccess={() => { fetchData(); mutateBills() }}
              splitInfo={splitInfo}
              subject={billActionTarget.subject}
              paymentDueDay={billActionTarget.paymentDueDay}
            />
          )
        })()}
      </AnimatePresence>

      <AnimatePresence>
        {bulkBillTarget && (
          <BulkBillSendModal
            className={bulkBillTarget.className}
            targets={bulkBillTarget.targets}
            excludedNote={bulkBillTarget.excludedNote}
            onClose={() => setBulkBillTarget(null)}
            onConfirm={executeBulkSend}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {bulkResendTarget && (
          <BulkBillSendModal
            className="결제일 지난 미결제"
            targets={bulkResendTarget.targets}
            onClose={() => setBulkResendTarget(null)}
            onConfirm={executeBulkResend}
            mode="resend"
          />
        )}
      </AnimatePresence>

      {showDatePicker && (
        <DatePickerPopup
          inlineDate={inlineDate}
          onDateChange={setInlineDate}
          onClose={() => setShowDatePicker(false)}
          anchorRef={dateButtonRef}
        />
      )}

      {showMethodPicker && (
        <MethodPickerPopup
          currentMethod={inlineMethod}
          onMethodChange={setInlineMethod}
          onClose={() => setShowMethodPicker(false)}
          anchorRef={methodButtonRef}
        />
      )}

      <PaymentDayFilterPicker open={dayPickerOpen} month={selectedMonth}
        value={{ filter: paymentFilter, start: customStart, end: customEnd }} overdue={overdueCalendar}
        anchorRef={dayPickerButtonRef} onApply={applyDayPicker} onClear={clearDayPicker} onClose={() => setDayPickerOpen(false)} />

      <AiFilterButton
        aiFilterIds={aiFilterIds}
        aiFilterDesc={aiFilterDesc}
        onFilter={handleAiFilter}
        onClear={clearAiFilter}
        loading={aiFilterLoading}
      />
      </>}
    </div>

      {/* 일괄발송 결과 토스트 — 툴바와 같은 이유로 컨테이너 밖(fixed 기준 상자 고정). 표시 조건은 그대로 */}
      {!dataLoading && !error && batchResultToast && (
        <div data-paper-card="" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-lg text-sm font-medium text-[var(--text-1)] max-w-md">
          {batchResultToast}
        </div>
      )}
    </>
  )
}
