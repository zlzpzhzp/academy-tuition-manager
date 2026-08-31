import type { Student } from '@/types'
import useSWR, { mutate as globalMutate } from 'swr'

// ─── SWR Fetcher & Hooks ─────────────────────────────────────────
/** 공용 SWR fetcher — res.ok 검사 후 실패 시 throw (에러 payload가 data로 새는 것 방지). */
export const swrFetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `요청 실패 (${res.status})`)
  }
  return res.json()
}

const swrOptions = {
  revalidateOnFocus: true,
  dedupingInterval: 5000,
}

export function useGrades<T = unknown>() {
  return useSWR<T>('/api/grades', swrFetcher, swrOptions)
}

export function useTeachers<T = unknown>() {
  return useSWR<T>('/api/teachers', swrFetcher, swrOptions)
}

export function revalidateTeachers() {
  globalMutate('/api/teachers')
}

export function usePayments<T = unknown>(billingMonth: string | null) {
  return useSWR<T>(
    billingMonth ? `/api/payments?billing_month=${billingMonth}` : null,
    swrFetcher,
    swrOptions,
  )
}

/** 데이터 변경 후 관련 캐시 무효화 */
export function revalidateGrades() {
  globalMutate('/api/grades')
}

export function revalidatePayments(billingMonth: string) {
  globalMutate(`/api/payments?billing_month=${billingMonth}`)
}

/** 신규 결제 row를 즉시 SWR 캐시에 주입 (optimistic update). 백그라운드 revalidate도 함께 트리거 */
export function injectPayment<T extends { id: string }>(billingMonth: string, payment: T) {
  const key = `/api/payments?billing_month=${billingMonth}`
  globalMutate(
    key,
    (current: T[] | undefined) => {
      const arr = current ?? []
      // 동일 id 있으면 교체, 없으면 prepend
      const filtered = arr.filter(p => p.id !== payment.id)
      return [payment, ...filtered]
    },
    { revalidate: true },
  )
}

/** 결제 row 삭제 후 SWR 캐시에서 즉시 제거 */
export function removePaymentFromCache<T extends { id: string }>(billingMonth: string, paymentId: string) {
  const key = `/api/payments?billing_month=${billingMonth}`
  globalMutate(
    key,
    (current: T[] | undefined) => (current ?? []).filter(p => p.id !== paymentId),
    { revalidate: true },
  )
}

// ─── Date Helpers (re-export from lib/date) ─────────────────────────
export { getTodayString } from './date'

// ─── '이 달만 일괄청구 제외' (batch_exclude_month) ─────────────────
/**
 * 발송 제외 판정 — 플래그가 그 달이면 무조건 참. 일괄발송 대상에서 빼는 용도(납부·특강 공용).
 * 화면 판정(배지·반 헤더 분모)은 이걸 직접 쓰지 말고 isBatchExcludedNoBill 을 쓸 것 —
 * '제외'는 "일괄로 보내지 마라"지 "청구가 없다"가 아니다. 개별 청구가 나간 학생을 이 함수로
 * 화면에서 빼면 미납자가 완납으로 접힌 반 안에 숨는다.
 */
export function isBatchExcluded(s: { batch_exclude_month?: string | null }, month: string): boolean {
  return !!s.batch_exclude_month && s.batch_exclude_month === month
}

/**
 * 화면 부재 판정 — 제외월이면서 그 달 청구서가 하나도 없을 때만 참.
 * 배지('이달 청구없음')와 반 헤더 분모(classStats)는 **반드시 이 한 함수**를 쓴다.
 * 2026-08-05 배지만 '청구 있으면 상태 표시'(1cf9f0d)로 바뀌고 분모(77fd71c)는 무조건 제외로
 * 남아, 제외월+개별청구+미납(정국)이 행은 빨간 미납인데 반은 완납으로 접히는 불일치가
 * 생겼다. 판정이 두 곳에 살면 다시 갈라진다 — 그래서 여기 하나로 모은다.
 */
export function isBatchExcludedNoBill(
  s: { batch_exclude_month?: string | null }, month: string, hasAnyBill: boolean,
): boolean {
  return isBatchExcluded(s, month) && !hasAnyBill
}

// ─── '지난달 미납' 판정 (2026-08-27) ────────────────────────────────
/**
 * 어느 학생의 그 달 청구가 '종결'됐는지 — 정규(is_regular_tuition!==false) 청구서 중
 * paid 가 1건 이상이고 미결(sent) 이 0건인 학생 집합.
 * 이월 차감·재정산 같은 조정 금액 청구를 완납하면 스냅샷 요금보다 적게 냈어도 그 청구액이
 * 그 달의 확정 요금이다(카리나 181,000 완납이 35만 스냅샷 대비 미납으로 오판되던 것).
 * destroyed/cancelled 만 있는 학생(상계·카드전환 후 미납)은 종결로 치지 않는다 — paid 가 없다.
 */
export function buildBillSettledSet(
  bills: { student_id: string; status: string; is_regular_tuition?: boolean | null }[],
): Set<string> {
  const counts = new Map<string, { paid: number; outstanding: number }>()
  for (const b of bills) {
    if (b.is_regular_tuition === false) continue // 특강 등 별도 청구는 정규 미납 판정과 무관
    const cur = counts.get(b.student_id) ?? { paid: 0, outstanding: 0 }
    if (b.status === 'paid') cur.paid++
    if (b.status === 'sent') cur.outstanding++
    counts.set(b.student_id, cur)
  }
  const settled = new Set<string>()
  for (const [sid, c] of counts) if (c.paid > 0 && c.outstanding === 0) settled.add(sid)
  return settled
}

/**
 * '지난달 미납' 단일 판정 — 행 배지와 일괄청구 제외가 같은 기준을 봐야 한다(2026-08-27 지시:
 * 일괄청구 시 지난달 미납자는 자동 제외). 퇴원·지난달 미재원·요금 0·완납·청구 종결이면 미납 아님.
 */
export function judgePrevMonthUnpaid(
  s: { enrollment_date?: string | null; withdrawal_date?: string | null },
  prevMonth: string,
  prevFee: number,
  prevPaid: number,
  billSettled: boolean,
): boolean {
  const wasEnrolledPrev = !s.enrollment_date || s.enrollment_date.slice(0, 7) <= prevMonth
  const wasActivePrev = !s.withdrawal_date || s.withdrawal_date.slice(0, 7) >= prevMonth
  if (!wasEnrolledPrev || !wasActivePrev) return false
  if (prevFee <= 0 || prevPaid >= prevFee) return false
  return !billSettled
}

// ─── Phone Formatting ────────────────────────────────────────────
export function formatPhone(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 11)
  if (!d) return ''
  if (d.startsWith('02')) {
    if (d.length <= 2) return d
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`
  }
  if (d.length <= 3) return d
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`
}

// ─── Payment Due Day ──────────────────────────────────────────────
/** 학생의 결제 예정일 — payment_due_day 우선, 없으면 등록일 기준 */
export function getPaymentDueDay(student: Student): number {
  if (student.payment_due_day != null) return student.payment_due_day
  return new Date(student.enrollment_date).getDate()
}

/** 결제일이 아직 안 지났으면 true (예정), 지났으면 false (미납) */
export function isPaymentScheduled(student: Student, selectedMonth: string, overrideDueDay?: number): boolean {
  const paymentDay = overrideDueDay ?? getPaymentDueDay(student)
  const today = new Date()
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  if (selectedMonth < currentMonth) return false
  if (selectedMonth > currentMonth) return true
  // 결제일 29~31은 그 날짜가 없는 달(2월 등)에 영원히 '예정'에 머물러 미납 목록에서 빠진다
  // → 그 달 말일로 클램프 (2026-08-13 라인리뷰. 현재 29+ 설정 학생 0명 실측 — 예방적)
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  return today.getDate() < Math.min(paymentDay, lastDay)
}

// ─── Month Helpers ────────────────────────────────────────────────
export function getPrevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function formatMonth(month: string): string {
  const [y, m] = month.split('-')
  return `${y}년 ${parseInt(m)}월`
}

export function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// ─── Payment Memo ─────────────────────────────────────────────────
/** DB에서 읽어온 메모에서 레거시 기타 결제방법 태그 + payssam bill_id 태그 디코딩 */
export function decodePaymentMemo(memo?: string | null): { cleanMemo: string | null; otherMethod: string | null } {
  if (!memo) return { cleanMemo: null, otherMethod: null }
  // payssam 콜백이 idempotency 위해 붙이는 [bill:...] 태그 제거 (사용자에게 안 보여줌)
  // 정규+선택과목 등 다중 청구서 결제 시 [bill:...]가 여러 개 누적되므로 g 플래그로 전부 제거
  let working = memo.replace(/\[bill:[^\]]+\]\s*/g, '')
  const match = working.match(/^\[기타:(.+?)\]/)
  if (match) {
    working = working.replace(/^\[기타:.+?\]/, '').trim()
    return { cleanMemo: working || null, otherMethod: match[1] }
  }
  return { cleanMemo: working || null, otherMethod: null }
}

// ─── Student Helpers ──────────────────────────────────────────────
/** 활성 학생 필터링 — month를 넘기면 해당 월에 퇴원한 학생도 포함 (취소선 표시용). 등록월 이전은 제외 */
// 구현은 @/types 로 이동 (2026-08-13) — 이 파일은 swr 을 최상단 import 해서 서버(API 라우트)가
// 여기서 가져가면 빌드가 깨진다. 기존 클라이언트 소비자를 위해 재수출만 유지.
export { getActiveStudents } from '@/types'

/** 해당 월 기준으로 퇴원한 학생인지 확인 */
export function isWithdrawnStudent(student: { withdrawal_date?: string | null }): boolean {
  return !!student.withdrawal_date
}

/** 학생의 미납 라벨 텍스트 생성 */
export function getUnpaidLabelText(student: Student, month: string, overrideDueDay?: number): string {
  const day = overrideDueDay ?? getPaymentDueDay(student)
  const m = parseInt(month.split('-')[1])
  const scheduled = isPaymentScheduled(student, month, overrideDueDay)
  return `${m}/${day} ${scheduled ? '예정' : '미납'}`
}

// ─── Fetch with Error Handling ────────────────────────────────────
export async function safeFetch<T>(url: string, options?: RequestInit): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(url, options)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { data: null, error: err.error || `요청 실패 (${res.status})` }
    }
    const data = await res.json()
    return { data, error: null }
  } catch {
    return { data: null, error: '네트워크 오류가 발생했습니다.' }
  }
}

/** POST/PUT/DELETE with JSON body */
export async function safeMutate<T>(url: string, method: string, body?: unknown): Promise<{ data: T | null; error: string | null }> {
  return safeFetch<T>(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}
