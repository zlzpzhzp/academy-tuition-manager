import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession, hasFinanceSession, stripFinanceFields } from '@/lib/auth'
import { validateInput, rules } from '@/lib/validate'
import { writeAuditLog } from '@/lib/auditLog'

/**
 * /api/teachers 는 설정(반·선생 CRUD)·대시보드가 admin 세션만으로 쓰는 공용 라우트라
 * 미들웨어의 finance PIN 게이트에서 의도적으로 제외돼 있다(middleware.ts). 그 틈으로
 * 원장 전용 급여배분율(pay_ratio)이 admin 세션만으로 새던 구멍을 응답 필드 단위로 막는다.
 * → PIN 쿠키가 유효할 때만 pay_ratio 포함. (2026-07-25 감사 P1)
 */
export async function GET(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  const { data, error } = await supabase
    .from('tuition_teachers')
    .select('*')
    .order('order_index')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (hasFinanceSession(request)) return NextResponse.json(data)
  return NextResponse.json((data ?? []).map(stripFinanceFields))
}

export async function POST(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const body = await request.json()

  const validationError = validateInput([
    rules.requiredString('name', body.name),
  ])
  if (validationError) return validationError

  const { data, error } = await supabase
    .from('tuition_teachers')
    .insert({
      name: body.name,
      phone: body.phone || null,
      subject: body.subject || null,
      memo: body.memo || null,
      order_index: Math.floor(Date.now() / 1000) % 2000000000,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog('teacher', data.id, 'create',
    `선생님 등록: ${body.name}${body.subject ? ` (${body.subject})` : ''}`,
    { name: body.name, phone: body.phone, subject: body.subject })

  return NextResponse.json(data)
}
