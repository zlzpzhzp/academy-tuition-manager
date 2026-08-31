-- 학년 테이블
create table tuition_grades (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  order_index int default 0,
  created_at timestamptz default now()
);

-- 반 테이블
create table tuition_classes (
  id uuid primary key default gen_random_uuid(),
  grade_id uuid references tuition_grades(id) on delete cascade,
  name text not null,
  monthly_fee int default 0,
  order_index int default 0,
  created_at timestamptz default now()
);

-- 학생 테이블
create table tuition_students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references tuition_classes(id) on delete set null,
  name text not null,
  phone text,
  parent_phone text,
  enrollment_date date not null,
  withdrawal_date date,
  custom_fee int,
  payment_due_day int,
  has_discuss boolean default false,
  memo text,
  created_at timestamptz default now()
);

-- 납부 내역 테이블
create table tuition_payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references tuition_students(id) on delete cascade,
  amount int not null,
  method text not null check (method in ('cash', 'card', 'transfer', 'remote', 'other')),
  payment_date date not null,
  billing_month text not null,
  memo text,
  created_at timestamptz default now()
);

-- RLS 비활성화 (혼자 사용)
alter table tuition_grades disable row level security;
alter table tuition_classes disable row level security;
alter table tuition_students disable row level security;
alter table tuition_payments disable row level security;
