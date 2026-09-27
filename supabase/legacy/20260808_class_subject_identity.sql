-- 반 신원 못 박기: subject NOT NULL + (grade_id, subject, name) 유니크
-- 작성·**적용 완료** 2026-08-08 (운영자가 직접 실행. 사전검증 둘 다 0행 확인 후 트랜잭션으로 적용,
-- information_schema 재조회로 is_nullable='NO' + 인덱스 생성 실측). 다시 실행할 필요 없다.
--
-- 왜 지금:
--   tuition_classes.name 은 'H','A' 같은 알파벳 한 글자라 과목 없이는 반이 특정되지 않는다
--   (실측: 중3H·중3A·고1H 가 수학·영어 양쪽에 존재 → 2026-08-08 타 봇이 "중복 학생" 오인 신고).
--   현재 24/24 행 모두 subject 채워짐(수학 20 / 영어 4, null 0) — 위반 0인 지금이 제약을 박는
--   가장 싼 시점이다. 앱 쪽도 같은 날 POST/PUT /api/classes 에서 subject 필수 검증을 넣었다.
--
-- 실행 전 사전 검증 (둘 다 0행이어야 아래 DDL이 성공한다):
--   ① NOT NULL 위반 후보:
--      SELECT id, name FROM tuition_classes WHERE subject IS NULL;
--   ② 유니크 위반 후보 (같은 학년·과목 안에서 반 이름 중복):
--      SELECT grade_id, subject, name, count(*)
--        FROM tuition_classes
--       GROUP BY grade_id, subject, name
--      HAVING count(*) > 1;

ALTER TABLE public.tuition_classes
  ALTER COLUMN subject SET NOT NULL;

-- 반 신원 = (grade_id, subject, name). 같은 과목·학년 안에서 반 이름 중복 금지.
CREATE UNIQUE INDEX IF NOT EXISTS tuition_classes_grade_subject_name_key
  ON public.tuition_classes (grade_id, subject, name);

-- 되돌리기(rollback):
--   ALTER TABLE public.tuition_classes ALTER COLUMN subject DROP NOT NULL;
--   DROP INDEX IF EXISTS tuition_classes_grade_subject_name_key;
