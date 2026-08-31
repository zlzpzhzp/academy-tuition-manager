-- Migration: discuss 라벨과 결제일 오버라이드를 localStorage에서 DB로 이관
-- 이 마이그레이션은 향후 multi-device 지원을 위해 준비된 것입니다.

-- 학생별 상담(DISCUSS) 플래그
ALTER TABLE tuition_students ADD COLUMN IF NOT EXISTS has_discuss boolean DEFAULT false;

-- 학생별 결제일 오버라이드 (NULL이면 enrollment_date 기준)
ALTER TABLE tuition_students ADD COLUMN IF NOT EXISTS due_day int;

-- due_day 유효성 검사 (1~31)
ALTER TABLE tuition_students ADD CONSTRAINT check_due_day CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31));

-- tuition_payments에 'remote' 추가 (기존 CHECK constraint 변경)
-- 참고: 기존 constraint가 있으면 먼저 삭제 후 재생성
ALTER TABLE tuition_payments DROP CONSTRAINT IF EXISTS tuition_payments_method_check;
ALTER TABLE tuition_payments ADD CONSTRAINT tuition_payments_method_check
  CHECK (method IN ('cash', 'card', 'transfer', 'remote'));

-- cash_receipt 컬럼 추가 (아직 없는 경우)
ALTER TABLE tuition_payments ADD COLUMN IF NOT EXISTS cash_receipt text;
ALTER TABLE tuition_payments ADD CONSTRAINT check_cash_receipt
  CHECK (cash_receipt IS NULL OR cash_receipt IN ('issued', 'pending'));

-- subject, class_days 컬럼 추가 (아직 없는 경우)
ALTER TABLE tuition_classes ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE tuition_classes ADD COLUMN IF NOT EXISTS class_days text;
