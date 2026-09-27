import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { resolveAuditWarnings } from '@/lib/auditLog'

// 경고 해소 마킹 — {keyword, reason}: summary에 keyword가 든 미해소 ⚠️ 전부 details.resolved 처리.
// 파기 동기화·자가치유가 자동 호출하고, 남는 건(수동 판단 종결분)은 이 경로로 정리한다 (2026-09-01).
export async function POST(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const body = await request.json().catch(() => null)
  const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : ''
  const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : '수동 해소'
  if (keyword.length < 6) {
    return NextResponse.json({ error: 'keyword는 6자 이상이어야 합니다 (광역 오해소 방지)' }, { status: 400 })
  }
  const resolved = await resolveAuditWarnings(keyword, reason)
  return NextResponse.json({ resolved })
}

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
  // 2026-05-24 자매 앱 /api/memos 패턴.
  let query = supabase
    .from('audit_logs')
    .select('id, action, summary, created_at')
    .order('created_at', { ascending: false })
  // 해소된 경고(details.resolved)는 '경고만'에서 제외 — 처리 끝난 경고가 영구히 떠서
  // 사용자가 반복 문의하던 것(2026-09-01 "처리됐으면 안뜨게 해야되는거 아님?"). 원문은 불변.
  if (warnOnly) query = query.like('summary', '⚠️%').filter('details->>resolved', 'is', null)
  if (since) query = query.gt('created_at', since)

  const { data, error } = await query.range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
