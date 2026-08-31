import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

/** 활성 학생의 사용 중 출결코드 집합 (excludeId 제외).
 *  조회 error를 버리고 빈 Set을 돌려주면 중복 검사가 통째로 fail-open 되어 같은 4자리 코드 학생이
 *  둘 생긴다(키오스크는 첫 매칭 한 명만 처리 = 다른 학생 등원이 기록·통보 안 됨).
 *  그래서 error를 표면화하고, 호출부는 저장을 중단한다. (2026-08-16 라인리뷰) */
export async function takenAttendanceCodes(
  excludeId?: string,
): Promise<{ codes: Set<string>; error: string | null }> {
  let q = supabase.from('tuition_students').select('attendance_code').is('withdrawal_date', null).not('attendance_code', 'is', null)
  if (excludeId) q = q.neq('id', excludeId)
  const { data, error } = await q
  if (error) return { codes: new Set(), error: error.message }
  return { codes: new Set((data ?? []).map(r => r.attendance_code).filter(Boolean) as string[]), error: null }
}

/** 출결코드 중복 검사 조회 실패 시 fail-closed 응답 — 검사를 못 했으면 저장하지 않는다. */
export function attendanceCodeGuardFailed(detail: string): NextResponse {
  console.error('[students] 출결번호 중복 검사 조회 실패 — 저장 중단:', detail)
  return NextResponse.json({
    error: '출결번호 중복 확인에 실패해 저장을 중단했습니다. 잠시 후 다시 시도하세요.',
    code: 'GUARD_QUERY_FAILED',
    detail,
  }, { status: 500 })
}
