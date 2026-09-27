import { supabase } from './supabase'

interface RawGrade {
  id: string
  name: string
  order_index: number
  tuition_classes?: RawClass[]
}

interface RawClass {
  id: string
  grade_id: string
  name: string
  monthly_fee: number
  subject?: string | null
  class_days?: string | null
  teacher_id?: string | null
  order_index: number
  tuition_teachers?: Record<string, unknown> | null
  tuition_students?: Record<string, unknown>[]
}

// 2026-05-24 11:50 — c63cd45 select 다이어트 롤백.
// phone/parent_phone/attendance_code/payment_due_day/memo/status 등이 payments/billing/
// attendance/dashboard 카드에서 직접 쓰여 UI 전반이 비어 보였음. 일단 select('*') 안전 복구.
// 추후 다시 다이어트 시도할 때는 모든 consumer 의 .student.X 사용처를 grep 으로 전수 확인 후 진행.

/** 학년 > 반 > 학생 트리 조회 (Supabase raw) */
export async function queryGradesTree() {
  const { data, error } = await supabase
    .from('tuition_grades')
    .select('*, tuition_classes(*, tuition_teachers:teacher_id(*), tuition_students(*))')
    .order('order_index')
    .order('order_index', { referencedTable: 'tuition_classes' })
    .order('order_index', { referencedTable: 'tuition_classes.tuition_students' })
    .order('name', { referencedTable: 'tuition_classes.tuition_students' })

  return { data: data as RawGrade[] | null, error }
}

/** Supabase 응답을 프론트용 구조로 변환 (tuition_classes → classes, tuition_students → students) */
export function mapGradesTree(
  data: RawGrade[],
  mapTeacher: (teacher: Record<string, unknown>) => Record<string, unknown> = teacher => teacher,
) {
  return data.map(({ tuition_classes, ...grade }) => ({
    ...grade,
    classes: (tuition_classes ?? []).map(({ tuition_teachers, tuition_students, ...cls }) => ({
      ...cls,
      teacher: tuition_teachers ? mapTeacher(tuition_teachers) : null,
      students: tuition_students ?? [],
    })),
  }))
}

/** 특정 월의 학생별 납부 합계 맵 조회 */
export async function queryPaidMap(billingMonth: string) {
  const { data, error } = await supabase
    .from('tuition_payments')
    .select('student_id, amount')
    .eq('billing_month', billingMonth)
    .is('deleted_at', null)

  if (error) return { paidMap: {} as Record<string, number>, error }

  const paidMap: Record<string, number> = {}
  for (const p of (data ?? [])) {
    paidMap[p.student_id] = (paidMap[p.student_id] ?? 0) + p.amount
  }
  return { paidMap, error: null }
}

/** 특정 월의 학생별 요금 스냅샷 맵 — 과거 월 요금의 정본 (finance/teachers 페이지의 fee-snapshots axis와 동일).
 *  행이 없는 학생은 호출부가 현재 요금으로 폴백한다 (스냅샷 도입 전 과거 월·미래 월). */
export async function querySnapshotFeeMap(month: string) {
  const { data, error } = await supabase
    .from('tuition_fee_snapshot')
    .select('student_id, fee')
    .eq('month', month)

  if (error) return { feeMap: {} as Record<string, number>, error }

  const feeMap: Record<string, number> = {}
  for (const r of (data ?? [])) {
    feeMap[r.student_id] = r.fee
  }
  return { feeMap, error: null }
}
