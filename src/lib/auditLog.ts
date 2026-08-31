import { supabase } from './supabase'

type EntityType = 'payment' | 'student' | 'class' | 'grade' | 'teacher' | 'attendance' | 'notice'
type Action = 'create' | 'update' | 'delete' | 'upsert'

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
