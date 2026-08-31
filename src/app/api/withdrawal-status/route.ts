import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { writeAuditLog } from '@/lib/auditLog'
import { TERMINAL_STATUSES, IN_PROGRESS_STATUSES } from '@/lib/withdrawalStatuses'

// 퇴원생 월별 처리 상태 (이번달까지 정리 / 계좌환불 완료 등) — 학생 단위 memo 대신 월별 독립 저장
export async function GET(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('billing_month')
  let q = supabase.from('tuition_withdrawal_status').select('student_id, billing_month, status')
  if (month) q = q.eq('billing_month', month)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// 상태 상수는 @/lib/withdrawalStatuses 정본 — 화면(attendance)도 같은 모듈을 읽는다

export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { student_id, billing_month, status, force } = await request.json()
  if (!student_id || !billing_month) {
    return NextResponse.json({ error: 'student_id, billing_month가 필요합니다' }, { status: 400 })
  }
  // status 화이트리스트 — 오타·임의 문자열이 저장되는 순간 종결/진행중 가드와 화면 분류가
  // 전부 빗나간다 (2026-08-13 라인리뷰). 해제(null/빈값)는 아래에서 별도 처리.
  if (status && !TERMINAL_STATUSES.includes(status) && !IN_PROGRESS_STATUSES.includes(status)) {
    return NextResponse.json({
      error: `status는 ${[...TERMINAL_STATUSES, ...IN_PROGRESS_STATUSES].join('/')} 중 하나여야 합니다 (받은 값: ${status})`,
    }, { status: 400 })
  }

  // 역행 차단: 종결 상태 → 진행중 상태 로의 하향 전이는 명시적 force 없이는 거부.
  // (해제(status 없음)와 종결→종결 변경은 관리자 정정이므로 허용)
  if (status && IN_PROGRESS_STATUSES.includes(status)) {
    const { data: cur, error: curErr } = await supabase
      .from('tuition_withdrawal_status')
      .select('status')
      .eq('student_id', student_id)
      .eq('billing_month', billing_month)
      .maybeSingle()
    // 조회 실패를 안 보면 cur=null → 종결 건이 force 없이 진행중으로 upsert 된다(가드 fail-open).
    // 가드는 막는 쪽이 안전 — 실패면 저장하지 않고 500 (send 라우트 GUARD_QUERY_FAILED 와 같은 규약).
    if (curErr) {
      console.error('[withdrawal-status] 현재 상태 조회 실패 — 역행 차단 판정 불가로 저장 중단:', curErr)
      return NextResponse.json({
        error: '현재 처리상태 조회에 실패해 저장을 중단했습니다 (역행 차단 판정 불가). 잠시 후 다시 시도하세요.',
        code: 'GUARD_QUERY_FAILED',
        detail: curErr.message,
      }, { status: 500 })
    }
    if (cur && TERMINAL_STATUSES.includes(cur.status)) {
      if (!force) {
        return NextResponse.json({
          error: `이미 처리완료된 건(${cur.status})을 '진행중'으로 되돌릴 수 없습니다. 실제로 되돌려야 하면 force:true로 요청하세요.`,
          code: 'TERMINAL_STATUS_DOWNGRADE_BLOCKED',
          current: cur.status,
        }, { status: 409 })
      }
      // force로 가드를 뚫는 경우 = 정산/환불 종결 상태를 사람이 의도적으로 되돌리는 것.
      // 돈 관련 상태를 되돌리면서 흔적이 없으면 사고 시 '누가·언제·무엇을' 추적 불가 →
      // 감사로그 필수. (2026-07-20 Gemini 일일비판 지적, 원장 승인)
      // entity_type은 기존 6종 유니온 유지: 퇴원 정산/환불 상태라 재무 성격 → 'payment'
      // (콜백의 환불 로그들과 동일 분류. 새 타입 추가는 UI가 entity_type을 안 쓰므로 실익 없음)
      await writeAuditLog('payment', student_id, 'update',
        `⚠️ 퇴원 처리상태 강제 되돌림(force): ${billing_month} ${cur.status} → ${status}. 정산/환불 종결 상태를 진행중으로 되돌림 — 실제 환불·청구 상태와 어긋나지 않는지 확인 필요.`,
        { billing_month, from: cur.status, to: status, forced: true })
    }
  }

  // status가 null/빈값이면 해당 월 마킹 해제
  if (!status) {
    const { error } = await supabase
      .from('tuition_withdrawal_status')
      .delete()
      .eq('student_id', student_id)
      .eq('billing_month', billing_month)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, cleared: true })
  }
  const { error } = await supabase
    .from('tuition_withdrawal_status')
    .upsert(
      { student_id, billing_month, status, updated_at: new Date().toISOString() },
      { onConflict: 'student_id,billing_month' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, status })
}
