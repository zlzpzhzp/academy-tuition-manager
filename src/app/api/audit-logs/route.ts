import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'

export async function GET(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
  const offset = parseInt(searchParams.get('offset') || '0')
  // 2026-07-31 조용한실패 점검: 실패는 ⚠️ 감사로그로 잘 남는데, 그걸 보는 방법이 '최근 100건 나열'뿐이라
  // "수동 파기 필요" 같은 경고가 일상 로그에 묻혔다. 경고만 뽑는 경로를 연다.
  // warnOnly=1 → ⚠️ 로 시작하는 요약만. since=ISO → 그 시각 이후만(대시보드 배지용).
  const warnOnly = searchParams.get('warnOnly') === '1'
  const since = searchParams.get('since')

  // UI(settings)는 id, created_at, action, summary 만 사용. details(jsonb) + entity_type/entity_id 제거.
  // 2026-05-24 워라 /api/memos 패턴.
  let query = supabase
    .from('audit_logs')
    .select('id, action, summary, created_at')
    .order('created_at', { ascending: false })
  if (warnOnly) query = query.like('summary', '⚠️%')
  if (since) query = query.gt('created_at', since)

  const { data, error } = await query.range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
