import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession, hasFinanceSession, stripFinanceFields } from '@/lib/auth'
import { validateInput, rules } from '@/lib/validate'
import { queryGradesTree, mapGradesTree } from '@/lib/queries'
import { writeAuditLog } from '@/lib/auditLog'

export async function GET(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { data, error } = await queryGradesTree()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(mapGradesTree(data ?? [], hasFinanceSession(request) ? undefined : stripFinanceFields), {
    // 2026-05-19: 학생 등록/퇴원 시 즉시 반영되도록 no-store. SWR dedupingInterval 5초로 중복 차단.
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export async function POST(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const body = await request.json()

  const validationError = validateInput([rules.requiredString('name', body.name)])
  if (validationError) return validationError

  const { data, error } = await supabase
    .from('tuition_grades')
    .insert({ name: body.name, order_index: Math.floor(Date.now() / 1000) % 2000000000 })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog('grade', data.id, 'create', `학년 추가: ${body.name}`, { name: body.name })

  return NextResponse.json(data)
}
