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

  // 부분 갱신(classes PUT과 동일 패턴) — order_index 미지원이라 신설 학년이 항상 맨 아래에
  // 갇혔다(생성 시 timestamp 기반 order_index. 2026-08-16 예비중1 건)
  // order_index 무검증이면 문자열·객체·거대값이 그대로 update로 들어가 PG 에러가 500으로 샌다
  // (2026-08-16 라인리뷰. classes PUT과 동일 처리)
  const validationError = validateInput([
    rules.optionalString('name', body.name),
    rules.nonNegativeNumber('order_index', body.order_index),
  ])
  if (validationError) return validationError

  const updates: Record<string, unknown> = {}
  if (body.name !== undefined) updates.name = body.name
  if (body.order_index !== undefined) updates.order_index = body.order_index
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '변경할 필드가 없습니다 (name, order_index)' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('tuition_grades')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // order_index만 변경은 순서 변경이므로 로그 생략 (classes PUT과 동일)
  if (body.name !== undefined) {
    await writeAuditLog('grade', id, 'update', `학년 수정: ${body.name}`, updates)
  }

  return NextResponse.json(data)
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params

  const { data: existing } = await supabase
    .from('tuition_grades')
    .select('name')
    .eq('id', id)
    .single()

  const { error } = await supabase.from('tuition_grades').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog('grade', id, 'delete', `학년 삭제: ${existing?.name ?? id}`, existing ?? undefined)

  return NextResponse.json({ success: true })
}
