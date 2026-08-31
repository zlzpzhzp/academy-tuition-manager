import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { writeAuditLog } from '@/lib/auditLog'

/**
 * 명단그룹 특강(tuition_special_group) 멤버 제외.
 *
 * 2026-07-26 운영자님 지시: "정규반에서 퇴원생은 명단그룹에서도 제외해야지, 특강만 듣는 건 없어."
 * 그때까지 그룹 멤버는 DB로 직접 등록·삭제할 수밖에 없었다(화면·API 모두 없음).
 *
 * ⚠️ 순서 불변식: **미결제 청구서 파기가 먼저, 명단 제외는 그 다음.**
 * 명단에서만 빼면 화면에서 사라지는데 결제선생 링크는 살아 있어서 학부모가 그대로 결제해버린다
 * (2026-07-21 차은우 실증). 그래서 살아있는 청구서(status='sent')가 있으면 여기서 막고,
 * 파기부터 하도록 409로 돌려보낸다.
 */
export async function DELETE(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  const body = await request.json().catch(() => ({}))
  const groupId = typeof body?.groupId === 'string' ? body.groupId : null
  const studentId = typeof body?.studentId === 'string' ? body.studentId : null
  if (!groupId || !studentId) {
    return NextResponse.json({ error: 'groupId, studentId 필요' }, { status: 400 })
  }

  const { data: group, error: groupErr } = await supabase
    .from('tuition_special_group')
    .select('id, name, bill_note')
    .eq('id', groupId)
    .single()
  if (groupErr || !group) {
    return NextResponse.json({ error: '그룹을 찾을 수 없습니다' }, { status: 404 })
  }

  const { data: student } = await supabase
    .from('tuition_students')
    .select('name')
    .eq('id', studentId)
    .single()

  // 살아있는 청구서가 있으면 명단부터 빼지 못하게 막는다 (위 불변식)
  const { data: liveBills, error: billErr } = await supabase
    .from('tuition_bill_history')
    .select('bill_id, amount')
    .eq('student_id', studentId)
    .eq('bill_note', group.bill_note)
    .eq('status', 'sent')
  if (billErr) return NextResponse.json({ error: billErr.message }, { status: 500 })
  if (liveBills && liveBills.length > 0) {
    return NextResponse.json({
      error: '미결제 청구서가 살아있습니다. 청구서를 먼저 파기한 뒤 명단에서 빼세요.',
      liveBills: liveBills.map(b => ({ billId: b.bill_id, amount: b.amount })),
    }, { status: 409 })
  }

  const { error: delErr, count } = await supabase
    .from('tuition_special_group_member')
    .delete({ count: 'exact' })
    .eq('group_id', groupId)
    .eq('student_id', studentId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  if (!count) {
    return NextResponse.json({ error: '해당 학생이 이 그룹 명단에 없습니다' }, { status: 404 })
  }

  await writeAuditLog('student', studentId, 'update',
    `특강 명단 제외: ${student?.name ?? studentId} — ${group.name}`,
    { groupId, groupName: group.name, billNote: group.bill_note })

  return NextResponse.json({ ok: true, removed: { groupId, studentId } })
}
