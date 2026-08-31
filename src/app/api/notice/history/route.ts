import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'

// 공지 문자 발송 내역 — audit_logs(entity_type='notice') 조회
export async function GET(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, summary, details, created_at')
    .eq('entity_type', 'notice')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, logs: data ?? [] })
}
