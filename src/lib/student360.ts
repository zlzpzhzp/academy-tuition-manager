// 학생 360 (원비 이식판, 2026-08-20) — 순수 헬퍼 + 응답 타입.
// 원본: 쌤 src/lib/student360.ts (그쪽 원본은 워라 /api/spine/student360 각색).
// 쌤 판과의 차이:
//   ① 축이 원비 학생(tuition_students.id) 이다 — 쌤은 dm_students 가 축이었다.
//   ② 열람 권한 판정(student360Access) 제거 — 원비는 관리자 단일 세션(requireAdminSession)이라
//      반 스코핑 개념 자체가 없다. 전체 명단(퇴원 포함)을 본다.
//   ③ 날짜 표기는 date-fns 대신 KST 안전 순수 함수(formatKstDate) — 원비는 UTC 함정 금지 규칙이 있고
//      timestamptz/date 가 섞여 들어온다.
// ⚠️ 타앱 테이블(dm_*·qa_*·memos·students·student_notes)은 SELECT 전용 — 이 기능 어디에서도 write 금지.
// ⚠️ 리텐션·이탈 경보류 파생 지표 금지(교실 불가침) — 사실 나열만.

// --- 응답 타입 ---
/** qa_submissions / dm_class_progress_parsed / memos 는 이름 텍스트뿐 — 이름 기반 매칭임을 화면에 고지한다. */
export interface Student360Response {
  sections: {
    identity: IdentitySection
    classes: ClassesSection
    grades: GradesSection
    qa: QaSection
    consultations: ConsultationsSection
    callLogs: CallLogSection
  }
}

export interface IdentitySection {
  name: string
  school: string | null
  /** 원비 기준 재원/퇴원 (withdrawal_date 로 판정 — status 컬럼은 good/caution/warning 이라 다른 축) */
  enrollmentStatus: '재원' | '퇴원'
  enrollmentDate: string | null
  withdrawalDate: string | null
  /** 쌤(dm_classes) 반 — 원비엔 없는 정보라 여기서만 볼 수 있다 */
  dmClassName: string | null
  /** 담당 선생님 (dm_teachers) */
  teacherName: string | null
  /** 쌤 상태 (good/caution/warning) */
  dmStatus: string | null
  /** 원비는 과목별 1행 구조 — 이 사람(이름+학부모번호 동일)의 과목 행 전부 */
  enrollments: EnrollmentRow[]
  note: string | null
}

export interface EnrollmentRow {
  subjectLabel: string // "수학H" 등 (formatClassName), 미상이면 '반 미상'
  status: '재원' | '퇴원'
}

export interface ProgressEntry {
  subject: string | null
  className: string | null
  submittedAt: string | null
  items: string[] // 표시용 문자열 (formatProgressItem)
}

export interface ClassesSection {
  className: string | null // 쌤(dm_classes) 반 이름
  schedule: string | null
  progress: ProgressEntry[]
  nameBased: boolean // 진도는 이름 텍스트 매칭 폴백 — 동명·오타 위험 고지
  note: string | null
}

export interface QaItem {
  id: number
  className: string | null
  studentName: string
  content: string
  createdAt: string
}

export interface QaSection {
  nameBased: true
  matchedNames: string[]
  items: QaItem[]
  note: string | null
}

/** 성적 — dm_school_grades(학교 내신) + dm_grades(학원 시험). 둘 다 student_id 가 원비 id 체계. */
export interface SchoolGradeItem {
  year: number | null
  semester: number | null
  examType: string | null
  score: number | string | null
  notes: string | null
}

export interface AcademyGradeItem {
  examName: string | null
  subject: string | null
  score: number | null
  total: number | null
  createdAt: string | null
}

export interface GradesSection {
  school: SchoolGradeItem[]
  academy: AcademyGradeItem[]
  note: string | null
}

/** 신규 상담 (dm_consultations) — tuition_student_id 직결 우선, 미연결 행은 이름+학부모번호 보조 매칭. */
export interface ConsultationItem {
  status: string | null
  gradeLabel: string | null
  school: string | null
  progress: string | null
  memo: string | null
  firstVisitAt: string | null
  enrolledAt: string | null
  createdAt: string | null
  matchedBy: 'link' | 'phone' // link=tuition_student_id 직결, phone=이름+학부모번호 일치
}

export interface ConsultationsSection {
  items: ConsultationItem[]
  note: string | null
}

/**
 * 전화·기타 상담 — 전용 테이블 없음. student_call_logs(구조화 원장) + student_notes(워라 students.id
 * 체계라 students.tuition_student_id 로 역추적) + memos(학생 연결 컬럼 없음 → 이름 ilike).
 * 동명이인(같은 이름·다른 학부모번호)은 memos 검색을 스킵한다(오귀속 방지).
 */
export interface NoteItem {
  category: string | null
  title: string | null
  content: string | null
  noteDate: string | null
}

export interface MemoItem {
  title: string | null
  snippet: string // 개인정보 성격 — 앞부분 요약만 (memoSnippet)
  memoType: string | null
  createdAt: string
}

export interface CallLogSection {
  notes: NoteItem[]
  memos: MemoItem[]
  memosSkipped: boolean // 동명이인이라 memos 자동 검색을 스킵했는가
  nameBased: true
  note: string | null
}

// --- 순수 헬퍼 ---

/** tuition_students.id 는 uuid — 형식이 아니면 Postgres 가 22P02 로 죽어 500 이 된다. 라우트에서 400 으로 컷. */
export function isUuid(v: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((v ?? '').trim())
}

/**
 * 질문앱 매칭에 쓸 이름 후보: 원비 이름 + student_aliases 표기들.
 * 공백 트림·중복 제거. 빈 이름은 제외(빈 문자열로 in-필터하면 무의미 매칭).
 */
export function qaNameCandidates(name: string | null | undefined, aliases: string[]): string[] {
  const out: string[] = []
  for (const raw of [name ?? '', ...aliases]) {
    const v = raw.trim()
    if (v && !out.includes(v)) out.push(v)
  }
  return out
}

/** dm_class_progress_parsed.items 원소 (실측: {"n":null,"p":null,"t":"자이스토리","label":"B165"}) */
export interface RawProgressItem {
  n?: number | null // 문항 번호
  p?: number | null // 페이지
  t?: string | null // 교재명
  label?: string | null // 표기 원문
}

/** 진도 항목 1개 → 표시 문자열. 알 수 없는 형태여도 빈 문자열은 안 낸다. */
export function formatProgressItem(item: RawProgressItem | null | undefined): string {
  if (!item) return '-'
  const parts: string[] = []
  if (item.t?.trim()) parts.push(item.t.trim())
  if (item.label?.trim()) parts.push(item.label.trim())
  else if (item.p != null) parts.push(`p.${item.p}`)
  else if (item.n != null) parts.push(`${item.n}번`)
  return parts.length ? parts.join(' ') : '-'
}

/** dm_classes.schedule (실측: jsonb {"days":[2,4,6]}, 0=일~6=토) → "화·목·토" */
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']
export function formatDmSchedule(schedule: unknown): string | null {
  if (!schedule || typeof schedule !== 'object') return null
  const days = (schedule as { days?: unknown }).days
  if (!Array.isArray(days) || days.length === 0) return null
  const names = days
    .filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
    .map(d => DAY_NAMES[d])
  return names.length ? names.join('·') : null
}

/**
 * 동명이인 판정 — 원비에서 같은 이름의 학부모번호가 2종 이상이면 다른 사람이 섞인 이름.
 * (원비 구조: 같은 사람 = 같은 name+parent_phone 의 과목별 행 — 번호가 다르면 남이다.)
 * 이 경우 이름 폴백 조인(memos·진도·질문)은 스킵한다: 남의 기록이 붙는 게 빈 것보다 나쁘다.
 */
export function isAmbiguousName(parentPhones: (string | null | undefined)[]): boolean {
  const distinct = new Set(parentPhones.map(p => (p ?? '').trim()).filter(Boolean))
  return distinct.size > 1
}

/** 학교 내신 시험 라벨: (2026, 1, '중간고사') → "2026년 1학기 중간고사" */
export function schoolExamLabel(year: number | null, semester: number | null, examType: string | null): string {
  const parts: string[] = []
  if (year != null) parts.push(`${year}년`)
  if (semester != null) parts.push(`${semester}학기`)
  if (examType?.trim()) parts.push(examType.trim())
  return parts.length ? parts.join(' ') : '-'
}

/** memos 개인정보 축약: 줄바꿈 정리 + 앞 maxLen 자만 (화면에서 2줄 클램프 추가) */
export function memoSnippet(content: string | null | undefined, maxLen = 160): string {
  const flat = (content ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  return flat.length > maxLen ? `${flat.slice(0, maxLen)}…` : flat
}

/**
 * ilike or() 필터에 넣을 이름 정리 — PostgREST or() 구문 예약문자(콤마·괄호)와
 * ilike 와일드카드(%·_)를 제거. 한국어 이름엔 원래 없지만 방어적으로.
 */
export function sanitizeIlikeName(name: string): string {
  return name.replace(/[%_,()]/g, '').trim()
}

/**
 * 스키마 결손(테이블 없음 PGRST205 / 컬럼 없음 42703) 판별:
 * 교차앱 테이블이 아직 없거나 바뀐 환경에서 500 이 아니라 "미연결" 강등용.
 */
export function isMissingSchemaError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === 'PGRST205' || err.code === '42703') return true
  const msg = err.message ?? ''
  return msg.includes('does not exist') || msg.includes('schema cache')
}

/**
 * 표시용 날짜 — "2026.8.20".
 * 🔴 UTC 함정 금지(전앱 룰): `new Date(iso).toISOString()` 류로 자르면 KST 와 하루 어긋난다.
 *  · `YYYY-MM-DD`(date 컬럼)처럼 타임존이 없는 값은 **변환하지 않고** 그대로 읽는다(변환이 곧 오차).
 *  · 오프셋(Z / +09:00)이 붙은 timestamptz 만 +9h 시프트해서 KST 벽시계로 읽는다.
 */
export function formatKstDate(iso: string | null | undefined): string {
  const s = (iso ?? '').trim()
  if (!s) return '-'
  const hasOffset = /([Zz]|[+-]\d{2}:?\d{2})$/.test(s)
  if (!hasOffset) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
    return m ? `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` : s
  }
  const t = Date.parse(s)
  if (Number.isNaN(t)) return s
  const kst = new Date(t + 9 * 60 * 60 * 1000)
  return `${kst.getUTCFullYear()}.${kst.getUTCMonth() + 1}.${kst.getUTCDate()}`
}
