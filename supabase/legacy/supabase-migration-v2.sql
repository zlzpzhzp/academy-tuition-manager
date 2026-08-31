-- Migration v2: method CHECK 확장 + 학생 필드 추가

-- 1. payments method CHECK 제약조건 업데이트 (remote, other 추가)
ALTER TABLE tuition_payments DROP CONSTRAINT IF EXISTS tuition_payments_method_check;
ALTER TABLE tuition_payments ADD CONSTRAINT tuition_payments_method_check
  CHECK (method IN ('cash', 'card', 'transfer', 'remote', 'other'));

-- 2. 기존 [기타:] 태그 데이터 → method='other'로 마이그레이션
UPDATE tuition_payments SET method = 'other' WHERE memo LIKE '[기타:%]%';

-- 3. 학생 테이블에 결제일/상담필요 컬럼 추가
ALTER TABLE tuition_students ADD COLUMN IF NOT EXISTS payment_due_day integer;
ALTER TABLE tuition_students ADD COLUMN IF NOT EXISTS has_discuss boolean DEFAULT false;
