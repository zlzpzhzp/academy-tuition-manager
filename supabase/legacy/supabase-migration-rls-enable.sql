-- 2026-04-23: 원비 RLS 긴급 봉합
-- 배경: NEXT_PUBLIC_SUPABASE_ANON_KEY(sb_publishable_*)가 브라우저에 노출되는데
--       RLS 비활성화 상태여서 키 탈취 시 전체 테이블 dump/delete 가능했음.
-- 조치: 1) 앱의 supabase.ts는 service_role로 전환됨 (서버 전용)
--       2) 모든 tuition_* 테이블에 RLS 활성화 → anon 키로는 아무것도 못 함
--       3) tuition_teachers의 "Allow all for anon" 정책 제거
-- 적용 방법: Supabase 대시보드 → SQL Editor에 통째로 붙여넣고 Run.

-- 1) 기존에 있던 anon 전체허용 정책 제거
DROP POLICY IF EXISTS "Allow all for anon" ON tuition_teachers;
DROP POLICY IF EXISTS "Allow all for anon" ON teacher_bonuses;
DROP POLICY IF EXISTS "Allow all for anon" ON academy_expenses;

-- 2) RLS 활성화 (service_role은 BYPASSRLS이므로 앱 기능 유지)
ALTER TABLE tuition_grades     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuition_classes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuition_students   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuition_payments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuition_teachers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_bonuses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_expenses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs         ENABLE ROW LEVEL SECURITY;

-- 3) 추가 존재할 수 있는 tuition_bill_queue / tuition_bill_history / tuition_monthly_memos도 가드
--    (마이그레이션 파일에 없어도 Supabase에 실존하므로 차단)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'tuition_bill_queue' AND schemaname = 'public') THEN
    EXECUTE 'ALTER TABLE public.tuition_bill_queue ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'tuition_bill_history' AND schemaname = 'public') THEN
    EXECUTE 'ALTER TABLE public.tuition_bill_history ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'tuition_monthly_memos' AND schemaname = 'public') THEN
    EXECUTE 'ALTER TABLE public.tuition_monthly_memos ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- 검증용: 적용 후 아래가 전부 t(true)여야 함
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' AND tablename LIKE 'tuition_%' OR tablename IN ('teacher_bonuses','academy_expenses','audit_logs')
-- ORDER BY tablename;
