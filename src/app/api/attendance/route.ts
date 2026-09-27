import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { validateInput, rules } from '@/lib/validate'
import { writeAuditLog } from '@/lib/auditLog'

const STATUSES = ['present', 'absent', 'late', 'early_leave', 'makeup'] as const

export async function GET(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const studentId = searchParams.get('student_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let query = supabase.from('tuition_attendance').select('*').order('date', { ascending: false })
  if (date) query = query.eq('date', date)
  if (studentId) query = query.eq('student_id', studentId)
  if (from) query = query.gte('date', from)
  if (to) query = query.lte('date', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  const body = await request.json()

  const entries = Array.isArray(body?.entries) ? body.entries : null
  if (!entries || entries.length === 0) {
    return NextResponse.json({ error: 'entries 배열이 필요합니다' }, { status: 400 })
  }

  for (const e of entries) {
    const v = validateInput([
      rules.required('student_id', e.student_id),
      rules.validDate('date', e.date),
      rules.oneOf('status', e.status, [...STATUSES]),
    ])
    if (v) return v
  }

  // note는 보낸 entry에만 싣는다 — 항상 null로 채우면 화면에서 상태 버튼을 누를 때마다
  // (프론트는 status만 보냄) 기존 출결 메모가 조용히 지워진다 (2026-08-13 라인리뷰 P2).
  // PostgREST upsert는 payload에 있는 컬럼만 UPDATE 하므로, note 유무로 나눠 두 번 올린다.
  type Entry = { student_id: string; date: string; status: string; note?: string | null }
  const withNote = (entries as Entry[]).filter(e => e.note !== undefined)
    .map(e => ({ student_id: e.student_id, date: e.date, status: e.status, note: e.note ?? null }))
  const withoutNote = (entries as Entry[]).filter(e => e.note === undefined)
    .map(e => ({ student_id: e.student_id, date: e.date, status: e.status }))

  const data: unknown[] = []
  for (const payload of [withNote, withoutNote]) {
    if (payload.length === 0) continue
    const { data: rows, error } = await supabase
      .from('tuition_attendance')
      .upsert(payload, { onConflict: 'student_id,date' })
      .select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    data.push(...(rows ?? []))
  }
  const payload = [...withNote, ...withoutNote]

  // entity_id 는 uuid 가 아니라 text 다(라이브 실측 2026-08-31 — 'bulk-날짜' 로그 3건 실존).
  // OSS 판 스키마 역산이 uuid 로 잘못 추정해 '원본 버그'로 보고했던 이력 있음 — 원본은 정상.
  await writeAuditLog(
    'attendance',
    `bulk-${payload[0].date}`,
    'upsert',
    `출결 일괄 저장: ${payload[0].date} ${payload.length}건`,
    { count: payload.length, date: payload[0].date },
  )

  return NextResponse.json(data)
}

export async function DELETE(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })

  const { error } = await supabase.from('tuition_attendance').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog('attendance', id, 'delete', `출결 삭제: ${id}`, { id })
  return NextResponse.json({ ok: true })
}
