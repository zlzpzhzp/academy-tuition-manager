import { NextRequest, NextResponse } from 'next/server'
import { destroyBill, fetchPaySsamStatus } from '@/lib/payssam'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { writeAuditLog } from '@/lib/auditLog'

export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  try {
    const { billId, amount } = await request.json()
    if (!billId || !amount) {
      return NextResponse.json({ error: '필수 정보가 누락되었습니다' }, { status: 400 })
    }

    // PaySsam 실제 상태 동기화 — 이미 파기됐는데 DB만 sent인 경우(drift) destroyBill이 실패하므로 선확인
    const realStatus = await fetchPaySsamStatus(billId)
    if (realStatus === 'destroyed') {
      await supabase
        .from('tuition_bill_history')
        .update({ status: 'destroyed', bill_note: '결제선생 파기 동기화', updated_at: new Date().toISOString() })
        .eq('bill_id', billId)
      return NextResponse.json({ code: '0000', msg: '이미 결제선생에서 파기된 청구서라 상태만 동기화했습니다.' })
    }
    if (realStatus === 'paid') {
      return NextResponse.json({ error: '결제 완료된 청구서는 파기할 수 없습니다. 결제 취소를 사용하세요.', code: 'PAID_ON_PAYSSAM' }, { status: 409 })
    }

    // 파기 금액도 DB 청구액과 대조 (reissue·cancel과 동일 가드, 2026-08-13 라인리뷰 P2).
    // bill_history에 없는 청구서(외부 수동 발송분)는 대조 불가 — 기존 동작대로 요청값 사용.
    const { data: billRow } = await supabase
      .from('tuition_bill_history')
      .select('student_id, amount')
      .eq('bill_id', billId)
      .maybeSingle()
    if (billRow && Number(amount) !== Number(billRow.amount)) {
      return NextResponse.json({
        error: `요청 금액(${Number(amount).toLocaleString()}원)이 청구액(${Number(billRow.amount).toLocaleString()}원)과 다릅니다.`,
        code: 'AMOUNT_MISMATCH',
      }, { status: 400 })
    }

    const result = await destroyBill(billId, amount)

    if (result.code === '0000') {
      const { error: updErr } = await supabase
        .from('tuition_bill_history')
        .update({ status: 'destroyed', updated_at: new Date().toISOString() })
        .eq('bill_id', billId)
      if (updErr) {
        console.error('[PaySsam destroy] 상태 전이 실패:', billId, updErr)
        await writeAuditLog('payment', billRow?.student_id ?? null, 'update',
          `⚠️ 청구서 파기됨 but DB 상태전이 실패: bill ${billId} — 화면에 발송됨으로 남아 재파기 시도/집계 오염 가능 (${updErr.message})`,
          { billId, error: updErr.message })
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[PaySsam] 청구서 파기 실패:', error)
    return NextResponse.json({ error: '청구서 파기 중 오류가 발생했습니다' }, { status: 500 })
  }
}
