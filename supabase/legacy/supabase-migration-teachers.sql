-- 선생님 테이블 생성
CREATE TABLE IF NOT EXISTS tuition_teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  subject TEXT,
  memo TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS 활성화
ALTER TABLE tuition_teachers ENABLE ROW LEVEL SECURITY;

-- ⚠️ SUPERSEDED by supabase-migration-rls-enable.sql (2026-07-26 감사에서 비활성화)
-- 아래 정책을 다시 실행하면 anon 키만으로 이 테이블이 전면 개방된다(급여배분율 포함).
-- 라이브 DB는 현재 service_role 전용 정책만 적용된 상태이며, 앱은 service_role로 접근하므로 이 정책이 필요 없다.
-- CREATE POLICY "Allow all for anon" ON tuition_teachers
--   FOR ALL USING (true) WITH CHECK (true);

-- 반 테이블에 선생님 FK 추가
ALTER TABLE tuition_classes
  ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES tuition_teachers(id) ON DELETE SET NULL;
