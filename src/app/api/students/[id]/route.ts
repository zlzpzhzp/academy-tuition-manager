import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { validateInput, rules } from '@/lib/validate'
import { writeAuditLog } from '@/lib/auditLog'
import { requireAdminSession } from '@/lib/auth'
import { pickAttendanceCode } from '@/lib/student-codes'
import { snapshotCurrentMonthFee } from '@/lib/feeSnapshot'
import { takenAttendanceCodes, attendanceCodeGuardFailed } from '@/lib/attendanceCodes'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params

  const { data, error } = await supabase
    .from('tuition_students')
    .select('*, class:tuition_classes(*, grade:tuition_grades(*))')
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params
  const body = await request.json()

  const validationError = validateInput([
    rules.optionalString('name', body.name),
    rules.optionalDate('enrollment_date', body.enrollment_date),
    rules.nonNegativeNumber('custom_fee', body.custom_fee),
  ])
  if (validationError) return validationError

  const updates: Record<string, unknown> = {}
  if (body.name !== undefined) updates.name = body.name
  if (body.school !== undefined) updates.school = (typeof body.school === 'string' && body.school.trim()) ? body.school.trim() : null
  if (body.class_id !== undefined) updates.class_id = body.class_id
  if (body.phone !== undefined) updates.phone = body.phone || null
  if (body.parent_phone !== undefined) updates.parent_phone = body.parent_phone || null
  if (body.parent_father_phone !== undefined) updates.parent_father_phone = body.parent_father_phone || null
  if (body.payssam_recipient !== undefined) updates.payssam_recipient = body.payssam_recipient === 'father' ? 'father' : 'mother'
  if (body.attendance_recipient !== undefined) updates.attendance_recipient = body.attendance_recipient === 'father' ? 'father' : 'mother'
  if (body.enrollment_date !== undefined) updates.enrollment_date = body.enrollment_date
  if (body.withdrawal_date !== undefined) updates.withdrawal_date = body.withdrawal_date
  if (body.custom_fee !== undefined) updates.custom_fee = body.custom_fee
  if (body.payment_due_day !== undefined) updates.payment_due_day = body.payment_due_day
  if (body.electives_payment_due_day !== undefined) updates.electives_payment_due_day = body.electives_payment_due_day
  if (body.memo !== undefined) updates.memo = body.memo || null
  if (body.memo_color !== undefined) updates.memo_color = body.memo_color || null
  if (body.split_billing_parts !== undefined) updates.split_billing_parts = body.split_billing_parts
  if (body.split_billing_amounts !== undefined) updates.split_billing_amounts = body.split_billing_amounts
  if (body.electives !== undefined) updates.electives = Array.isArray(body.electives) ? body.electives : []
  if (body.batch_exclude_month !== undefined) updates.batch_exclude_month = body.batch_exclude_month || null
  if (body.attendance_code !== undefined) updates.attendance_code = body.attendance_code || null
  // 명단 순서. 2026-07-26까지 이 필드는 학생 생성 시 자동 부여(반 max+1)만 있고 수정 경로가 없어서,
  // 운영자님이 종이 명단 순서대로 맞추라고 하실 때 DB를 직접 건드릴 수밖에 없었다 — API로 연다.
  if (body.order_index !== undefined && Number.isInteger(body.order_index) && body.order_index >= 0) {
    updates.order_index = body.order_index
  }

  // 학생 번호 변경 시 출결코드 자동(뒷4자리, 중복이면 가운데4자리). attendance_code 명시되면 그것 우선
  let codeConflict: 'none' | 'middle' | 'both' = 'none'
  if (body.phone !== undefined && body.attendance_code === undefined) {
    if (body.phone) {
      // 조회 실패면 빈 Set으로 뽑게 되어 이미 쓰이는 코드를 배정할 수 있다 — fail-closed (2026-08-16 라인리뷰)
      const { codes: taken, error: takenErr } = await takenAttendanceCodes(id)
      if (takenErr) return attendanceCodeGuardFailed(takenErr)
      const picked = pickAttendanceCode(body.phone, taken)
      updates.attendance_code = picked.code || null
      codeConflict = picked.conflict
    } else {
      updates.attendance_code = null
    }
  }
  // 출결번호 형식 검증 — DB varchar(4). 수동 입력 5자+ 면 raw 500 나던 것 차단 (2026-06-17 9app-review P0).
  if (updates.attendance_code && !/^\d{4}$/.test(String(updates.attendance_code))) {
    return NextResponse.json({ error: '출결번호는 4자리 숫자여야 합니다' }, { status: 400 })
  }
  // 수동 입력 코드 중복 검사(본인 제외) — 중복이면 키오스크가 한 명만 처리한다 (2026-08-13 라인리뷰 P2, POST와 동일)
  if (body.attendance_code && updates.attendance_code) {
    const { codes: taken, error: takenErr } = await takenAttendanceCodes(id)
    if (takenErr) return attendanceCodeGuardFailed(takenErr)
    if (taken.has(String(updates.attendance_code))) {
      return NextResponse.json({ error: `출결번호 ${updates.attendance_code}는 이미 다른 재원생이 쓰고 있습니다` }, { status: 409 })
    }
  }

  const { data, error } = await supabase
    .from('tuition_students')
    .update(updates)
    .eq('id', id)
    .select('*, class:tuition_classes(*, grade:tuition_grades(*))')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // memo/memo_color 변경은 빈번하므로 중요 변경만 로그.
  // 🔴 2026-08-02 보강: 이 목록이 낡아 있었다. school 을 3명 고쳤는데 **감사로그가 0건**이었고,
  //   그건 school 이 여기 없어서였다. 목록이 만들어진 뒤에 의미가 커진 필드들을 넣는다:
  //     · school        — 2026-07-10 부로 원비가 학교정보의 **함대 정본**이다(쌤·홈피·워라가 이 값을 읽는다).
  //                       실제로 잘못된 값이 3주간 3개 앱에 퍼졌는데 누가 언제 넣었는지 추적할 기록이 없었다.
  //     · parent_phone  — **청구서 수신처**다. 바뀌면 돈이 다른 번호로 간다.
  //     · phone         — 학생 본인 연락 경로.
  //     · attendance_code — 키오스크 신원. 바뀌면 다른 학생으로 등하원이 찍힌다.
  //     · electives     — 아래 feeKeys 에 이미 있어 **요금 스냅샷은 갱신하면서 로그는 안 남기던** 불일치.
  const importantKeys = ['name', 'class_id', 'custom_fee', 'payment_due_day', 'withdrawal_date', 'enrollment_date',
    'school', 'parent_phone', 'phone', 'attendance_code', 'electives']
  const changed = Object.keys(updates).filter(k => importantKeys.includes(k))
  if (changed.length > 0) {
    const name = data.name || id
    await writeAuditLog('student', id, 'update', `학생 수정: ${name} (${changed.join(', ')})`, updates)
  }

  // 요금에 영향 주는 변경 → 당월 스냅샷 즉시 갱신 (과거달은 불가침 — 변동이 전달 결제
  // 표시에 영향 못 주게, 2026-07-10 지시). await: 서버리스 fire-and-forget 유실 방지.
  const feeKeys = ['electives', 'custom_fee', 'class_id', 'enrollment_date', 'withdrawal_date']
  if (Object.keys(updates).some(k => feeKeys.includes(k))) {
    await snapshotCurrentMonthFee(id)
  }

  return NextResponse.json({ ...data, _codeConflict: codeConflict, _attendanceCode: updates.attendance_code })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params

  const { data: existing } = await supabase
    .from('tuition_students')
    .select('name')
    .eq('id', id)
    .single()

  // 결제기록 있는 학생은 삭제 금지 — FK on delete cascade가 tuition_payments를 물리 삭제해
  // "결제 row 영구 보존(soft-delete만)" 원칙을 우회하는 백도어가 됨 (2026-07-10 전수점검).
  // soft-delete된 결제 row도 감사 추적용이므로 deleted_at 무관하게 존재 자체로 차단.
  const { count: paymentCount, error: countError } = await supabase
    .from('tuition_payments')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', id)
  if (countError || paymentCount === null) {
    // fail-closed: 결제기록 확인이 안 되면 삭제도 안 한다
    return NextResponse.json({ error: '결제 기록 확인 실패 — 삭제 중단' }, { status: 500 })
  }
  if (paymentCount > 0) {
    return NextResponse.json(
      { error: `결제 기록이 ${paymentCount}건 있는 학생은 삭제할 수 없습니다. 퇴원 처리를 사용하세요.` },
      { status: 409 },
    )
  }

  const { error } = await supabase.from('tuition_students').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog('student', id, 'delete', `학생 삭제: ${existing?.name ?? id}`, existing ?? undefined)

  return NextResponse.json({ success: true })
}
