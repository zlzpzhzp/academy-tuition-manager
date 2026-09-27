import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { getCurrentMonthString } from '@/lib/date'
import {
  aggregateMonthlyStats,
  addMonths,
  isValidMonth,
  type SnapshotRow,
  type PaymentRow,
  type SpecialRow,
  type StudentRow,
  type ClassRow,
  type TeacherRow,
} from '@/lib/monthlyStats'

/**
 * 월별 매출 추이 — GET /api/stats/monthly?from=YYYY-MM&to=YYYY-MM (2026-09-03 운영자님 지시)
 *
 * 읽기 전용. 조회는 여기서 몇 방으로 끝내고 계산은 전부 @/lib/monthlyStats(순수 함수)에 위임한다.
 *
 * 🔴 조회 error 는 전부 구조분해해 500 fail-closed — 돈 경로 규약([linereview.weekly]).
 *    "조회 실패"와 "데이터 없음"이 섞이면 매출이 0으로 보이는 조용한 거짓이 된다.
 */

/** PostgREST 기본 상한이 1000행이라 그냥 select 하면 조용히 잘린다(납부·스냅샷은 7개월치가 1200행+) */
const PAGE_SIZE = 1000
const MAX_ROWS = 100_000

type PageResult<T> = { data: T[] | null; error: { message: string } | null }

async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await page(offset, offset + PAGE_SIZE - 1)
    if (error) return { rows: [], error: error.message }
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return { rows, error: null }
}

/** 한 번에 볼 수 있는 최대 개월 수 — 요청이 더 길면 to 기준으로 잘라낸다 */
const MAX_SPAN = 24
const DEFAULT_SPAN = 12

export async function GET(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(request.url)
  const rawTo = searchParams.get('to')
  const rawFrom = searchParams.get('from')

  if (rawTo !== null && !isValidMonth(rawTo)) {
    return NextResponse.json({ error: 'to 는 YYYY-MM 형식이어야 합니다' }, { status: 400 })
  }
  if (rawFrom !== null && !isValidMonth(rawFrom)) {
    return NextResponse.json({ error: 'from 은 YYYY-MM 형식이어야 합니다' }, { status: 400 })
  }

  // 기본: 당월(KST)까지 최근 12개월
  const to = rawTo ?? getCurrentMonthString()
  let from = rawFrom ?? addMonths(to, -(DEFAULT_SPAN - 1))
  if (from > to) from = to
  // 24개월 상한 — 넘으면 최신(to) 기준으로 자른다
  const capFrom = addMonths(to, -(MAX_SPAN - 1))
  if (from < capFrom) from = capFrom

  const [snapRes, payRes, specialRes, studentRes, classRes, teacherRes] = await Promise.all([
    fetchAll<SnapshotRow>((f, t) =>
      supabase
        .from('tuition_fee_snapshot')
        .select('student_id, month, fee')
        .gte('month', from)
        .lte('month', to)
        .order('month')
        .range(f, t)),
    fetchAll<PaymentRow>((f, t) =>
      supabase
        .from('tuition_payments')
        .select('student_id, amount, method, billing_month')
        .is('deleted_at', null)
        .gte('billing_month', from)
        .lte('billing_month', to)
        .order('billing_month')
        .range(f, t)),
    // 특강 직접납부는 paid_at(date)의 KST 월로 버킷해야 해서 SQL 범위필터를 걸지 않는다
    // (paid_at 이 null 이면 created_at 폴백 — 두 컬럼을 SQL 에서 한 번에 자를 수 없다).
    // 테이블이 수십 행 규모라 전건 조회가 저렴하다.
    fetchAll<SpecialRow>((f, t) =>
      supabase
        .from('tuition_special_payment')
        .select('amount, paid_at, created_at')
        .is('deleted_at', null)
        .range(f, t)),
    fetchAll<StudentRow>((f, t) =>
      supabase.from('tuition_students').select('id, class_id').range(f, t)),
    fetchAll<ClassRow>((f, t) =>
      supabase.from('tuition_classes').select('id, teacher_id, subject').range(f, t)),
    fetchAll<TeacherRow>((f, t) =>
      supabase.from('tuition_teachers').select('id, name').range(f, t)),
  ])

  const failed = [snapRes, payRes, specialRes, studentRes, classRes, teacherRes].find(r => r.error)
  if (failed) {
    return NextResponse.json({ error: `GUARD_QUERY_FAILED: ${failed.error}` }, { status: 500 })
  }

  const months = aggregateMonthlyStats({
    from,
    to,
    snapshots: snapRes.rows,
    payments: payRes.rows,
    specials: specialRes.rows,
    students: studentRes.rows,
    classes: classRes.rows,
    teachers: teacherRes.rows,
  })

  // 당월은 아직 진행 중이라 수납이 덜 찼다 — 값은 그대로 주고 라벨링은 화면이 한다.
  return NextResponse.json(
    { from, to, currentMonth: getCurrentMonthString(), months },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
