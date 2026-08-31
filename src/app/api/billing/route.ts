import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const month = request.nextUrl.searchParams.get('month')

  // 2026-05-24 13:55 — 9d75831 select 다이어트 롤백 (2차).
  // payments page 의 재발송 배지(bill.resend_count) + billing/payments 의 short_url
  // 이 UI 에서 직접 쓰여 배지가 사라졌었음. 다이어트 시도 시 모든 b.X/bill.X
  // consumer grep 전수 확인 후 진행.
  // 2026-07-07 사용자 지시: month 옵션화 — 없으면 전체 기간을 최신 변동순으로(연속 현황판).
  let query = supabase.from('tuition_bill_history').select('*')
  if (month) {
    query = query.eq('billing_month', month).order('sent_at', { ascending: false })
  } else {
    // 전체 최신 변동순 — 결제·발송·취소 등 상태변경이 최근인 것부터
    query = query.order('updated_at', { ascending: false }).limit(1000)
  }
  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
