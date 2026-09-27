/**
 * 월별 매출 추이 집계 (2026-09-03 운영자님 지시)
 *
 * DB 조회는 라우트(/api/stats/monthly)가 하고, **순수 계산만** 여기에 둔다 — 테스트 가능하게.
 * (src/__tests__/monthlyStats.test.ts 가 이 파일만 직접 검증한다)
 *
 * 🔴 귀속(byTeacher/bySubject)의 한계: 학생 → 반 이력 테이블이 없어서 **현재 소속 반**으로만
 * 과거 달을 귀속한다. 반을 옮긴 학생의 과거 매출은 지금 반의 선생님/과목으로 잡힌다.
 * (이력 테이블이 생기기 전엔 구조적으로 불가능 — 화면에도 같은 주의문구를 노출한다)
 */

export interface SnapshotRow {
  student_id: string
  month: string // YYYY-MM
  fee: number
}

export interface PaymentRow {
  student_id: string
  amount: number
  billing_month: string // YYYY-MM
  method?: string | null
}

export interface SpecialRow {
  amount: number
  /** date 컬럼(YYYY-MM-DD). null 이면 created_at 으로 폴백 */
  paid_at?: string | null
  created_at?: string | null
}

export interface StudentRow {
  id: string
  class_id?: string | null
}

export interface ClassRow {
  id: string
  teacher_id?: string | null
  subject?: string | null
}

export interface TeacherRow {
  id: string
  name: string
}

export interface TeacherStat {
  teacher_id: string | null
  name: string
  paid: number
  fee: number
  studentCount: number
}

export interface SubjectStat {
  subject: string
  paid: number
  fee: number
}

export interface MonthStat {
  month: string
  /** 예정 원비 = 그 달 요금 스냅샷 합 */
  fee: number
  /** 그 달 스냅샷 row 수 = 재원 학생수 */
  studentCount: number
  /** 수납 = tuition_payments 합 (billing_month 기준) */
  paid: number
  /** 그 달 납부한 학생 수 (중복 제거) */
  paidCount: number
  /** 특강 직접납부 합 (KST 기준 납부월로 버킷) */
  special: number
  byMethod: Record<string, number>
  byTeacher: TeacherStat[]
  bySubject: SubjectStat[]
}

/** 귀속 실패(반 미배정·반 삭제) 표시 라벨 — 선생님/과목 공용 */
export const UNASSIGNED_LABEL = '미배정'

const MONTH_RE = /^\d{4}-\d{2}$/

/** 'YYYY-MM' 유효성 (월 01~12까지 확인 — 정규식만으론 2026-99 가 통과한다) */
export function isValidMonth(m: string): boolean {
  if (!MONTH_RE.test(m)) return false
  const mm = Number(m.slice(5, 7))
  return mm >= 1 && mm <= 12
}

/** month 에 delta 개월을 더한 'YYYY-MM' (Date/TZ 안 씀 — 순수 산술이라 UTC drift 없음) */
export function addMonths(month: string, delta: number): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const total = y * 12 + (m - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = total - ny * 12 + 1
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`
}

/** from~to(포함) 월 목록 오름차순. from > to 면 빈 배열. */
export function monthRange(from: string, to: string): string[] {
  if (!isValidMonth(from) || !isValidMonth(to)) return []
  const out: string[] = []
  let cur = from
  // 방어적 상한(1200개월=100년) — 잘못된 입력으로 무한루프 나지 않게
  for (let i = 0; i < 1200 && cur <= to; i++) {
    out.push(cur)
    cur = addMonths(cur, 1)
  }
  return out
}

/**
 * 타임스탬프/날짜 문자열 → KST 기준 'YYYY-MM'.
 * - 'YYYY-MM-DD'(date 컬럼)는 이미 KST 벽시계 날짜라 그대로 자른다.
 * - timestamptz 는 UTC → +9h 시프트. (2026-07-31T15:30:00Z = KST 8/1 00:30 → '2026-08')
 * ⚠️ toISOString().slice(0,7) 직접 사용 금지 — 시프트 없이 쓰면 KST 와 최대 하루 어긋난다.
 */
export function kstMonthOf(value?: string | null): string | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 7)
  const t = Date.parse(value)
  if (Number.isNaN(t)) return null
  const kst = new Date(t + 9 * 60 * 60 * 1000)
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`
}

interface Attribution {
  teacherId: string | null
  teacherName: string
  subject: string
}

/** 학생 → (현재) 반 → 선생님·과목 귀속 맵 */
function buildAttribution(
  students: StudentRow[],
  classes: ClassRow[],
  teachers: TeacherRow[],
): Map<string, Attribution> {
  const classById = new Map(classes.map(c => [c.id, c]))
  const teacherById = new Map(teachers.map(t => [t.id, t]))
  const map = new Map<string, Attribution>()
  for (const s of students) {
    const cls = s.class_id ? classById.get(s.class_id) : undefined
    const teacher = cls?.teacher_id ? teacherById.get(cls.teacher_id) : undefined
    map.set(s.id, {
      teacherId: teacher?.id ?? null,
      teacherName: teacher?.name ?? UNASSIGNED_LABEL,
      subject: cls?.subject || UNASSIGNED_LABEL,
    })
  }
  return map
}

const FALLBACK_ATTR: Attribution = {
  teacherId: null,
  teacherName: UNASSIGNED_LABEL,
  subject: UNASSIGNED_LABEL,
}

export interface AggregateInput {
  from: string
  to: string
  snapshots: SnapshotRow[]
  payments: PaymentRow[]
  specials: SpecialRow[]
  students: StudentRow[]
  classes: ClassRow[]
  teachers: TeacherRow[]
}

/**
 * 월별 통계 집계 — 범위 내 모든 달을 0으로 채워서 반환(오름차순).
 * 데이터가 없는 달도 빠지지 않아야 차트 x축이 끊기지 않는다.
 */
export function aggregateMonthlyStats(input: AggregateInput): MonthStat[] {
  const months = monthRange(input.from, input.to)
  if (months.length === 0) return []
  const inRange = new Set(months)
  const attr = buildAttribution(input.students, input.classes, input.teachers)

  interface Bucket {
    fee: number
    studentIds: Set<string>
    paid: number
    paidStudentIds: Set<string>
    special: number
    byMethod: Map<string, number>
    byTeacher: Map<string, { teacher_id: string | null; name: string; paid: number; fee: number; students: Set<string> }>
    bySubject: Map<string, { subject: string; paid: number; fee: number }>
  }
  const buckets = new Map<string, Bucket>()
  for (const m of months) {
    buckets.set(m, {
      fee: 0,
      studentIds: new Set(),
      paid: 0,
      paidStudentIds: new Set(),
      special: 0,
      byMethod: new Map(),
      byTeacher: new Map(),
      bySubject: new Map(),
    })
  }

  const teacherKey = (a: Attribution) => a.teacherId ?? `__none__:${a.teacherName}`

  for (const row of input.snapshots) {
    const b = buckets.get(row.month)
    if (!b) continue
    const fee = Number(row.fee) || 0
    b.fee += fee
    b.studentIds.add(row.student_id)
    const a = attr.get(row.student_id) ?? FALLBACK_ATTR
    const tk = teacherKey(a)
    const t = b.byTeacher.get(tk) ?? { teacher_id: a.teacherId, name: a.teacherName, paid: 0, fee: 0, students: new Set<string>() }
    t.fee += fee
    t.students.add(row.student_id)
    b.byTeacher.set(tk, t)
    const s = b.bySubject.get(a.subject) ?? { subject: a.subject, paid: 0, fee: 0 }
    s.fee += fee
    b.bySubject.set(a.subject, s)
  }

  for (const row of input.payments) {
    const b = buckets.get(row.billing_month)
    if (!b) continue
    const amount = Number(row.amount) || 0
    b.paid += amount
    b.paidStudentIds.add(row.student_id)
    const method = row.method || 'other'
    b.byMethod.set(method, (b.byMethod.get(method) ?? 0) + amount)
    const a = attr.get(row.student_id) ?? FALLBACK_ATTR
    const tk = teacherKey(a)
    const t = b.byTeacher.get(tk) ?? { teacher_id: a.teacherId, name: a.teacherName, paid: 0, fee: 0, students: new Set<string>() }
    t.paid += amount
    b.byTeacher.set(tk, t)
    const s = b.bySubject.get(a.subject) ?? { subject: a.subject, paid: 0, fee: 0 }
    s.paid += amount
    b.bySubject.set(a.subject, s)
  }

  for (const row of input.specials) {
    const month = kstMonthOf(row.paid_at) ?? kstMonthOf(row.created_at)
    if (!month || !inRange.has(month)) continue
    const b = buckets.get(month)
    if (!b) continue
    b.special += Number(row.amount) || 0
  }

  return months.map(month => {
    const b = buckets.get(month)!
    return {
      month,
      fee: b.fee,
      studentCount: b.studentIds.size,
      paid: b.paid,
      paidCount: b.paidStudentIds.size,
      special: b.special,
      byMethod: Object.fromEntries([...b.byMethod.entries()].sort((x, y) => y[1] - x[1])),
      byTeacher: [...b.byTeacher.values()]
        .map(t => ({ teacher_id: t.teacher_id, name: t.name, paid: t.paid, fee: t.fee, studentCount: t.students.size }))
        .sort((x, y) => y.paid - x.paid || y.fee - x.fee || x.name.localeCompare(y.name)),
      bySubject: [...b.bySubject.values()]
        .sort((x, y) => y.paid - x.paid || y.fee - x.fee || x.subject.localeCompare(y.subject)),
    }
  })
}
