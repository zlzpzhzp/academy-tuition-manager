import { supabase } from '@/lib/supabase'
import { getStudentFee, type Student, type Class } from '@/types'

/**
 * 당월 요금 스냅샷 갱신 — 요금에 영향 주는 변경(electives/custom_fee/class_id/신규등록) 직후 호출.
 *
 * 왜: 스냅샷은 매월 1일 크론이 박제하는데, 월 중에 선택과목·요금이 바뀌면 그 달 스냅샷이
 * 변경 전 값으로 남는다. 달이 넘어가 과거달이 되는 순간 그 낡은 스냅샷으로 완납/미납을
 * 판정해 표시가 어긋남. → 변경 즉시 "당월" 스냅샷만 덮어쓴다 (과거달 스냅샷은 절대 불가침 —
 * 결제금액/선택과목 변동이 전달 결제 표시에 영향 주지 않게, 2026-07-10 운영자님 지시).
 *
 * 실패는 감사 non-critical — 호출부 흐름을 막지 않고 콘솔만 남김 (다음달 1일 크론이 어차피
 * 신규 row는 채움. 갱신 실패분만 낡은 값 리스크).
 */
export async function snapshotCurrentMonthFee(studentId: string): Promise<void> {
  try {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const month = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`

    const { data: student } = await supabase
      .from('tuition_students')
      .select('id, custom_fee, electives, class_id, enrollment_date, withdrawal_date')
      .eq('id', studentId)
      .single()
    if (!student) return
    // 그 달 재원 아님(미래 등록/과거 퇴원) → 스냅샷 대상 아님
    if (student.enrollment_date && student.enrollment_date.slice(0, 7) > month) return
    if (student.withdrawal_date && student.withdrawal_date.slice(0, 7) < month) return

    let cls: Class | undefined
    if (student.class_id) {
      const { data, error } = await supabase
        .from('tuition_classes')
        .select('id, monthly_fee')
        .eq('id', student.class_id)
        .single()
      if (error) {
        console.error('[feeSnapshot] 반 조회 실패:', studentId, error.message)
        return
      }
      cls = (data as Class) ?? undefined
    }

    const fee = getStudentFee(student as Student, cls)
    // 당월만 upsert(덮어쓰기) — 크론(ignoreDuplicates)과 달리 최신 요금으로 갱신
    const { error } = await supabase
      .from('tuition_fee_snapshot')
      .upsert({ student_id: studentId, month, fee }, { onConflict: 'student_id,month' })
    if (error) console.error('[feeSnapshot] 당월 스냅샷 갱신 실패:', studentId, error.message)
  } catch (e) {
    console.error('[feeSnapshot] 예외:', e instanceof Error ? e.message : String(e))
  }
}
