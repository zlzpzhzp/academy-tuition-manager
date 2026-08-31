import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'

export const SPECIAL_LABEL = '여름방학 특강'

/**
 * 특강 데이터 — 반별 특강비(tuition_special_class) + 특강 청구 납부상태(bill_history).
 * 특강 청구는 정규와 별개: bill_note=SPECIAL_LABEL, is_regular_tuition=false 로 발송됨.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  const { data: special, error: e1 } = await supabase
    .from('tuition_special_class')
    .select('class_id, label, fee, hours_note, teacher_note, period_start, period_end, due_date')
    .eq('label', SPECIAL_LABEL)
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  // 특강 청구 이력 (student별) — bill_note 기준
  const { data: bills, error: e2 } = await supabase
    .from('tuition_bill_history')
    .select('student_id, bill_id, amount, status, short_url, sent_at')
    .eq('bill_note', SPECIAL_LABEL)
    .order('sent_at', { ascending: false })
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

  // 특강비 직접 납부 기록 (현장 카드/현금 등)
  const { data: payments, error: e3 } = await supabase
    .from('tuition_special_payment')
    .select('id, student_id, amount, method, paid_at, receipt_images')
    .eq('label', SPECIAL_LABEL)
    .is('deleted_at', null)
  if (e3) return NextResponse.json({ error: e3.message }, { status: 500 })

  // 명단 기반 특강 그룹 (정규반 1:1이 아닌 임의 명단 — 영어 특강 등)
  const { data: groupRows, error: e4 } = await supabase
    .from('tuition_special_group')
    .select('id, label, name, subject, fee, schedule_note, bill_note, product_name, order_index, period_start, period_end, due_date')
    .order('order_index', { ascending: true })
  if (e4) return NextResponse.json({ error: e4.message }, { status: 500 })

  const groupIds = (groupRows ?? []).map(g => g.id)
  const billNotes = (groupRows ?? []).map(g => g.bill_note)

  // 그룹 멤버 + 학생 정보 (billingPhone 계산에 필요한 필드 포함)
  let members: Array<{ group_id: string; order_index: number; student: unknown }> = []
  if (groupIds.length > 0) {
    const { data: memberRows, error: e5 } = await supabase
      .from('tuition_special_group_member')
      .select('group_id, order_index, student:tuition_students(id, name, phone, parent_phone, parent_father_phone, payssam_recipient, withdrawal_date, batch_exclude_month)')
      .in('group_id', groupIds)
      .order('order_index', { ascending: true })
    if (e5) return NextResponse.json({ error: e5.message }, { status: 500 })
    members = (memberRows ?? []) as typeof members
  }

  // 그룹 청구 이력 (bill_note 기준) + 그룹 직접납부 (label = bill_note)
  let groupBills: unknown[] = []
  let groupPayments: unknown[] = []
  if (billNotes.length > 0) {
    // 2026-07-31 조용한실패 점검: 이 둘만 error를 안 봤다(e1~e5는 500으로 fail-close).
    // 조회 실패가 빈 배열로 흘러가면 화면에 '청구 안 됨/미납'으로 보여, 이미 보낸 청구서를 또 보내거나
    // 낸 학생을 미납으로 취급하게 된다. 같은 라우트의 다른 조회와 동일하게 500으로 끊는다.
    const { data: gb, error: e6 } = await supabase
      .from('tuition_bill_history')
      .select('student_id, bill_id, amount, status, short_url, sent_at, bill_note')
      .in('bill_note', billNotes)
      .order('sent_at', { ascending: false })
    if (e6) return NextResponse.json({ error: e6.message }, { status: 500 })
    groupBills = gb ?? []
    const { data: gp, error: e7 } = await supabase
      .from('tuition_special_payment')
      .select('id, student_id, amount, method, paid_at, receipt_images, label')
      .in('label', billNotes)
      .is('deleted_at', null)
    if (e7) return NextResponse.json({ error: e7.message }, { status: 500 })
    groupPayments = gp ?? []
  }

  // 그룹별 멤버 명단 구성
  const groups = (groupRows ?? []).map(g => ({
    ...g,
    students: members
      .filter(m => m.group_id === g.id)
      .map(m => m.student)
      .filter(Boolean),
  }))

  return NextResponse.json({
    special: special ?? [],
    bills: bills ?? [],
    payments: payments ?? [],
    groups,
    groupBills,
    groupPayments,
  })
}
