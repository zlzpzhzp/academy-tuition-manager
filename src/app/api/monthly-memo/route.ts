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

  const { month, content, baseUpdatedAt } = await request.json()
  if (!MONTH_RE.test(month ?? '')) {
    return NextResponse.json({ error: 'month 파라미터는 YYYY-MM 형식이어야 합니다' }, { status: 400 })
  }
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'content는 문자열이어야 합니다' }, { status: 400 })
  }

  // 같은 밀리초에 저장해도 버전이 재사용되지 않게 한다(동시 PUT의 stale 판정).
  const baseMs = typeof baseUpdatedAt === 'string' ? Date.parse(baseUpdatedAt) : NaN
  const updatedAt = new Date(Number.isFinite(baseMs) ? Math.max(Date.now(), baseMs + 1) : Date.now()).toISOString()
  if (baseUpdatedAt != null) {
    const { data, error } = await supabase
      .from('tuition_monthly_memos')
      .update({ content, updated_at: updatedAt })
      .eq('billing_month', month)
      .eq('updated_at', baseUpdatedAt)
      .select('updated_at')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.length) {
      const { data: current, error: readError } = await supabase
        .from('tuition_monthly_memos')
        .select('content, updated_at')
        .eq('billing_month', month)
        .maybeSingle()
      if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
      return NextResponse.json({ code: 'MEMO_CONFLICT', content: current?.content ?? '', updated_at: current?.updated_at ?? null }, { status: 409 })
    }
    return NextResponse.json({ ok: true, updated_at: data[0].updated_at })
  }

  const { data, error } = await supabase
    .from('tuition_monthly_memos')
    .insert({ billing_month: month, content, updated_at: updatedAt })
    .select('updated_at')
    .single()

  if (error) {
    // 동시 첫 저장도 월 PK로 경합한다. 기존 내용을 덮지 않고 같은 충돌 응답을 반환한다.
    if (error.code === '23505') {
      const { data: current, error: readError } = await supabase
        .from('tuition_monthly_memos')
        .select('content, updated_at')
        .eq('billing_month', month)
        .maybeSingle()
      if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
      return NextResponse.json({ code: 'MEMO_CONFLICT', content: current?.content ?? '', updated_at: current?.updated_at ?? null }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, updated_at: data.updated_at })
}
