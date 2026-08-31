export type PaymentMethod = 'remote' | 'card' | 'transfer' | 'cash' | 'payssam' | 'pay' | 'other'

export interface Teacher {
  id: string
  name: string
  phone?: string | null
  subject?: string | null
  memo?: string | null
  pay_ratio?: number | null
  order_index: number
  created_at: string
}

export interface Grade {
  id: string
  name: string
  order_index: number
  created_at: string
  classes?: Class[]
}

export interface Class {
  id: string
  grade_id: string
  name: string
  monthly_fee: number
  subject?: string | null
  class_days?: string | null
  teacher_id?: string | null
  order_index: number
  created_at: string
  grade?: Grade
  teacher?: Teacher | null
  students?: Student[]
}

export interface Student {
  id: string
  class_id: string | null
  name: string
  phone?: string
  parent_phone?: string         // 어머니 번호 (기존 데이터 = 모로 간주)
  parent_father_phone?: string  // 아버지 번호
  payssam_recipient?: 'mother' | 'father'      // 결제선생 청구서 수신자 (기본 mother)
  attendance_recipient?: 'mother' | 'father'   // 출결 알림톡 수신자 (기본 mother)
  attendance_code?: string | null              // 출결 체크인 코드 (학생 번호 뒷4자리 자동)
  school?: string | null                       // 학교명 — 원비가 기준 원본, 타앱은 여기서 참조 (2026-07-10)
  enrollment_date: string
  withdrawal_date?: string | null
  custom_fee?: number | null
  payment_due_day?: number | null
  electives_payment_due_day?: number | null
  memo?: string
  memo_color?: 'yellow' | 'green' | 'red' | null
  order_index?: number
  split_billing_parts?: number | null
  split_billing_amounts?: number[] | null
  electives?: string[]
  batch_exclude_month?: string | null   // 이 달(YYYY-MM)엔 정규 일괄청구 제외 — 초과결제 차감 등 그 달만 개별발송 (2026-07-24)
  created_at: string
  class?: Class
}

/**
 * 선택과목(정규 수업에 얹는 추가 과목) 월 요금표.
 *
 * ⚙️ **자기 학원에 맞게 고쳐야 하는 곳이다.** 과목명과 금액은 학원마다 다르다.
 *    아래는 예시값이니 실제 개설 과목·요금으로 바꿔라.
 *    (요금이 자주 바뀐다면 DB 테이블로 빼는 편이 낫지만, 과목이 서너 개 수준이면
 *     여기 상수로 두는 쪽이 훨씬 단순하다 — 원래 그렇게 운영했다.)
 */
export const ELECTIVE_FEES: Record<string, number> = {
  '확통': 200000,
  '기하': 150000,
}
/** 위 표에 없는 과목명이 들어왔을 때의 기본 요금. */
export const ELECTIVE_FEE = 100000

export function getElectiveFee(name: string): number {
  return ELECTIVE_FEES[name] ?? ELECTIVE_FEE
}

export type GradeWithClasses = Grade & { classes: (Class & { students: Student[] })[] }

export interface Payment {
  id: string
  student_id: string
  amount: number
  method: PaymentMethod
  payment_date: string
  billing_month: string
  cash_receipt?: 'issued' | 'pending' | null
  receipt_images?: string[]
  memo?: string
  created_at: string
  student?: Student
}

export type PaymentStatus = 'paid' | 'partial' | 'unpaid'

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  remote: '비대면',
  card: '카드결제',
  transfer: '계좌이체',
  cash: '현금',
  payssam: '결제선생',
  pay: '간편결제(PAY)',
  other: '기타',
}

export const CASH_RECEIPT_LABELS: Record<string, string> = {
  issued: '발행완료',
  pending: '미발행',
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: '납부완료',
  partial: '부분납부',
  unpaid: '미납',
}

// CSS 변수 토큰 참조 — globals.css에 정의된 paid/scheduled/unpaid 페어와 동기화.
// 다크/라이트 모드 토글 시 자동 따라옴.
export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, { bg: string; text: string }> = {
  paid:    { bg: 'var(--paid-bg)',      text: 'var(--paid-text)' },
  partial: { bg: 'var(--scheduled-bg)', text: 'var(--scheduled-text)' },
  unpaid:  { bg: 'var(--unpaid-bg)',    text: 'var(--unpaid-text)' },
}

export function getStudentFee(student: Student, cls?: Class | null): number {
  const base = student.custom_fee != null ? student.custom_fee : (cls?.monthly_fee ?? 0)
  return base + getStudentElectivesFee(student)
}

export function getStudentBaseFee(student: Student, cls?: Class | null): number {
  return student.custom_fee != null ? student.custom_fee : (cls?.monthly_fee ?? 0)
}

export function getStudentElectivesFee(student: Student): number {
  return (student.electives ?? []).reduce((sum, name) => sum + getElectiveFee(name), 0)
}

/** 정규/선택과목 결제일이 다르게 설정되어 있는지 (선택과목 결제일이 있고 정규와 다른 경우) */
export function hasSplitDueDays(student: Student): boolean {
  if (student.electives_payment_due_day == null) return false
  if ((student.electives?.length ?? 0) === 0) return false
  return student.electives_payment_due_day !== (student.payment_due_day ?? null)
}

/** 해당 월 기준 재적 학생 필터 — enrollment/withdrawal 월 컷오프 (month 없으면 현재 재원생만).
 *  utils.ts 에서 이동(2026-08-13): utils 는 swr 최상단 import 라 서버 라우트에서 못 가져간다. */
export function getActiveStudents<T extends { withdrawal_date?: string | null; enrollment_date?: string | null }>(students: T[], month?: string): T[] {
  return students.filter(s => {
    if (month && s.enrollment_date && s.enrollment_date.slice(0, 7) > month) return false
    if (!s.withdrawal_date) return true
    if (!month) return false
    return s.withdrawal_date.slice(0, 7) >= month
  })
}

export function getPaymentStatus(totalPaid: number, fee: number): PaymentStatus {
  if (fee <= 0) return 'paid'
  if (totalPaid >= fee) return 'paid'
  if (totalPaid > 0) return 'partial'
  return 'unpaid'
}

/** 특정 기간 내 지정 요일의 수업 횟수를 센다 (startDate 포함, endDate 미포함) */
export function countClassDays(startDate: Date, endDate: Date, days: number[]): number {
  let count = 0
  const d = new Date(startDate)
  while (d < endDate) {
    if (days.includes(d.getDay())) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

/** class_days 문자열 "3,5" → 숫자 배열 [3,5] 파싱 */
export function parseClassDays(classDays: string | null | undefined): number[] | null {
  if (!classDays || !classDays.trim()) return null
  return classDays.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
}

export const DAY_LABELS: Record<number, string> = {
  0: '일', 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토',
}

/**
 * 퇴원일 직전 마지막 수업일을 계산한다.
 * calcRefund와 일관성: 퇴원일 당일은 미수강 처리이므로 그 전 마지막 class day 반환.
 * classDays 없으면 퇴원일 전날 그대로.
 */
export function getLastClassDate(withdrawalDate: Date, classDays?: string | null): Date {
  const days = parseClassDays(classDays)
  // 퇴원일 전날부터 시작
  const d = new Date(withdrawalDate.getFullYear(), withdrawalDate.getMonth(), withdrawalDate.getDate() - 1)
  if (!days || days.length === 0) return d
  for (let i = 0; i < 7; i++) {
    if (days.includes(d.getDay())) return d
    d.setDate(d.getDate() - 1)
  }
  return new Date(withdrawalDate.getFullYear(), withdrawalDate.getMonth(), withdrawalDate.getDate() - 1)
}

export function calcRefund(
  fee: number,
  enrollmentDate: Date,
  withdrawalDate: Date,
  classDays?: string | null,
  paymentDueDay?: number | null,
): {
  totalSessions: number
  elapsedSessions: number
  remainingSessions: number
  refundAmount: number
  isSessionBased: boolean
} {
  // 현재 기간 시작일 = "가장 최근 결제일". paymentDueDay 있으면 우선 사용,
  // 없으면 enrollment_date의 일자 fallback.
  // 예: 결제일=15일, 오늘=5/4 → 가장 최근 결제일 = 4/15 (5/15는 미래라 한달 전)
  // today를 자정으로 normalize: 퇴원일 당일 수업은 듣지 않은 것으로 계산해 환불에 포함
  const today = new Date(withdrawalDate.getFullYear(), withdrawalDate.getMonth(), withdrawalDate.getDate())
  const startDay = paymentDueDay && paymentDueDay > 0 ? paymentDueDay : enrollmentDate.getDate()
  // 결제일 29~31은 '그 달의 말일'로 클램프 — 28 고정 클램프는 결제일 29~31 학생에서 기간
  // 시작일이 최대 3일 어긋나 환불액이 틀어졌다 (2026-08-13 라인리뷰. 28 이하는 동작 동일).
  const mkPeriodPoint = (y: number, m: number) => {
    const lastDay = new Date(y, m + 1, 0).getDate()
    return new Date(y, m, Math.min(startDay, lastDay))
  }
  let currentPeriodStart = mkPeriodPoint(today.getFullYear(), today.getMonth())
  if (currentPeriodStart > today) {
    currentPeriodStart = mkPeriodPoint(today.getFullYear(), today.getMonth() - 1)
  }
  const currentPeriodEnd = mkPeriodPoint(currentPeriodStart.getFullYear(), currentPeriodStart.getMonth() + 1)

  const days = parseClassDays(classDays)

  if (days && days.length > 0) {
    // 수업 횟수 기반 계산
    const totalSessions = countClassDays(currentPeriodStart, currentPeriodEnd, days)
    const elapsedSessions = countClassDays(currentPeriodStart, today, days)
    const remainingSessions = Math.max(0, totalSessions - elapsedSessions)
    const refundAmount = totalSessions > 0
      ? Math.round(fee * (remainingSessions / totalSessions))
      : 0

    return { totalSessions, elapsedSessions, remainingSessions, refundAmount, isSessionBased: true }
  } else {
    // 일수 기반 fallback
    const totalDays = Math.round((currentPeriodEnd.getTime() - currentPeriodStart.getTime()) / (1000 * 60 * 60 * 24))
    const elapsedDays = Math.round((today.getTime() - currentPeriodStart.getTime()) / (1000 * 60 * 60 * 24))
    const remainingDays = Math.max(0, totalDays - elapsedDays)
    const refundAmount = totalDays > 0
      ? Math.round(fee * (remainingDays / totalDays))
      : 0

    return { totalSessions: totalDays, elapsedSessions: elapsedDays, remainingSessions: remainingDays, refundAmount, isSessionBased: false }
  }
}
