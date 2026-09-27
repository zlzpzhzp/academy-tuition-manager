-- 등하원 알림 추가 수신 번호(2026-09-16). 앱 배포 전에 실행한다.
-- 기존 테이블의 nullable 컬럼 추가만 수행하며 RLS·정책·GRANT는 변경하지 않는다.
-- (새로 설치한다면 supabase/schema.sql 에 이미 들어 있으니 따로 돌릴 필요 없다.)
ALTER TABLE public.tuition_students
  ADD COLUMN IF NOT EXISTS attendance_extra_phone text DEFAULT NULL;
