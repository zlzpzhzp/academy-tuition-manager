import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'

const MONTH_RE = /^\d{4}-\d{2}$/

export async function GET(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  const month = request.nextUrl.searchParams.get('month') ?? ''
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: 'month 파라미터는 YYYY-MM 형식이어야 합니다' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('tuition_monthly_memos')
    .select('content, updated_at')
    .eq('billing_month', month)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ content: data?.content ?? '', updated_at: data?.updated_at ?? null })
}

export async function PUT(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  const { month, content } = await request.json()
  if (!MONTH_RE.test(month ?? '')) {
    return NextResponse.json({ error: 'month 파라미터는 YYYY-MM 형식이어야 합니다' }, { status: 400 })
  }
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'content는 문자열이어야 합니다' }, { status: 400 })
  }

  const { error } = await supabase
    .from('tuition_monthly_memos')
    .upsert({ billing_month: month, content, updated_at: new Date().toISOString() })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
