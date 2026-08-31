-- 선생님별 배분 비율 컬럼 추가 (기본값 40%)
ALTER TABLE tuition_teachers
  ADD COLUMN IF NOT EXISTS pay_ratio INTEGER DEFAULT 40;
