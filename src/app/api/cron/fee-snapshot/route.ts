import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getStudentFee, type Student, type Class } from '@/types'
import { requireCronSecret } from '@/lib/auth'

// 월별 요금 스냅샷 — 매월 1일 실행 (시스템 crontab).
// 완납/지난달미납 판정이 "현재 요금"으로 과거를 재계산해 요금 변경 시 과거 달 표시가
// 뒤바뀌던 문제(2026-07-02 정합성 전수검사 ①)의 해결: 그 달의 요금을 그 달에 박제한다.
// 표시 로직은 스냅샷 우선, 없으면 현재 요금 fallback.
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  // KST 기준 현재 월 (서버 UTC 대비 +9h shift)
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const month = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`

  const [{ data: students, error: studentsError }, { data: classes, error: classesError }] = await Promise.all([
    supabase.from('tuition_students').select('id, custom_fee, electives, class_id, enrollment_date, withdrawal_date'),
    supabase.from('tuition_classes').select('id, monthly_fee'),
  ])
  if (studentsError || !students) {
    return NextResponse.json({ error: `학생 조회 실패: ${studentsError?.message ?? 'no data'}` }, { status: 500 })
  }
  // classes 실패도 fail-closed — `?? []`로 진행하면 반비가 전원 0원으로 계산돼 그대로 박제되고,
  // ignoreDuplicates 라 다음 크론이 영원히 교정 못 한다 (2026-08-13 라인리뷰 P1-A)
  if (classesError || !classes) {
    return NextResponse.json({ error: `반 조회 실패 — 스냅샷 0건 기록: ${classesError?.message ?? 'no data'}` }, { status: 500 })
  }

  const classById = new Map(classes.map(c => [c.id, c]))
  // 그 달에 재원 중인 학생만 (등록 전/퇴원 후 제외 — getActiveStudents와 동일 기준)
  const active = students.filter(s =>
    (!s.enrollment_date || s.enrollment_date.slice(0, 7) <= month) &&
    (!s.withdrawal_date || s.withdrawal_date.slice(0, 7) >= month)
  )

  const rows = active.map(s => ({
    student_id: s.id,
    month,
    fee: getStudentFee(s as Student, classById.get(s.class_id) as Class | undefined),
  }))

  // 이미 스냅샷된 학생은 유지(월 중 요금 변경이 과거 스냅샷을 덮지 않도록 ignoreDuplicates),
  // 단 월초 첫 실행이 기준값. 월 중 신규 등록생은 다음 실행에서 추가됨.
  const { error } = await supabase
    .from('tuition_fee_snapshot')
    .upsert(rows, { onConflict: 'student_id,month', ignoreDuplicates: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, month, snapshotted: rows.length, at: new Date().toISOString() })
}
