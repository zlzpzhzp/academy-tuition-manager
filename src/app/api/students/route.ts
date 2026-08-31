import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { validateInput, rules } from '@/lib/validate'
import { writeAuditLog } from '@/lib/auditLog'
import { pickAttendanceCode } from '@/lib/student-codes'
import { snapshotCurrentMonthFee } from '@/lib/feeSnapshot'
import { takenAttendanceCodes, attendanceCodeGuardFailed } from '@/lib/attendanceCodes'

export async function GET(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { searchParams } = new URL(request.url)
  const classId = searchParams.get('class_id')
  const activeOnly = searchParams.get('active') === 'true'

  let query = supabase.from('tuition_students').select('*, class:tuition_classes(*, grade:tuition_grades(*))').order('name')
  if (classId) query = query.eq('class_id', classId)
  if (activeOnly) query = query.is('withdrawal_date', null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const body = await request.json()

  const validationError = validateInput([
    rules.requiredString('name', body.name),
    rules.required('class_id', body.class_id),
    rules.validDate('enrollment_date', body.enrollment_date),
    rules.nonNegativeNumber('custom_fee', body.custom_fee),
  ])
  if (validationError) return validationError

  // 해당 반의 최대 order_index + 1 → 맨 아래로 추가
  const { data: maxRow } = await supabase
    .from('tuition_students')
    .select('order_index')
    .eq('class_id', body.class_id)
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (maxRow?.order_index ?? 0) + 1

  // 학생 번호 입력 시 출결코드 자동(뒷4자리, 중복이면 가운데4자리)
  let attendanceCode: string | null = body.attendance_code || null
  let codeConflict: 'none' | 'middle' | 'both' = 'none'
  if (!attendanceCode && body.phone) {
    const { codes, error: takenErr } = await takenAttendanceCodes()
    // 조회 실패면 빈 Set으로 뽑게 되어 이미 쓰이는 코드를 배정할 수 있다 — fail-closed (2026-08-16 라인리뷰)
    if (takenErr) return attendanceCodeGuardFailed(takenErr)
    const picked = pickAttendanceCode(body.phone, codes)
    attendanceCode = picked.code || null
    codeConflict = picked.conflict
  }
  // 출결번호 형식 검증 — DB varchar(4) 제약. 수동 입력이 5자+ 면 raw 500 나던 것 차단 (2026-06-17 9app-review P0).
  if (attendanceCode && !/^\d{4}$/.test(attendanceCode)) {
    return NextResponse.json({ error: '출결번호는 4자리 숫자여야 합니다' }, { status: 400 })
  }
  // 수동 입력 코드도 중복 검사 — 자동 배정만 검사하면 같은 코드 학생이 둘이 되고,
  // 키오스크는 첫 매칭 한 명만 처리해 다른 학생의 등원이 기록·통보되지 않는다 (2026-08-13 라인리뷰 P2).
  if (body.attendance_code) {
    const { codes, error: takenErr } = await takenAttendanceCodes()
    if (takenErr) return attendanceCodeGuardFailed(takenErr)
    if (codes.has(attendanceCode!)) {
      return NextResponse.json({ error: `출결번호 ${attendanceCode}는 이미 다른 재원생이 쓰고 있습니다` }, { status: 409 })
    }
  }

  const { data, error } = await supabase
    .from('tuition_students')
    .insert({
      class_id: body.class_id,
      name: body.name,
      school: (typeof body.school === 'string' && body.school.trim()) ? body.school.trim() : null,
      phone: body.phone || null,
      parent_phone: body.parent_phone || null,
      parent_father_phone: body.parent_father_phone || null,
      payssam_recipient: body.payssam_recipient === 'father' ? 'father' : 'mother',
      attendance_recipient: body.attendance_recipient === 'father' ? 'father' : 'mother',
      attendance_code: attendanceCode,
      enrollment_date: body.enrollment_date,
      custom_fee: body.custom_fee ?? null,
      memo: body.memo || null,
      order_index: nextOrder,
      electives: Array.isArray(body.electives) ? body.electives : [],
    })
    .select('*, class:tuition_classes(*, grade:tuition_grades(*))')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog('student', data.id, 'create', `학생 등록: ${body.name}`, { name: body.name, class_id: body.class_id })

  // 신규생 당월 스냅샷 즉시 생성 — 크론(매월 1일)만 기다리면 등록월이 과거달로 넘어간 뒤
  // 요금 변경 시 등록월 표시가 흔들림 (2026-07-10 지시: 변동의 과거달 영향 차단)
  await snapshotCurrentMonthFee(data.id)

  return NextResponse.json({ ...data, _attendanceCode: attendanceCode, _codeConflict: codeConflict })
}
