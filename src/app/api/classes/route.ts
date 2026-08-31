import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { validateInput, rules } from '@/lib/validate'
import { writeAuditLog } from '@/lib/auditLog'

export async function GET(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { searchParams } = new URL(request.url)
  const gradeId = searchParams.get('grade_id')

  let query = supabase.from('tuition_classes').select('*, grade:tuition_grades(*), tuition_students(*)').order('order_index')
  if (gradeId) query = query.eq('grade_id', gradeId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const mapped = (data ?? []).map((c: Record<string, unknown>) => ({
    ...c,
    students: c.tuition_students ?? [],
  }))

  return NextResponse.json(mapped)
}

export async function POST(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const body = await request.json()

  const validationError = validateInput([
    rules.requiredString('name', body.name),
    // 반 신원 = (subject, grade_id, name) — 과목 없는 반은 이름만으로 특정 불가 (2026-08-08)
    rules.requiredString('subject', body.subject),
    rules.nonNegativeNumber('monthly_fee', body.monthly_fee),
    rules.required('grade_id', body.grade_id),
  ])
  if (validationError) return validationError

  const { data, error } = await supabase
    .from('tuition_classes')
    .insert({
      grade_id: body.grade_id,
      name: body.name,
      monthly_fee: body.monthly_fee ?? 0,
      subject: body.subject,
      class_days: body.class_days || null,
      teacher_id: body.teacher_id || null,
      order_index: Math.floor(Date.now() / 1000) % 2000000000,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog('class', data.id, 'create',
    `반 추가: ${body.name} (${body.subject || '과목없음'}, ${(body.monthly_fee ?? 0).toLocaleString()}원)`,
    { name: body.name, subject: body.subject, monthly_fee: body.monthly_fee })

  return NextResponse.json(data)
}
