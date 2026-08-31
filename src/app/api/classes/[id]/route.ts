import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { validateInput, rules } from '@/lib/validate'
import { writeAuditLog } from '@/lib/auditLog'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params
  const body = await request.json()

  const validationError = validateInput([
    rules.optionalString('name', body.name),
    // subject를 명시적으로 비우는 수정 차단 — 반 신원 = (subject, grade_id, name) (2026-08-08)
    rules.optionalString('subject', body.subject),
    rules.nonNegativeNumber('monthly_fee', body.monthly_fee),
    // 무검증이면 문자열·객체·거대값이 그대로 update로 들어가 PG 에러가 500으로 샌다 (2026-08-16 라인리뷰)
    rules.nonNegativeNumber('order_index', body.order_index),
  ])
  if (validationError) return validationError

  const updates: Record<string, unknown> = {}
  if (body.name !== undefined) updates.name = body.name
  // 원비 칸을 비우고 저장 → 0원이 굳으면 그 반 전원이 완납으로 표시된다.
  // 0원 반은 실존하지 않으므로(무료 학생은 학생별 custom_fee=0) 명시적으로 거부 (2026-08-13 라인리뷰)
  if (body.monthly_fee === 0) {
    return NextResponse.json({ error: '반 원비를 0원으로 저장할 수 없습니다. 무료는 학생별 수강료(0원)로 설정하세요.' }, { status: 400 })
  }
  if (body.monthly_fee !== undefined) updates.monthly_fee = body.monthly_fee
  if (body.grade_id !== undefined) updates.grade_id = body.grade_id
  if (body.subject !== undefined) updates.subject = body.subject
  if (body.class_days !== undefined) updates.class_days = body.class_days || null
  if (body.teacher_id !== undefined) updates.teacher_id = body.teacher_id || null
  if (body.order_index !== undefined) updates.order_index = body.order_index

  const { data, error } = await supabase
    .from('tuition_classes')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // order_index만 변경은 순서 변경이므로 로그 생략
  const logKeys = Object.keys(updates).filter(k => k !== 'order_index')
  if (logKeys.length > 0) {
    await writeAuditLog('class', id, 'update', `반 수정: ${data.name} (${logKeys.join(', ')})`, updates)
  }

  return NextResponse.json(data)
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params

  const { data: existing } = await supabase
    .from('tuition_classes')
    .select('name, subject, monthly_fee')
    .eq('id', id)
    .single()

  // 재원생이 남은 반 삭제 차단 — class_id가 null로 남는데 미배정 학생을 보여주는 화면이
  // 하나도 없어, 소속 학생이 모든 화면(납부·출결·집계)에서 조용히 사라진다 (2026-08-13 라인리뷰 P2).
  const { data: activeStudents, error: cntErr } = await supabase
    .from('tuition_students')
    .select('id')
    .eq('class_id', id)
    .is('withdrawal_date', null)
  if (cntErr) {
    return NextResponse.json({ error: `재원생 확인 실패 — 삭제 중단: ${cntErr.message}` }, { status: 500 })
  }
  if ((activeStudents?.length ?? 0) > 0) {
    return NextResponse.json({
      error: `재원생 ${activeStudents!.length}명이 이 반에 있습니다. 학생을 다른 반으로 이동한 뒤 삭제하세요.`,
      code: 'CLASS_HAS_STUDENTS',
    }, { status: 409 })
  }

  const { error } = await supabase.from('tuition_classes').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog('class', id, 'delete', `반 삭제: ${existing?.name ?? id}`, existing ?? undefined)

  return NextResponse.json({ success: true })
}
