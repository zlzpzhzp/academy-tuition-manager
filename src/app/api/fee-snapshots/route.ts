import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { writeAuditLog } from '@/lib/auditLog'

// 월별 요금 스냅샷 조회 — 표시 로직이 과거 달 완납/미납 판정에 사용.
// GET /api/fee-snapshots?months=2026-06,2026-07 (또는 student_id 단위 전체)
export async function GET(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { searchParams } = new URL(request.url)
  const months = (searchParams.get('months') || '').split(',').map(m => m.trim()).filter(Boolean)
  const studentId = searchParams.get('student_id')

  let query = supabase.from('tuition_fee_snapshot').select('student_id, month, fee')
  if (studentId) query = query.eq('student_id', studentId)
  if (months.length > 0) query = query.in('month', months)
  if (!studentId && months.length === 0) {
    return NextResponse.json({ error: 'months 또는 student_id 필요' }, { status: 400 })
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [], {
    headers: { 'Cache-Control': 'no-store' },
  })
}

// 스냅샷 정정 — 이월 상계·재정산으로 "그 달 확정 요금"이 표준 요금과 달라진 학생의 과거 달 기록을
// 사실에 맞게 고치는 관리자 경로 (2026-08-29, 손흥민 8월 상계 0원이 '지난달 미납'으로 오표시되던 건).
// 미납/완납 판정(feeForMonth)·agent 도구가 이 값을 정본으로 읽으므로, 정정은 감사로그 필수.
export async function PUT(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const body = await request.json().catch(() => null)
  const studentId = body?.student_id
  const month = body?.month
  const fee = body?.fee
  if (typeof studentId !== 'string' || !/^[0-9a-f-]{36}$/.test(studentId)) {
    return NextResponse.json({ error: 'student_id(uuid)가 필요합니다' }, { status: 400 })
  }
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month는 YYYY-MM 형식이어야 합니다' }, { status: 400 })
  }
  if (typeof fee !== 'number' || !Number.isInteger(fee) || fee < 0) {
    return NextResponse.json({ error: 'fee는 0 이상의 정수여야 합니다' }, { status: 400 })
  }
  const { data: student, error: sErr } = await supabase
    .from('tuition_students').select('name').eq('id', studentId).maybeSingle()
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다' }, { status: 404 })

  const { data: prev } = await supabase
    .from('tuition_fee_snapshot').select('fee').eq('student_id', studentId).eq('month', month).maybeSingle()
  const { error } = await supabase
    .from('tuition_fee_snapshot')
    .upsert({ student_id: studentId, month, fee }, { onConflict: 'student_id,month' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog('payment', studentId, 'update',
    `요금 스냅샷 정정: ${student.name} ${month} ${prev ? `${Number(prev.fee).toLocaleString()}원` : '(없음)'} → ${fee.toLocaleString()}원`,
    { month, fee, prevFee: prev?.fee ?? null })
  return NextResponse.json({ success: true, student_id: studentId, month, fee, prevFee: prev?.fee ?? null })
}
