import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { processOverdueDestroys } from '@/lib/deferredDestroy'

// 대기 중인 결제선생 큐 엔트리(타임락 예약) 조회 — 월별 pending 상태만.
// 조회 겸 지연 파기(1시간 버퍼 지난 것) lazy 처리 — Hobby cron 일1회 보완.
export async function GET(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const month = request.nextUrl.searchParams.get('month')
  if (!month) return NextResponse.json({ error: 'month required' }, { status: 400 })

  // 본 응답 지연 없도록 파이어앤포겟
  void processOverdueDestroys().catch(e => console.error('[billing/queue] lazy destroy 실패:', e))

  const { data, error } = await supabase
    .from('tuition_bill_queue')
    .select('id, student_id, billing_month, send_type, scheduled_at, is_regular_tuition, created_at')
    .eq('billing_month', month)
    .eq('status', 'pending')
    .order('scheduled_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
