import { supabase } from './supabase'

type EntityType = 'payment' | 'student' | 'class' | 'grade' | 'teacher' | 'attendance' | 'notice'
type Action = 'create' | 'update' | 'delete' | 'upsert'

/**
 * ⚠️ 경고 로그 해소 마킹 (2026-09-01, 운영자님 "처리됐으면 안뜨게 해야되는거 아님?").
 * summary 원문은 불변(감사 취지) — details.resolved 만 세워 '경고만' 필터에서 빠지게 한다.
 * keyword(예: bill_id)가 summary에 포함된 미해소 ⚠️ 행 전부에 마킹. 결과 수를 돌려준다.
 */
export async function resolveAuditWarnings(keyword: string, reason: string): Promise<number> {
  try {
    const kw = keyword.trim()
    if (kw.length < 6) return 0 // 짧은 키워드 광역 오해소 방지
    const { data: rows, error } = await supabase
      .from('audit_logs')
      .select('id, details')
      .like('summary', '⚠️%')
      .ilike('summary', `%${kw}%`)
      .filter('details->>resolved', 'is', null)
    if (error || !rows?.length) return 0
    let n = 0
    for (const r of rows) {
      const details = { ...(r.details as Record<string, unknown> | null ?? {}), resolved: true, resolved_at: new Date().toISOString(), resolved_reason: reason }
      const { error: uErr } = await supabase.from('audit_logs').update({ details }).eq('id', r.id)
      if (!uErr) n++
    }
    return n
  } catch (e) {
    console.error('resolveAuditWarnings failed', e)
    return 0
  }
}

export async function writeAuditLog(
  entityType: EntityType,
  entityId: string | null,
  action: Action,
  summary: string,
  details?: Record<string, unknown>
) {
  try {
    // supabase insert는 DB 오류(제약/RLS)를 throw 하지 않고 { error }로 resolve 하므로
    // error 필드를 직접 검사해야 실패가 잡힘 (catch는 네트워크 예외만 커버).
    const { error } = await supabase.from('audit_logs').insert({
      entity_type: entityType,
      entity_id: entityId,
      action,
      summary,
      details: details ?? null,
    })
    if (error) console.error('Audit log write failed', error.message)
  } catch (e) {
    // 로그 실패가 메인 로직을 방해하면 안 됨
    console.error('Audit log write failed', e)
  }
}
