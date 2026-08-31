import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession, hasFinanceSession, stripFinanceFields } from '@/lib/auth'
import { validateInput, rules } from '@/lib/validate'
import { writeAuditLog } from '@/lib/auditLog'

// pay_ratio(급여배분율)는 원장 전용 데이터다. 이 라우트는 미들웨어 PIN 게이트 제외 대상이라
// finance PIN 쿠키 유무로 읽기(필드 제거)/쓰기(거부)를 직접 판정한다. (2026-07-25 감사 P1)
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  const { id } = await params
  const { data, error } = await supabase
    .from('tuition_teachers')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (hasFinanceSession(request)) return NextResponse.json(data)
  return NextResponse.json(data ? stripFinanceFields(data) : data)
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params
  const body = await request.json()

  const validationError = validateInput([
    rules.optionalString('name', body.name),
  ])
  if (validationError) return validationError

  const updates: Record<string, unknown> = {}
  if (body.name !== undefined) updates.name = body.name
  if (body.phone !== undefined) updates.phone = body.phone || null
  if (body.subject !== undefined) updates.subject = body.subject || null
  if (body.memo !== undefined) updates.memo = body.memo || null
  // pay_ratio 쓰기는 원장 PIN 필수 — admin 세션만으론 급여배분율을 바꿀 수 없다.
  // (다른 필드는 지금처럼 admin 세션만으로 통과)
  if (body.pay_ratio !== undefined) {
    if (!hasFinanceSession(request)) {
      return NextResponse.json({ error: 'Finance PIN required' }, { status: 401 })
    }
    updates.pay_ratio = body.pay_ratio
  }
  if (body.order_index !== undefined) updates.order_index = body.order_index

  const { data, error } = await supabase
    .from('tuition_teachers')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const logKeys = Object.keys(updates).filter(k => k !== 'order_index')
  if (logKeys.length > 0) {
    await writeAuditLog('teacher', id, 'update', `선생님 수정: ${data.name} (${logKeys.join(', ')})`, updates)
  }

  return NextResponse.json(data)
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params

  const { data: existing } = await supabase
    .from('tuition_teachers')
    .select('name, subject')
    .eq('id', id)
    .single()

  const { error } = await supabase.from('tuition_teachers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog('teacher', id, 'delete', `선생님 삭제: ${existing?.name ?? id}`, existing ?? undefined)

  return NextResponse.json({ success: true })
}
