-- 감사 로그 테이블
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,       -- 'payment', 'student', 'class', 'grade'
  entity_id uuid,
  action text NOT NULL,            -- 'create', 'update', 'delete'
  summary text NOT NULL,           -- 사람이 읽을 수 있는 요약
  details jsonb,                   -- 변경 상세 데이터
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- ⚠️ SUPERSEDED by supabase-migration-rls-enable.sql (2026-07-26 감사에서 비활성화)
-- RLS를 끄면 anon 키로 감사로그 전체가 열람·조작 가능해진다(감사추적 무력화).
-- 라이브 DB는 현재 RLS ON + service_role 전용 정책 상태이며 앱은 service_role로 접근한다.
-- ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
