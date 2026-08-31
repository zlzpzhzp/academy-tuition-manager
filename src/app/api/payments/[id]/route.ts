import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { validateInput, rules } from '@/lib/validate'
import { writeAuditLog } from '@/lib/auditLog'
import { requireAdminSession } from '@/lib/auth'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params
  const body = await request.json()

  const validMethods = ['card', 'transfer', 'cash', 'payssam', 'remote', 'pay', 'other']
  const validationError = validateInput([
    rules.nonNegativeNumber('amount', body.amount),
    rules.optionalDate('payment_date', body.payment_date),
    ...(body.method !== undefined ? [rules.oneOf('method', body.method, validMethods)] : []),
  ])
  if (validationError) return validationError

  // 2026-07-02 정합성 가드: 삭제된 row 부활 편집 금지 + payssam 결제수단 전환 금지
  // (payssam→card로 바꾸면 청구서와 어긋나고 payssam 삭제금지 정책도 우회됨. 역방향은 콜백 전용 기록 위조)
  const { data: current } = await supabase
    .from('tuition_payments')
    .select('method, deleted_at')
    .eq('id', id)
    .single()
  if (!current) return NextResponse.json({ error: '납부 기록을 찾을 수 없습니다' }, { status: 404 })
  if (current.deleted_at) {
    return NextResponse.json({ error: '삭제된 납부 기록은 수정할 수 없습니다' }, { status: 400 })
  }
  if (body.method !== undefined && body.method !== current.method && (current.method === 'payssam' || body.method === 'payssam')) {
    return NextResponse.json({ error: '결제선생 결제 건의 결제수단은 변경할 수 없습니다' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (body.amount !== undefined) updates.amount = body.amount
  if (body.method !== undefined) updates.method = body.method
  if (body.payment_date !== undefined) updates.payment_date = body.payment_date
  if (body.memo !== undefined) updates.memo = body.memo || null

  const { data, error } = await supabase
    .from('tuition_payments')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const fields = Object.keys(updates).join(', ')
  await writeAuditLog('payment', id, 'update', `납부 수정: ${fields}`, updates)

  return NextResponse.json(data)
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params

  // 삭제 전 데이터 조회
  const { data: existing } = await supabase
    .from('tuition_payments')
    .select('*, student:tuition_students(name)')
    .eq('id', id)
    .single()

  // 2026-07-02 사용자 지시: 결제선생 자동수납 건은 개별 삭제 금지.
  // 결제선생 결제는 청구서 취소(환불) 플로우(/api/payssam/cancel·resettle)에서만 soft-delete된다.
  if (existing?.method === 'payssam') {
    return NextResponse.json(
      { error: '결제선생 결제 건은 삭제할 수 없습니다. 청구서 결제 취소(환불)로 처리하세요.' },
      { status: 400 },
    )
  }

  // 2026-05-22 사용자 지시: 결제 row 영구 보존. DELETE 금지 → deleted_at soft-delete.
  // 모든 SELECT가 WHERE deleted_at IS NULL 필터링하므로 UI에서는 삭제된 것처럼 보임.
  const { error } = await supabase
    .from('tuition_payments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 아직 실행되지 않은 파기 예약 취소 (1시간 버퍼 안에서 삭제하면 청구서 복구)
  // 해제 실패를 무검사로 넘기면 예약이 살아남아 1시간 뒤 deferredDestroy가 멀쩡한 청구서를 파기한다
  // (대상 status가 'sent' 그대로라 그쪽 가드도 못 막음) → 미청구. 특강 경로와 동일하게 500으로 표면화. (2026-07-26 감사)
  const { error: queueError } = await supabase
    .from('tuition_bill_queue')
    .update({ status: 'cancelled', error_msg: '납부 취소로 파기 예약 해제', sent_at: new Date().toISOString() })
    .eq('send_type', 'destroy')
    .eq('status', 'pending')
    .filter('payload->>paymentId', 'eq', id)
  if (queueError) {
    console.error('[payments DELETE] 파기 예약 해제 실패:', id, queueError)
    await writeAuditLog('payment', id, 'update',
      `⚠️ 납부 삭제됨 but 청구서 파기 예약 해제 실패: payment ${id} — 1시간 뒤 살아있는 청구서가 자동 파기될 수 있음, 수동 확인 필요`,
      { paymentId: id, error: queueError.message })
    return NextResponse.json(
      { error: '납부는 삭제됐으나 파기 예약 해제에 실패했습니다. 청구서 파기 예약을 수동 확인하세요.' },
      { status: 500 },
    )
  }

  if (existing) {
    const existingWithStudent = existing as { student?: { name?: string } | null; billing_month?: string; amount?: number } | null
    const studentName = existingWithStudent?.student?.name ?? ''
    await writeAuditLog('payment', id, 'delete',
      `납부 삭제: ${studentName} ${existing.billing_month} ${existing.amount?.toLocaleString()}원`,
      existing)
  }

  return NextResponse.json({ success: true })
}
