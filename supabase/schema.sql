-- =====================================================================
--  tuition-manager — 전체 스키마 (PostgreSQL / Supabase)
-- =====================================================================
--
--  이 파일은 무엇인가
--  ------------------
--  학원 원비(수업료) 관리 앱이 소유하는 **모든 테이블**의 DDL 정본이다.
--  저장소 루트에 흩어져 있던 부분 마이그레이션(supabase-schema.sql,
--  supabase-migration-*.sql, supabase/migrations/*.sql)을 한 파일로 합치고,
--  마이그레이션 파일이 없는 나머지 테이블은 애플리케이션 코드(src/)의
--  supabase.from('...').select/insert/update 사용처에서 역산해 복원했다.
--
--  코드에서 추론한 자리에는 `-- (추론)` 주석을 달아 두었다. 실제 운영 DB와
--  타입/NULL 허용이 다를 수 있으니, 기존 DB에 적용할 때는 먼저 읽어볼 것.
--
--  실행 방법
--  ---------
--    1. Supabase 대시보드 → 좌측 메뉴 SQL Editor → New query
--    2. 이 파일 전체를 복사해 붙여넣기
--    3. Run (Ctrl/Cmd + Enter)
--
--    또는 psql:
--      psql "postgresql://postgres:<PW>@<HOST>:5432/postgres" -f supabase/schema.sql
--
--  멱등성 (여러 번 실행해도 안전)
--  -----------------------------
--  모든 문장이 CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
--  ALTER TABLE ... ADD COLUMN IF NOT EXISTS / DO $$ 가드로 감싸져 있다.
--  재실행해도 오류가 나지 않으며, 기존 데이터는 건드리지 않는다.
--  (제약조건 추가는 pg_constraint 를 먼저 조회해 없을 때만 만든다.)
--
--  용어
--  ----
--    billing_month  : 청구 대상 월. 'YYYY-MM' 형식의 text (date 아님)
--    원비/수업료     : monthly tuition fee
--    결제선생(PaySsam): 외부 청구서 결제 서비스. 청구서 = bill
--
-- =====================================================================


-- =====================================================================
--  0. 확장 (gen_random_uuid)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =====================================================================
--  1. tuition_grades — 학년
--     예: 중1, 중2, 고1, 예비중1
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_grades (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  -- order_index: 화면 정렬 순서. 작을수록 위. 학년 순서를 사람이 정한다.
  order_index integer DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tuition_grades_order
  ON public.tuition_grades (order_index);


-- =====================================================================
--  2. tuition_teachers — 선생님(강사)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_teachers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  phone       text,
  subject     text,                    -- 담당 과목 (수학 / 영어 ...)
  memo        text,
  -- pay_ratio: 급여 배분 비율(%). 담당 반 수업료 합계 × pay_ratio/100 = 강사 급여.
  --            기본 40(%). 재무(finance) 화면 계산에만 쓰인다.
  pay_ratio   integer DEFAULT 40,
  order_index integer DEFAULT 0,       -- 화면 정렬 순서
  created_at  timestamptz DEFAULT now()
);

-- 기존 설치본 호환 (teachers 테이블이 먼저 만들어졌던 경우)
ALTER TABLE public.tuition_teachers ADD COLUMN IF NOT EXISTS pay_ratio integer DEFAULT 40;

CREATE INDEX IF NOT EXISTS idx_tuition_teachers_order
  ON public.tuition_teachers (order_index);


-- =====================================================================
--  3. tuition_classes — 반
--     반 이름(name)은 'H', 'A', 'S' 같은 한 글자라 과목 없이는 특정되지 않는다.
--     반의 신원 = (grade_id, subject, name)  ← 유니크
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_classes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_id    uuid REFERENCES public.tuition_grades(id) ON DELETE CASCADE,
  name        text NOT NULL,           -- 반 이름. 'H'(상위) / 'A' / 'S' 등 한 글자인 경우가 많다
  -- subject: 과목. 같은 학년에 수학 H반과 영어 H반이 동시에 존재하므로 반 신원의 일부다.
  --          2026-08-08 마이그레이션에서 NOT NULL 로 못 박았다.
  subject     text NOT NULL,
  -- monthly_fee: 이 반의 월 수업료(원). 학생별 예외는 tuition_students.custom_fee 로 덮는다.
  monthly_fee integer DEFAULT 0,
  -- class_days: 수업 요일을 JS getDay() 숫자로 나열한 CSV. 예: '1,3,5' = 월·수·금 (0=일요일).
  --             중도 퇴원 환불액을 '남은 수업 횟수' 기준으로 계산할 때 쓴다.
  class_days  text,
  teacher_id  uuid REFERENCES public.tuition_teachers(id) ON DELETE SET NULL,
  order_index integer DEFAULT 0,       -- 같은 학년 안에서의 화면 정렬 순서
  created_at  timestamptz DEFAULT now()
);

-- 기존 설치본 호환 (초기 스키마엔 subject/class_days/teacher_id 가 없었다)
ALTER TABLE public.tuition_classes ADD COLUMN IF NOT EXISTS subject    text;
ALTER TABLE public.tuition_classes ADD COLUMN IF NOT EXISTS class_days text;
ALTER TABLE public.tuition_classes
  ADD COLUMN IF NOT EXISTS teacher_id uuid REFERENCES public.tuition_teachers(id) ON DELETE SET NULL;

-- subject NOT NULL 승격 — 위반 행이 없을 때만. (있으면 조용히 건너뛰고 경고를 남긴다)
DO $$
DECLARE
  nulls bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tuition_classes'
       AND column_name = 'subject' AND is_nullable = 'YES'
  ) THEN
    SELECT count(*) INTO nulls FROM public.tuition_classes WHERE subject IS NULL;
    IF nulls = 0 THEN
      ALTER TABLE public.tuition_classes ALTER COLUMN subject SET NOT NULL;
    ELSE
      RAISE WARNING 'tuition_classes.subject 에 NULL 이 %건 있어 NOT NULL 승격을 건너뜁니다. 값을 채운 뒤 다시 실행하세요.', nulls;
    END IF;
  END IF;
END $$;

-- 반 신원: 같은 학년·같은 과목 안에서 반 이름 중복 금지
CREATE UNIQUE INDEX IF NOT EXISTS tuition_classes_grade_subject_name_key
  ON public.tuition_classes (grade_id, subject, name);

CREATE INDEX IF NOT EXISTS idx_tuition_classes_grade   ON public.tuition_classes (grade_id);
CREATE INDEX IF NOT EXISTS idx_tuition_classes_teacher ON public.tuition_classes (teacher_id);


-- =====================================================================
--  4. tuition_students — 학생
--     ⚠️ 구조 주의: 한 사람이 여러 과목을 들으면 **과목마다 한 행**이 생긴다.
--        (수학H 1행 + 영어A 1행). 같은 사람 판정은 name + parent_phone 조합.
--     ⚠️ 퇴원은 행 삭제가 아니라 withdrawal_date 를 채우는 것이다.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_students (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id                  uuid REFERENCES public.tuition_classes(id) ON DELETE SET NULL,
  name                      text NOT NULL,
  school                    text,        -- 학교명
  phone                     text,        -- 학생 본인 번호
  parent_phone              text,        -- 학부모(어머니) 번호. 기존 데이터는 전부 모(母)로 간주한다.
  parent_father_phone       text,        -- 학부모(아버지) 번호
  -- payssam_recipient: 결제선생 청구서를 어느 번호로 보낼지. 'mother' | 'father'. 기본 mother.
  payssam_recipient         text DEFAULT 'mother',
  -- attendance_recipient: 등·하원 알림톡을 어느 번호로 보낼지. 'mother' | 'father'. 기본 mother.
  attendance_recipient      text DEFAULT 'mother',
  -- attendance_extra_phone: 등·하원 알림톡 **추가** 수신 번호(선택). 위 수신자와 별개로 한 번 더 보낸다.
  --                         (예: 돌봄 선생님). 숫자만 비교해 같은 번호면 1회만. 청구서 수신자와는 무관.
  attendance_extra_phone    text DEFAULT NULL,
  -- attendance_code: 키오스크 등·하원 체크인 코드. 학생 번호 뒷 4자리를 자동 배정하고,
  --                  중복이면 가운데 4자리로 대체한다. 재원생 사이에서 유일해야 한다(앱이 검사).
  attendance_code           varchar(4),
  enrollment_date           date NOT NULL,   -- 등록일. 이 달 이전 명단에는 나타나지 않는다.
  withdrawal_date           date,            -- 퇴원일. NULL 이면 재원생.
  -- custom_fee: 학생 개별 수업료(원). NULL 이면 반의 monthly_fee 를 쓴다.
  --             0 은 '면제'라는 명시적 의미다 (NULL 과 다르다).
  custom_fee                integer,
  -- payment_due_day: 매월 결제일(1~31). NULL 이면 enrollment_date 의 일자를 쓴다.
  payment_due_day           integer,
  -- electives_payment_due_day: 선택과목 결제일이 정규와 다를 때만 채운다. 분할 청구 판정에 쓰인다.
  electives_payment_due_day integer,
  memo                      text,
  -- memo_color: 메모 강조색. 'yellow' | 'green' | 'red'. red = 주의(수동 처리 필요) 관용.
  memo_color                text,
  -- order_index: 같은 반 안에서의 명단 순서. 종이 명단 순서를 맞추기 위해 사람이 지정한다.
  --              신규 등록 시 그 반의 max+1 로 자동 부여된다. 0 이면 명단 맨 위로 올라간다.
  order_index               integer DEFAULT 0,
  -- split_billing_parts / split_billing_amounts: 청구서 분할 발송 설정.
  --   parts   = 몇 건으로 쪼갤지, amounts = 각 건의 금액 배열(원). 합계가 총 수업료와 같아야 한다.
  split_billing_parts       integer,
  split_billing_amounts     integer[],
  -- electives: 수강 중인 선택과목 이름 배열. 예: {'확통','기하'}.
  --            과목별 월 요금은 앱 상수(ELECTIVE_FEES)에 있고, 총 수업료 = 기본요금 + 선택과목 합계.
  electives                 text[] DEFAULT '{}'::text[],
  -- batch_exclude_month: 'YYYY-MM'. 그 달만 정규 **일괄** 청구 대상에서 빼겠다는 표시.
  --   ⚠️ 요금 면제가 아니다 — 그 학생은 여전히 그 달 수업료를 낼 의무가 있고,
  --      다만 초과결제 차감·이월 정산처럼 금액이 달라서 개별 발송해야 하는 경우에 쓴다.
  batch_exclude_month       text,
  -- status: 레거시 컬럼. 현재 코드는 SELECT 만 하고 어디에도 쓰지 않는다.
  --         (재원/퇴원 판정은 withdrawal_date 로 한다)  -- (추론) 타입/값 도메인 불명
  status                    text,
  -- has_discuss: 상담 필요 플래그. 마이그레이션에는 있으나 현재 코드는 참조하지 않는 레거시.
  has_discuss               boolean DEFAULT false,
  -- due_day: 결제일 오버라이드의 구(舊) 컬럼. payment_due_day 로 대체되어 현재 코드는 참조하지 않는다.
  due_day                   integer,
  created_at                timestamptz DEFAULT now()
);

-- 기존 설치본 호환 — 초기 스키마 이후에 추가된 컬럼들
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS school                    text;
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS parent_father_phone       text;
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS payssam_recipient         text DEFAULT 'mother';
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS attendance_recipient      text DEFAULT 'mother';
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS attendance_extra_phone    text DEFAULT NULL;
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS attendance_code           varchar(4);
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS payment_due_day           integer;
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS electives_payment_due_day integer;
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS memo_color                text;
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS order_index               integer DEFAULT 0;
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS split_billing_parts       integer;
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS split_billing_amounts     integer[];
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS electives                 text[] DEFAULT '{}'::text[];
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS batch_exclude_month       text;
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS status                    text;
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS has_discuss               boolean DEFAULT false;
ALTER TABLE public.tuition_students ADD COLUMN IF NOT EXISTS due_day                   integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tuition_students_payssam_recipient_check') THEN
    ALTER TABLE public.tuition_students ADD CONSTRAINT tuition_students_payssam_recipient_check
      CHECK (payssam_recipient IS NULL OR payssam_recipient IN ('mother', 'father'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tuition_students_attendance_recipient_check') THEN
    ALTER TABLE public.tuition_students ADD CONSTRAINT tuition_students_attendance_recipient_check
      CHECK (attendance_recipient IS NULL OR attendance_recipient IN ('mother', 'father'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tuition_students_memo_color_check') THEN
    ALTER TABLE public.tuition_students ADD CONSTRAINT tuition_students_memo_color_check
      CHECK (memo_color IS NULL OR memo_color IN ('yellow', 'green', 'red'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tuition_students_payment_due_day_check') THEN
    ALTER TABLE public.tuition_students ADD CONSTRAINT tuition_students_payment_due_day_check
      CHECK (payment_due_day IS NULL OR (payment_due_day >= 1 AND payment_due_day <= 31));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tuition_students_electives_due_day_check') THEN
    ALTER TABLE public.tuition_students ADD CONSTRAINT tuition_students_electives_due_day_check
      CHECK (electives_payment_due_day IS NULL OR (electives_payment_due_day >= 1 AND electives_payment_due_day <= 31));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_due_day') THEN
    ALTER TABLE public.tuition_students ADD CONSTRAINT check_due_day
      CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31));
  END IF;
  -- batch_exclude_month 는 'YYYY-MM' 형식만 (임의 문자열이 들어가면 제외 판정이 조용히 빗나간다)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tuition_students_batch_exclude_month_check') THEN
    ALTER TABLE public.tuition_students ADD CONSTRAINT tuition_students_batch_exclude_month_check
      CHECK (batch_exclude_month IS NULL OR batch_exclude_month ~ '^\d{4}-\d{2}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tuition_students_class        ON public.tuition_students (class_id);
CREATE INDEX IF NOT EXISTS idx_tuition_students_withdrawal   ON public.tuition_students (withdrawal_date);
CREATE INDEX IF NOT EXISTS idx_tuition_students_name         ON public.tuition_students (name);
CREATE INDEX IF NOT EXISTS idx_tuition_students_parent_phone ON public.tuition_students (parent_phone);
CREATE INDEX IF NOT EXISTS idx_tuition_students_order        ON public.tuition_students (class_id, order_index);
-- 키오스크 체크인은 재원생의 attendance_code 로 학생을 찾는다 (부분 인덱스)
CREATE INDEX IF NOT EXISTS idx_tuition_students_attendance_code
  ON public.tuition_students (attendance_code)
  WHERE attendance_code IS NOT NULL AND withdrawal_date IS NULL;


-- =====================================================================
--  5. tuition_payments — 납부(수납) 기록
--     🔴 이 테이블의 행은 절대 물리 삭제하지 않는다. 취소는 deleted_at 을 채우는 soft-delete.
--        모든 조회가 `deleted_at IS NULL` 로 거른다.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid REFERENCES public.tuition_students(id) ON DELETE CASCADE,
  amount        integer NOT NULL,          -- 납부액(원)
  -- method: 결제 수단
  --   cash     현금
  --   card     카드결제(현장)
  --   transfer 계좌이체
  --   remote   비대면 (레거시 — 현재 UI 에서는 선택지에서 빠졌다)
  --   payssam  결제선생(외부 청구서 서비스) — 콜백이 자동 기록
  --   pay      간편결제(PAY)
  --   other    기타
  method        text NOT NULL,
  payment_date  date NOT NULL,             -- 실제 납부일
  billing_month text NOT NULL,             -- 청구 대상 월 'YYYY-MM' (payment_date 의 월과 다를 수 있다)
  -- cash_receipt: 현금영수증 발행 상태. 'issued'(발행완료) | 'pending'(미발행) | NULL(해당없음)
  cash_receipt  text,
  -- receipt_images: 영수증 사진 URL 배열 (Supabase Storage 버킷 tuition-receipts)
  receipt_images text[],
  -- memo: 자유 메모. 결제선생 자동 기록분은 여기에 `[bill:<bill_id>]` 태그가 붙어 멱등성 키로 쓰인다.
  memo          text,
  -- deleted_at: soft-delete 시각. NULL 이 아니면 취소된 결제.
  deleted_at    timestamptz,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.tuition_payments ADD COLUMN IF NOT EXISTS cash_receipt   text;
ALTER TABLE public.tuition_payments ADD COLUMN IF NOT EXISTS receipt_images text[];
ALTER TABLE public.tuition_payments ADD COLUMN IF NOT EXISTS deleted_at     timestamptz;

DO $$
BEGIN
  -- method 화이트리스트는 코드(PaymentMethod 유니온)와 동기화한다.
  ALTER TABLE public.tuition_payments DROP CONSTRAINT IF EXISTS tuition_payments_method_check;
  ALTER TABLE public.tuition_payments ADD CONSTRAINT tuition_payments_method_check
    CHECK (method IN ('cash', 'card', 'transfer', 'remote', 'payssam', 'pay', 'other'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_cash_receipt') THEN
    ALTER TABLE public.tuition_payments ADD CONSTRAINT check_cash_receipt
      CHECK (cash_receipt IS NULL OR cash_receipt IN ('issued', 'pending'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tuition_payments_student       ON public.tuition_payments (student_id);
CREATE INDEX IF NOT EXISTS idx_tuition_payments_month         ON public.tuition_payments (billing_month);
CREATE INDEX IF NOT EXISTS idx_tuition_payments_student_month ON public.tuition_payments (student_id, billing_month);
CREATE INDEX IF NOT EXISTS idx_tuition_payments_date          ON public.tuition_payments (payment_date DESC);
-- 살아있는 결제만 훑는 조회가 대부분이라 부분 인덱스가 유효하다
CREATE INDEX IF NOT EXISTS idx_tuition_payments_alive
  ON public.tuition_payments (billing_month, student_id)
  WHERE deleted_at IS NULL;


-- =====================================================================
--  6. teacher_bonuses — 강사 월별 상여
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.teacher_bonuses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    uuid NOT NULL REFERENCES public.tuition_teachers(id) ON DELETE CASCADE,
  billing_month text NOT NULL,        -- 'YYYY-MM'
  amount        integer NOT NULL DEFAULT 0,
  memo          text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teacher_bonuses_teacher_month
  ON public.teacher_bonuses (teacher_id, billing_month);


-- =====================================================================
--  7. academy_expenses — 학원 지출 항목 (월별)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.academy_expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_month text NOT NULL,              -- 'YYYY-MM'
  -- category: 'fixed'(고정비 — 임대료·관리비 등, 다음 달로 자동 승계됨)
  --         | 'variable'(변동비 — 그 달에만 발생)
  category      text NOT NULL,
  name          text NOT NULL,              -- 항목명 (임대료, 관리비, 비품 ...)
  amount        integer NOT NULL DEFAULT 0,
  memo          text,
  created_at    timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'academy_expenses_category_check') THEN
    ALTER TABLE public.academy_expenses ADD CONSTRAINT academy_expenses_category_check
      CHECK (category IN ('fixed', 'variable'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_academy_expenses_month
  ON public.academy_expenses (billing_month);
CREATE INDEX IF NOT EXISTS idx_academy_expenses_month_category
  ON public.academy_expenses (billing_month, category);


-- =====================================================================
--  8. academy_finance_months — '이 달 재무 장부를 개시했다'는 마커
--     지출 화면을 그 달에 처음 열면 이 행을 INSERT 하고, 성공했을 때만
--     직전 달의 고정비(category='fixed')를 그 달로 복사한다.
--     즉 이 테이블의 유일한 역할은 **고정비 승계를 딱 한 번만** 돌게 하는 것이다.
--     (중복 INSERT 는 23505 로 실패하고, 그 실패가 곧 '이미 승계했음' 신호다
--      → billing_month 에 유니크 제약이 반드시 있어야 한다)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.academy_finance_months (
  billing_month text PRIMARY KEY,       -- 'YYYY-MM'
  created_at    timestamptz DEFAULT now()
);


-- =====================================================================
--  9. audit_logs — 감사 로그
--     돈·학생 정보처럼 되돌리기 어려운 변경의 흔적. 앱은 여기에 INSERT 만 한다.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- entity_type: 'payment' | 'student' | 'class' | 'grade' | 'teacher' | 'attendance' | 'notice'
  entity_type text NOT NULL,
  -- entity_id: 대상 행의 id. NULL 허용(대상 특정 불가한 경고성 로그).
  --   ⚠️ (추론) 원래 마이그레이션은 uuid 였으나, 출결 일괄 저장이 `bulk-2026-08-22` 처럼
  --      UUID 가 아닌 값을 넣는다(src/app/api/attendance/route.ts). uuid 로 두면 그 INSERT 가
  --      조용히 실패한다(감사 로그 쓰기는 non-critical 이라 콘솔 경고만 남는다).
  --      OSS 기본값은 text 로 완화했다. 운영 DB가 uuid 라면 그대로 두어도 나머지 경로는 동작한다.
  entity_id   text,
  -- action: 'create' | 'update' | 'delete' | 'upsert'
  action      text NOT NULL,
  summary     text NOT NULL,            -- 사람이 읽는 한 줄 요약
  details     jsonb,                    -- 변경 상세(변경 필드 스냅샷 등)
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity     ON public.audit_logs (entity_type, entity_id);


-- =====================================================================
--  10. tuition_attendance — 출결
--      같은 학생·같은 날짜는 한 행 (upsert onConflict: student_id,date)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_attendance (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     uuid NOT NULL REFERENCES public.tuition_students(id) ON DELETE CASCADE,
  date           date NOT NULL,
  -- status: present(출석) | absent(결석) | late(지각) | early_leave(조퇴) | makeup(보강)
  status         text NOT NULL,
  -- check_in_time / check_out_time: 키오스크 등·하원 체크 시각 (ISO timestamptz).
  --   NULL 이면 그 방향의 체크가 아직 없다는 뜻이고, 앱은 이 값으로 중복 체크를 막는다.
  check_in_time  timestamptz,
  check_out_time timestamptz,
  note           text,                       -- 출결 메모. 사람이 쓴 값은 자동 체크인이 덮지 않는다.
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

ALTER TABLE public.tuition_attendance ADD COLUMN IF NOT EXISTS check_in_time  timestamptz;
ALTER TABLE public.tuition_attendance ADD COLUMN IF NOT EXISTS check_out_time timestamptz;
ALTER TABLE public.tuition_attendance ADD COLUMN IF NOT EXISTS updated_at     timestamptz DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tuition_attendance_status_check') THEN
    ALTER TABLE public.tuition_attendance ADD CONSTRAINT tuition_attendance_status_check
      CHECK (status IN ('present', 'absent', 'late', 'early_leave', 'makeup'));
  END IF;
END $$;

-- upsert(onConflict: 'student_id,date') 가 동작하려면 이 유니크가 필수다
CREATE UNIQUE INDEX IF NOT EXISTS tuition_attendance_student_date_key
  ON public.tuition_attendance (student_id, date);
CREATE INDEX IF NOT EXISTS idx_tuition_attendance_date ON public.tuition_attendance (date DESC);


-- =====================================================================
--  11. tuition_bill_history — 결제선생(PaySsam) 청구서 발송·결제 이력
--      돈이 실제로 오가는 테이블. bill_id 가 외부 서비스와의 연결 키다.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_bill_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          uuid REFERENCES public.tuition_students(id) ON DELETE CASCADE,
  -- bill_id: 결제선생이 발급한 청구서 ID. 모든 갱신이 이 값으로 행을 찾는다 → 유일해야 한다.
  bill_id             text NOT NULL,
  amount              integer NOT NULL,     -- 청구액(원)
  billing_month       text NOT NULL,        -- 'YYYY-MM'
  phone               text,                 -- 실제 발송된 수신 번호
  -- status: 청구서 상태
  --   sent      발송됨(미결제)
  --   paid      결제완료   (콜백 appr_state='F')
  --   pending   미결제     (콜백 appr_state='W')
  --   cancelled 취소/환불  (콜백 appr_state='C')
  --   destroyed 파기       (콜백 appr_state='D', 또는 타 결제수단 수납 시 자동 파기)
  --   ⚠️ CHECK 를 걸지 않았다. 콜백이 `statusMap[appr_state] || appr_state` 로 매핑하므로
  --      결제선생이 새 상태 코드를 보내면 그 원본 문자열이 그대로 저장될 수 있고,
  --      CHECK 가 있으면 콜백 전체가 실패해 "결제했는데 미납" 상태로 굳는다.
  status              text NOT NULL DEFAULT 'sent',
  short_url           text,                 -- 학부모에게 전송된 결제 페이지 단축 URL (취소영수증으로도 쓰인다)
  sent_at             timestamptz,          -- 발송 시각
  -- is_regular_tuition: 정규 수업료 청구인지. false = 특강·보강 등 별건 청구.
  --   정규만 납부 탭(tuition_payments)에 자동 반영된다.
  is_regular_tuition  boolean NOT NULL DEFAULT true,
  -- bill_note: 청구 성격 메모 겸 **매칭 키**. 특강은 여기에 특강 라벨(예: '여름방학 특강')이 들어가고,
  --   같은 billing_month 안에서 정규/특강을 가르는 기준이 된다.
  bill_note           text,
  -- bill_type: 'regular'(정규) | 'electives'(선택과목 분리 청구). 같은 학생에 두 건이 공존할 수 있다.
  bill_type           text NOT NULL DEFAULT 'regular',
  -- supersedes_bill_id: 이 청구서가 대체하는 기존 청구서의 bill_id.
  --   중도 퇴원 정산에 쓴다 — 정산분이 결제완료되면 콜백이 여기 적힌 기존 완납분을 자동 취소(환불)한다.
  supersedes_bill_id  text,
  resend_count        integer DEFAULT 0,    -- 카톡 재알림(재발송) 횟수. bill_id 는 그대로라 이중청구 아님.
  last_resend_at      timestamptz,
  overdue_sms_count   integer DEFAULT 0,    -- 미납 안내 문자 발송 횟수 (UI 배지용)
  last_overdue_sms_at timestamptz,
  -- appr_*: 결제선생 승인 콜백 원본 값
  appr_num            text,                 -- 승인번호
  appr_price          integer,              -- 실제 승인 금액(원). amount 와 다를 수 있고, 다르면 이쪽이 정본이다.
  appr_pay_type       text,                 -- 결제 수단 코드
  appr_dt             text,                 -- 승인 일시 (결제선생 원본 문자열 그대로) -- (추론) text 로 둔다
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

ALTER TABLE public.tuition_bill_history ADD COLUMN IF NOT EXISTS bill_type           text NOT NULL DEFAULT 'regular';
ALTER TABLE public.tuition_bill_history ADD COLUMN IF NOT EXISTS supersedes_bill_id  text;
ALTER TABLE public.tuition_bill_history ADD COLUMN IF NOT EXISTS resend_count        integer DEFAULT 0;
ALTER TABLE public.tuition_bill_history ADD COLUMN IF NOT EXISTS last_resend_at      timestamptz;
ALTER TABLE public.tuition_bill_history ADD COLUMN IF NOT EXISTS overdue_sms_count   integer DEFAULT 0;
ALTER TABLE public.tuition_bill_history ADD COLUMN IF NOT EXISTS last_overdue_sms_at timestamptz;
ALTER TABLE public.tuition_bill_history ADD COLUMN IF NOT EXISTS appr_num            text;
ALTER TABLE public.tuition_bill_history ADD COLUMN IF NOT EXISTS appr_price          integer;
ALTER TABLE public.tuition_bill_history ADD COLUMN IF NOT EXISTS appr_pay_type       text;
ALTER TABLE public.tuition_bill_history ADD COLUMN IF NOT EXISTS appr_dt             text;
ALTER TABLE public.tuition_bill_history ADD COLUMN IF NOT EXISTS updated_at          timestamptz DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tuition_bill_history_bill_type_check') THEN
    ALTER TABLE public.tuition_bill_history ADD CONSTRAINT tuition_bill_history_bill_type_check
      CHECK (bill_type IN ('regular', 'electives'));
  END IF;
END $$;

-- bill_id 는 .eq('bill_id', ...).single() 로 조회·갱신되는 사실상의 자연키다
CREATE UNIQUE INDEX IF NOT EXISTS tuition_bill_history_bill_id_key
  ON public.tuition_bill_history (bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_history_student_month
  ON public.tuition_bill_history (student_id, billing_month);
CREATE INDEX IF NOT EXISTS idx_bill_history_status    ON public.tuition_bill_history (status);
CREATE INDEX IF NOT EXISTS idx_bill_history_bill_note ON public.tuition_bill_history (bill_note);
CREATE INDEX IF NOT EXISTS idx_bill_history_sent_at   ON public.tuition_bill_history (sent_at DESC);
-- 중복 발송 가드가 "이 학생·이 달에 살아있는 청구서" 를 훑는다
CREATE INDEX IF NOT EXISTS idx_bill_history_live
  ON public.tuition_bill_history (student_id, billing_month, status)
  WHERE status = 'sent';


-- =====================================================================
--  12. tuition_bill_queue — 청구서 발송/파기 예약 큐
--      두 가지 용도가 한 테이블에 있다.
--        (a) 영업시간(타임락) 밖 발송 요청 → scheduled_at 에 크론이 대신 보낸다
--        (b) 타 결제수단으로 수납했을 때 기존 청구서를 1시간 뒤 자동 파기 (착각 입력 복구 버퍼)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_bill_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid REFERENCES public.tuition_students(id) ON DELETE CASCADE,
  student_name       text,                 -- 발송 당시 이름 스냅샷 (로그·알림 문구용)
  phone              text,                 -- 수신 번호
  billing_month      text NOT NULL,        -- 'YYYY-MM'
  is_regular_tuition boolean DEFAULT true,
  bill_type          text,                 -- 'regular' | 'electives' (NULL 이면 발송 시 'regular')
  bill_note          text,                 -- 예약 사유 / 특강 라벨
  -- send_type: 이 큐 엔트리가 무슨 일을 예약한 것인지
  --   single  단건 발송
  --   split   분할 발송 (payload.amounts 배열의 금액들로 나눠 보낸다)
  --   reissue 기존 청구서 파기 후 재발행 (payload.oldBillId)
  --   resend  같은 청구서 카톡 재알림 (payload.billId, 새 청구 아님)
  --   destroy 청구서 파기 (payload.billId — 타 결제수단 수납 후 1시간 버퍼)
  send_type          text NOT NULL,
  -- payload: send_type 별 인자 묶음(jsonb).
  --   single/reissue : { amount, productName, message, oldBillId?, supersedesBillId?, resettleUnpaid? }
  --   split          : { amounts: number[], persist: boolean }
  --   resend/destroy : { billId, amount?, methodLabel?, paymentId?, specialPaymentId? }
  payload            jsonb,
  scheduled_at       timestamptz NOT NULL, -- 이 시각 이후에 크론이 집어간다
  -- status: pending(대기) | processing(처리중, 크론이 선점) | sent(완료)
  --       | failed(최종 실패) | cancelled(대상 청구서 상태가 바뀌어 취소)
  status             text NOT NULL DEFAULT 'pending',
  bill_id            text,                 -- 처리 결과로 생긴/처리한 청구서 ID
  error_msg          text,                 -- 마지막 실패 사유
  retry_count        integer DEFAULT 0,    -- 재시도 횟수. 3회 실패하면 status='failed' + 감사 로그.
  sent_at            timestamptz,          -- 실제 처리 완료 시각
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

ALTER TABLE public.tuition_bill_queue ADD COLUMN IF NOT EXISTS bill_type   text;
ALTER TABLE public.tuition_bill_queue ADD COLUMN IF NOT EXISTS bill_id     text;
ALTER TABLE public.tuition_bill_queue ADD COLUMN IF NOT EXISTS error_msg   text;
ALTER TABLE public.tuition_bill_queue ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0;
ALTER TABLE public.tuition_bill_queue ADD COLUMN IF NOT EXISTS sent_at     timestamptz;
ALTER TABLE public.tuition_bill_queue ADD COLUMN IF NOT EXISTS updated_at  timestamptz DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tuition_bill_queue_send_type_check') THEN
    ALTER TABLE public.tuition_bill_queue ADD CONSTRAINT tuition_bill_queue_send_type_check
      CHECK (send_type IN ('single', 'split', 'reissue', 'resend', 'destroy'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tuition_bill_queue_status_check') THEN
    ALTER TABLE public.tuition_bill_queue ADD CONSTRAINT tuition_bill_queue_status_check
      CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled'));
  END IF;
END $$;

-- 크론이 "지금 처리할 것" 을 뽑는 주 조회 경로
CREATE INDEX IF NOT EXISTS idx_bill_queue_due
  ON public.tuition_bill_queue (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_bill_queue_month   ON public.tuition_bill_queue (billing_month, status);
CREATE INDEX IF NOT EXISTS idx_bill_queue_student ON public.tuition_bill_queue (student_id);
CREATE INDEX IF NOT EXISTS idx_bill_queue_type    ON public.tuition_bill_queue (send_type, status);


-- =====================================================================
--  13. tuition_monthly_memos — 월별 전체 메모 (학생 단위 아님)
--      billing_month 가 PK. 화면에서 그 달 메모를 통째로 덮어쓴다(upsert).
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_monthly_memos (
  billing_month text PRIMARY KEY,       -- 'YYYY-MM'
  content       text NOT NULL DEFAULT '',
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);


-- =====================================================================
--  14. tuition_fee_snapshot — 월별 수업료 박제(스냅샷)
--      왜 필요한가: 완납/미납 판정을 "현재 요금" 으로 하면, 요금을 바꾼 순간
--      과거 달의 표시가 통째로 뒤바뀐다. 그래서 매월 1일 크론이 그 달의
--      학생별 요금을 여기 박아 두고, 과거 달 판정은 이 값을 정본으로 쓴다.
--      · 크론(월 1회)  : ignoreDuplicates=true — 이미 박힌 값은 절대 덮지 않는다
--      · 요금 변경 직후 : 당월 행만 upsert 로 갱신 (과거 달은 불가침)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_fee_snapshot (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.tuition_students(id) ON DELETE CASCADE,
  month      text NOT NULL,             -- 'YYYY-MM'
  fee        integer NOT NULL,          -- 그 달의 총 수업료(기본요금 + 선택과목 합계), 원
  created_at timestamptz DEFAULT now()
);

-- upsert(onConflict: 'student_id,month') 가 동작하려면 이 유니크가 필수다
CREATE UNIQUE INDEX IF NOT EXISTS tuition_fee_snapshot_student_month_key
  ON public.tuition_fee_snapshot (student_id, month);
CREATE INDEX IF NOT EXISTS idx_fee_snapshot_month ON public.tuition_fee_snapshot (month);


-- =====================================================================
--  15. tuition_special_class — 반 단위 특강 (예: 여름방학 특강)
--      반에 속한 학생 전원이 대상. 학생별 명단이 따로 없다.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_special_class (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id     uuid REFERENCES public.tuition_classes(id) ON DELETE CASCADE,
  -- label: 특강 이름. 청구서의 bill_note 와 **같은 문자열**이어야 납부 상태가 매칭된다.
  label        text NOT NULL,
  fee          integer NOT NULL DEFAULT 0,   -- 이 반의 특강비(원)
  hours_note   text,                          -- 시수 안내 문구 (예: '주 2회 8시간 추가')
  teacher_note text,                          -- 담당 강사 안내 문구
  period_start date,                          -- 특강 시작일 (이 날짜 이전 퇴원생은 대상 제외)
  period_end   date,                          -- 특강 종료일
  due_date     date,                          -- 특강비 납부 기한
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_special_class_label ON public.tuition_special_class (label);
CREATE INDEX IF NOT EXISTS idx_special_class_class ON public.tuition_special_class (class_id);


-- =====================================================================
--  16. tuition_special_group — 명단 단위 특강
--      반과 무관하게 사람을 골라 묶는 특강. 멤버는 아래 group_member 테이블.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_special_group (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text NOT NULL,              -- 특강 시즌 라벨 (예: '여름방학 특강')
  name          text NOT NULL,              -- 그룹 이름 (예: '고2 확통 심화')
  subject       text,                        -- 과목
  fee           integer NOT NULL DEFAULT 0,  -- 1인당 특강비(원)
  schedule_note text,                        -- 일정 안내 문구
  -- bill_note: 이 그룹으로 발송하는 청구서의 bill_note 값. 납부 상태 매칭 키라 그룹마다 유일해야 한다.
  bill_note     text NOT NULL,
  product_name  text,                        -- 결제선생 청구서에 표시할 상품명 (NULL 이면 앱 기본값)
  order_index   integer DEFAULT 0,           -- 화면 정렬 순서
  period_start  date,
  period_end    date,
  due_date      date,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_special_group_order ON public.tuition_special_group (order_index);
-- (추론) bill_note 는 청구서 매칭 키라 사실상 유일해야 한다. 다만 기존 DB에 중복이 있으면
--        유니크 생성이 실패해 스크립트 전체가 멈추므로, 유니크는 시도만 하고 실패 시 경고만 남긴다.
CREATE INDEX IF NOT EXISTS idx_special_group_bill_note ON public.tuition_special_group (bill_note);
DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS tuition_special_group_bill_note_key
      ON public.tuition_special_group (bill_note);
  EXCEPTION WHEN unique_violation OR duplicate_table THEN
    RAISE WARNING 'tuition_special_group.bill_note 에 중복이 있어 유니크 인덱스를 건너뜁니다. 중복을 정리한 뒤 수동으로 만드세요.';
  END;
END $$;


-- =====================================================================
--  17. tuition_special_group_member — 명단 특강의 수강생
--      ⚠️ 멤버를 뺄 때는 살아있는(status='sent') 청구서를 **먼저 파기**해야 한다.
--         명단에서만 빼면 화면에서 사라지는데 결제 링크는 살아 있어 학부모가 그대로 결제해 버린다.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_special_group_member (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES public.tuition_special_group(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES public.tuition_students(id) ON DELETE CASCADE,
  order_index integer DEFAULT 0,            -- 명단 안에서의 순서
  created_at  timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tuition_special_group_member_key
  ON public.tuition_special_group_member (group_id, student_id);
CREATE INDEX IF NOT EXISTS idx_special_group_member_student
  ON public.tuition_special_group_member (student_id);


-- =====================================================================
--  18. tuition_special_payment — 특강비 직접 납부 기록
--      결제선생을 거치지 않은 현장 수납(카드/현금/이체/간편결제).
--      🔴 tuition_payments 와 마찬가지로 물리 삭제 금지 — deleted_at soft-delete.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_special_payment (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     uuid NOT NULL REFERENCES public.tuition_students(id) ON DELETE CASCADE,
  -- label: 어느 특강의 납부인지. tuition_special_class.label / special_group.bill_note 와 맞춘다.
  label          text NOT NULL,
  amount         integer NOT NULL,           -- 납부액(원)
  -- method: card | transfer | cash | pay | other  (결제선생 'payssam' 은 여기 오지 않는다)
  method         text NOT NULL,
  memo           text,
  paid_at        date,                        -- 납부일. 과거 날짜 허용, 미래 날짜는 앱이 막는다.
  receipt_images text[],                      -- 영수증 사진 URL 배열
  deleted_at     timestamptz,                 -- soft-delete 시각
  created_at     timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tuition_special_payment_method_check') THEN
    ALTER TABLE public.tuition_special_payment ADD CONSTRAINT tuition_special_payment_method_check
      CHECK (method IN ('card', 'transfer', 'cash', 'pay', 'other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_special_payment_student ON public.tuition_special_payment (student_id);
CREATE INDEX IF NOT EXISTS idx_special_payment_label   ON public.tuition_special_payment (label);
CREATE INDEX IF NOT EXISTS idx_special_payment_alive
  ON public.tuition_special_payment (label, student_id)
  WHERE deleted_at IS NULL;


-- =====================================================================
--  19. tuition_withdrawal_status — 퇴원생 월별 처리 상태
--      학생 단위 메모가 아니라 (학생, 월) 단위로 독립 저장한다.
--      상태 해제는 행 DELETE, 설정은 upsert(onConflict: student_id,billing_month).
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tuition_withdrawal_status (
  student_id    uuid NOT NULL REFERENCES public.tuition_students(id) ON DELETE CASCADE,
  billing_month text NOT NULL,               -- 'YYYY-MM'
  -- status
  --   [종결 = 정산/환불이 실제로 끝난 상태. 결제 콜백이 자동으로 찍는다]
  --     resettled_paid          정산분 결제완료
  --     refund_done             환불 완료
  --     settle                  이번 달까지 정리 완료
  --   [진행중]
  --     resettle_pending        정산분 발송됨, 결제 대기
  --     resettle_scheduled      정산분 발송 예약됨(영업시간 밖)
  --   [예외]
  --     resettle_refund_failed  정산분은 결제됐으나 기존 완납분 자동 환불에 실패 — 수동 확인 필요
  --                             (콜백이 직접 쓰며, 앱 API 의 화이트리스트에는 없다)
  --   ⚠️ 종결 -> 진행중 으로의 하향 전이는 force 플래그 없이는 API 가 막는다.
  status        text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  PRIMARY KEY (student_id, billing_month)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tuition_withdrawal_status_status_check') THEN
    ALTER TABLE public.tuition_withdrawal_status ADD CONSTRAINT tuition_withdrawal_status_status_check
      CHECK (status IN (
        'resettled_paid', 'refund_done', 'settle',
        'resettle_pending', 'resettle_scheduled',
        'resettle_refund_failed'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_withdrawal_status_month
  ON public.tuition_withdrawal_status (billing_month);


-- =====================================================================
--  20. 보안: RLS + GRANT
-- =====================================================================
--
--  이 앱의 접근 방식
--  ----------------
--  서버(Next.js API 라우트)에서만 Supabase 에 붙고, 키는 **service_role** 이다
--  (src/lib/supabase.ts — SUPABASE_SERVICE_ROLE_KEY). service_role 은 RLS 를
--  BYPASS 하므로, 앱 기능을 유지하면서도 공개 키(anon/publishable)로는
--  아무것도 못 하게 만들 수 있다.
--
--  그래서 올바른 자세는 이것이다:
--
--      ✅ 모든 테이블 RLS 활성화
--      ✅ anon / authenticated 정책은 **하나도 만들지 않는다**
--      ✅ anon / authenticated 에게 GRANT 도 주지 않는다
--      ➜ 결과: 공개 키를 가진 사람에게 이 테이블들은 존재하지 않는 것과 같다
--
--  🔴 경고 — 실제로 났던 사고
--  --------------------------
--  초기 스키마는 RLS 를 꺼 두었고, 일부 테이블에는
--  `CREATE POLICY "Allow all for anon" ... FOR ALL USING (true)` 가 걸려 있었다.
--  브라우저에 노출되는 publishable(anon) 키만 있으면 **학생 실명·학부모 전화번호·
--  결제 내역·강사 급여 배분율까지 전부 읽고 지울 수 있었다.** 2026-04-23 에
--  급히 봉합했다(supabase-migration-rls-enable.sql).
--
--  ⛔ 편해 보인다는 이유로 아래 같은 정책을 다시 만들지 마라.
--       CREATE POLICY "allow all" ON tuition_students FOR ALL USING (true);
--     이 한 줄이 학생 개인정보(PII)와 결제 데이터를 인터넷 전체에 여는 스위치다.
--     클라이언트에서 직접 DB 를 읽고 싶다면, 정책을 여는 대신
--     서버 API 라우트를 하나 더 만들어라.
--
--  ℹ️ 참고: RLS 활성화 / 정책 / GRANT 는 서로 다른 세 차원이다.
--     · RLS 를 안 켜면 정책이 있든 없든 GRANT 만으로 전권이 열린다
--     · 정책만 지우고 RLS 를 안 켜면 아무 것도 막지 못한다
--     · Supabase 는 2026-10-30 부터 새 테이블의 기본 노출을 제거하므로
--       service_role GRANT 는 명시적으로 박아 두는 편이 안전하다
-- ---------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'tuition_grades',
    'tuition_teachers',
    'tuition_classes',
    'tuition_students',
    'tuition_payments',
    'teacher_bonuses',
    'academy_expenses',
    'academy_finance_months',
    'audit_logs',
    'tuition_attendance',
    'tuition_bill_history',
    'tuition_bill_queue',
    'tuition_monthly_memos',
    'tuition_fee_snapshot',
    'tuition_special_class',
    'tuition_special_group',
    'tuition_special_group_member',
    'tuition_special_payment',
    'tuition_withdrawal_status'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- 1) RLS 활성화 (service_role 은 BYPASSRLS 라 앱 기능은 그대로)
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- 2) 과거에 존재했던 anon 전면허용 정책 제거 (있을 때만)
    EXECUTE format('DROP POLICY IF EXISTS "Allow all for anon" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "allow all" ON public.%I', t);

    -- 3) 공개 롤 권한 회수 — 정책이 없어도 GRANT 가 남아 있으면 실수의 씨앗이 된다
    --    (Supabase 가 아닌 순수 Postgres 에는 이 롤들이 없으므로 존재할 때만 실행한다)
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    END IF;

    -- 4) 서버 전용 롤에만 권한 부여
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    END IF;
  END LOOP;
END $$;

-- 검증용 — 아래가 전부 rowsecurity = t 여야 한다
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname = 'public'
--      AND (tablename LIKE 'tuition_%' OR tablename LIKE 'academy_%' OR tablename IN ('teacher_bonuses','audit_logs'))
--    ORDER BY tablename;
--
-- 정책이 하나도 없어야 한다 (0 행이 정상)
--   SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public';


-- =====================================================================
--  21. 파일 저장소 (참고 — DDL 아님)
-- =====================================================================
--  영수증 사진은 Supabase Storage 버킷 `tuition-receipts` 에 올라가고,
--  DB 에는 URL 문자열 배열(receipt_images)만 저장된다.
--  버킷은 대시보드 → Storage 에서 만들고, **비공개(private)** 로 두는 것을 권한다.
--  앱은 조회 시 서명 URL(createSignedUrl)을 발급해 내려준다.


-- =====================================================================
--  22. [선택] 외부 연동 테이블 — 이 파일에는 만들지 않는다
-- =====================================================================
--
--  아래 테이블들은 **이 앱의 것이 아니다.** 원 배포 환경에서는 같은 학원이
--  운영하는 형제 앱들(수업 관리 앱, 질문 앱, 상담 앱, 메모 앱 등)이
--  같은 Supabase 프로젝트를 공유했고, 이 앱은 학생 상세 화면의
--  "학생 360" 섹션에서 그 데이터를 **읽기 전용으로만** 참조한다.
--
--      dm_students                dm_classes             dm_teachers
--      dm_grades                  dm_school_grades       dm_consultations
--      dm_class_progress_parsed   qa_submissions         memos
--      students                   student_aliases
--      student_call_logs          student_notes
--
--  OSS 사용자는 이것들을 무시하면 된다.
--  ------------------------------------
--  이 테이블들이 없어도 앱은 정상 동작한다. 360 조회 코드는 각 SELECT 를
--  개별적으로 감싸고, 스키마 없음 오류(PostgREST PGRST205 / Postgres 42703 /
--  "does not exist" / "schema cache")를 만나면 그 섹션만 빈 값으로 처리한다.
--  (src/lib/student360.ts 의 isMissingSchemaError 참조)
--  결과: 학생 360 화면에 "성적 / 질문 / 상담 / 통화기록" 섹션이 비어 보일 뿐이고,
--  원비·청구·출결 같은 이 앱의 본기능에는 아무 영향이 없다.
--
--  ⚠️ 이 테이블들을 흉내 내어 직접 만들지 마라. 여기 적힌 컬럼 목록은
--     이 앱이 SELECT 하는 것만 보고 적은 것이라 원본 스키마의 일부에 불과하고,
--     소유 앱이 없으면 채워 넣을 데이터도 없다. 360 섹션을 정말 쓰고 싶다면
--     자기 데이터 소스에 맞춰 src/app/api/students/[id]/360/route.ts 를
--     고쳐 쓰는 편이 낫다.
--
--  (참고) 이 앱이 각 테이블에서 읽는 컬럼 —
--    dm_students              : id, name, status, class_id, teacher_id, school, tuition_student_id
--    dm_classes               : id, name, schedule
--    dm_teachers              : id, name
--    dm_grades                : student_id, exam_name, subject, score, total, created_at
--    dm_school_grades         : student_id, year, semester, exam_type, score, notes
--    dm_consultations         : id, status, grade_label, school, progress, memo,
--                               first_visit_at, enrolled_at, created_at,
--                               tuition_student_id, student_name, parent_phone
--    dm_class_progress_parsed : subject, class_name, submitted_at, items, tuition_student_id
--    qa_submissions           : id, class_name, student_name, content, created_at, tuition_student_id
--    memos                    : title, content, memo_type, created_at
--    students                 : id, tuition_student_id
--    student_aliases          : alias, tuition_student_id
--    student_call_logs        : channel, occurred_at, summary, created_by, tuition_student_id
--    student_notes            : student_id, category, title, content, note_date
--
--  ⚠️ 반대 방향 주의: 형제 앱들이 tuition_students(id) 를 외래키로 참조하는
--     구성이었다면, 이 앱에서 학생을 **하드 삭제**할 때 그쪽 행이 함께 사라지거나
--     (CASCADE) 삭제 자체가 FK 위반으로 실패할 수 있다. 이 앱의 정상 경로에서는
--     퇴원 = withdrawal_date 설정이지 삭제가 아니므로 평소에는 문제되지 않는다.
--
-- =====================================================================
--  끝.
-- =====================================================================
