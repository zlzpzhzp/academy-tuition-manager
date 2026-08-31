-- 학원 지출 항목 테이블
CREATE TABLE IF NOT EXISTS academy_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_month TEXT NOT NULL,          -- YYYY-MM
  category TEXT NOT NULL,               -- 'fixed' 또는 'variable'
  name TEXT NOT NULL,                   -- 항목명 (임대료, 관리비, 비품 등)
  amount INTEGER NOT NULL DEFAULT 0,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE academy_expenses ENABLE ROW LEVEL SECURITY;
-- ⚠️ SUPERSEDED by supabase-migration-rls-enable.sql (2026-07-26 감사에서 비활성화)
-- 재실행 시 학원 지출 데이터가 anon 키로 전면 개방된다. 라이브는 service_role 전용 정책만 적용됨.
-- CREATE POLICY "Allow all for anon" ON academy_expenses
--   FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_academy_expenses_month
  ON academy_expenses(billing_month);
