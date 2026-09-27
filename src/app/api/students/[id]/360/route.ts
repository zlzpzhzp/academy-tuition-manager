import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { formatClassName } from '@/lib/format'
import {
  Student360Response,
  qaNameCandidates,
  formatProgressItem,
  formatDmSchedule,
  isMissingSchemaError,
  isAmbiguousName,
  isUuid,
  memoSnippet,
  sanitizeIlikeName,
  RawProgressItem,
  ProgressEntry,
  QaItem,
  EnrollmentRow,
  SchoolGradeItem,
  AcademyGradeItem,
  ConsultationItem,
  NoteItem,
  MemoItem,
} from '@/lib/student360'

// 학생 360 (원비판, 2026-08-20) — GET /api/students/[id]/360
// 이 앱의 학생(tuition_students.id)을 축으로 강사 앱(반·담당·진도)·질문(제출)·성적·상담을 한 화면에 모은다.
// 원본은 강사 앱 src/app/api/students/[id]/360/route.ts — 4앱이 같은 Supabase 프로젝트라 그쪽 API 를
// 원격 호출하지 않고(인증 경계를 넘기지 않는다) 여기서 같은 테이블을 service_role 로 직접 읽는다.
//
// 🔒 권한: 이 앱은 관리자 단일 세션이라 requireAdminSession 만. 강사 앱의 반 스코핑(student360Access)은
//   여기 개념이 없어 제거했다 — 이 앱은 원래 전체 명단(퇴원 포함)을 다루는 앱이다.
// 🚫 읽기 전용 — 이 라우트는 SELECT 만 한다. write 추가 금지(타앱 테이블은 그 앱이 source of truth).
// ⚠️ 재원 필터 없음: 퇴원생(withdrawal_date NOT NULL)도 그대로 조회된다(퇴원 행은 홈페이지 앱 성적 표시가
//   의존하는 정본이기도 하다).
// ⚠️ 이름 기반 매칭(진도·질문·memos)은 동명이인이면 오귀속된다 → isAmbiguousName 이면 id 귀속 행만 남긴다.

interface DbErr { code?: string; message?: string }

// 교차앱 조회 공통: 한 섹션의 실패가 전체 500 이 되지 않게 에러를 값으로 강등.
async function soft<T>(q: PromiseLike<{ data: T | null; error: DbErr | null }>): Promise<{ data: T | null; note: string | null }> {
  const { data, error } = await q
  if (!error) return { data, note: null }
  if (isMissingSchemaError(error)) return { data: null, note: null } // 스키마 결손 — 조용히 미연결 처리
  console.error(`[student360] 섹션 조회 실패: ${error.code ?? ''} ${error.message ?? ''}`)
  return { data: null, note: '조회 실패(일시적일 수 있음)' }
}

const NONE = Promise.resolve({ data: null, note: null })

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  const { id } = await params
  // uuid 가 아니면 Postgres 가 22P02 로 죽어 500 이 된다 — 형식 오류는 400 으로 컷.
  if (!isUuid(id)) return NextResponse.json({ error: '학생 id 형식이 올바르지 않습니다' }, { status: 400 })

  // 1) 원비 기준행 (축). 퇴원 여부와 무관하게 조회한다.
  const { data: student, error: studentErr } = await supabase
    .from('tuition_students')
    .select('id, name, parent_phone, class_id, school, status, enrollment_date, withdrawal_date')
    .eq('id', id)
    .maybeSingle()
  if (studentErr) return NextResponse.json({ error: studentErr.message }, { status: 500 })
  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 })

  const name: string = student.name
  const parentPhone: string | null = student.parent_phone ?? null

  // 2) 인물 스코프 확장 — 이 앱은 과목별 1행 구조(같은 사람 = 같은 name+parent_phone 행 전부).
  type PersonRow = { id: string; class_id: string | null; withdrawal_date: string | null }
  let personRows: PersonRow[] = [{ id: student.id, class_id: student.class_id ?? null, withdrawal_date: student.withdrawal_date ?? null }]
  if (name && parentPhone) {
    const siblings = await soft(
      supabase
        .from('tuition_students')
        .select('id, class_id, withdrawal_date')
        .eq('name', name)
        .eq('parent_phone', parentPhone)
    )
    const rows = (siblings.data as PersonRow[] | null) ?? []
    if (rows.length) personRows = rows
  }
  const personIds = personRows.map(r => r.id)
  const personIdList = personIds.join(',')

  // 3) 1차 병렬 — 과목(반) 라벨 · 강사 앱 학생행 · 질문앱 별칭 · 동명이인 판정.
  const [subjectClassRes, dmStudentRes, aliasRes, dupRes] = await Promise.all([
    personRows.some(r => r.class_id)
      ? soft(
          supabase
            .from('tuition_classes')
            .select('id, name, subject')
            .in('id', personRows.map(r => r.class_id).filter((v): v is string => !!v))
        )
      : NONE,
    // 강사 앱 학생행: dm_students.id = tuition_students.id 동일 체계(+ tuition_student_id 컬럼) — 둘 다 본다.
    soft(
      supabase
        .from('dm_students')
        .select('id, name, status, class_id, teacher_id, school, tuition_student_id')
        .or(`id.in.(${personIdList}),tuition_student_id.in.(${personIdList})`)
    ),
    soft(supabase.from('student_aliases').select('alias').in('tuition_student_id', personIds)),
    soft(supabase.from('tuition_students').select('parent_phone').eq('name', name)),
  ])

  type DmStudentRow = { id: string; name: string | null; status: string | null; class_id: string | null; teacher_id: string | null; school: string | null; tuition_student_id: string | null }
  const dmStudents = (dmStudentRes.data as DmStudentRow[] | null) ?? []
  // 반 배정이 있는 행 우선(같은 사람의 여러 행 중 정보가 실린 쪽), 없으면 첫 행.
  const dmStudent = dmStudents.find(s => s.class_id) ?? dmStudents[0] ?? null
  const aliases = ((aliasRes.data as { alias: string }[] | null) ?? []).map(a => a.alias)
  const dupPhones = ((dupRes.data as { parent_phone: string | null }[] | null) ?? []).map(r => r.parent_phone)
  // 판정 쿼리 실패(data=null — 성공한 0행은 []가 온다)면 dupPhones=[] → ambiguous=false 로
  // 오귀속 방지 가드가 조용히 풀린다('남의 기록이 붙는 게 빈 것보다 나쁘다' 역전) — 실패면 보수적으로 동명이인 취급.
  const dupCheckFailed = dupRes.data == null
  const ambiguous = dupCheckFailed || isAmbiguousName(dupPhones)

  const nameCandidates = qaNameCandidates(name, aliases)
  const trimmedName = name?.trim() || null

  // 4) 2차 병렬 — 강사 앱 반/담당, 이름 기반 조회(진도·질문), 성적, 상담, 학습관리 앱 학생 링크.
  const [
    dmClassRes,
    teacherRes,
    progressRes,
    qaRes,
    schoolGradesRes,
    academyGradesRes,
    consultLinkRes,
    consultPhoneRes,
    woraRes,
  ] = await Promise.all([
    dmStudent?.class_id
      ? soft(
          // dm_students ↔ dm_classes 는 FK 가 없어 embed 불가(PGRST200 실측) → 별도 조회
          supabase.from('dm_classes').select('id, name, schedule').eq('id', dmStudent.class_id).maybeSingle()
        )
      : NONE,
    dmStudent?.teacher_id
      ? soft(supabase.from('dm_teachers').select('name').eq('id', dmStudent.teacher_id).maybeSingle())
      : NONE,
    // 진도: id 귀속 우선(파싱 시 tuition_student_id 기입), 이름 폴백
    soft(
      supabase
        .from('dm_class_progress_parsed')
        .select('subject, class_name, submitted_at, items, tuition_student_id')
        .or(
          [
            `tuition_student_id.in.(${personIdList})`,
            // 동명이인이면 이름 폴백 절 자체를 뺀다 — 넣으면 남의 폴백 행이 limit 칸을 채우고
            // 응답 조립의 사후 필터가 그걸 지워 '기록 없음' 오표시가 된다(사후 필터는 이중 방어로 유지).
            !ambiguous && trimmedName ? `and(tuition_student_id.is.null,student_name.eq.${JSON.stringify(trimmedName)})` : '',
          ].filter(Boolean).join(',')
        )
        .order('submitted_at', { ascending: false })
        .limit(3)
    ),
    // 질문: uid 귀속 우선, 옛 행은 이름 폴백
    soft(
      supabase
        .from('qa_submissions')
        .select('id, class_name, student_name, content, created_at, tuition_student_id')
        .or(
          [
            `tuition_student_id.in.(${personIdList})`,
            !ambiguous && nameCandidates.length
              ? `and(tuition_student_id.is.null,student_name.in.(${nameCandidates.map(n => JSON.stringify(n)).join(',')}))`
              : '',
          ].filter(Boolean).join(',')
        )
        .order('created_at', { ascending: false })
        .limit(5)
    ),
    // 성적 — 둘 다 student_id 가 원비 id 체계. 다과목 행 전부.
    soft(
      supabase
        .from('dm_school_grades')
        .select('year, semester, exam_type, score, notes')
        .in('student_id', personIds)
        .order('year', { ascending: false })
        .order('semester', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(8)
    ),
    soft(
      supabase
        .from('dm_grades')
        .select('exam_name, subject, score, total, created_at')
        .in('student_id', personIds)
        .order('created_at', { ascending: false })
        .limit(8)
    ),
    // 신규 상담 — 1차: tuition_student_id 직결
    soft(
      supabase
        .from('dm_consultations')
        .select('id, status, grade_label, school, progress, memo, first_visit_at, enrolled_at, created_at')
        .in('tuition_student_id', personIds)
        .order('created_at', { ascending: false })
        .limit(5)
    ),
    // 보조: 미연결 행은 이름+학부모번호 동시 일치 (근거는 matchedBy 로 화면 표시)
    trimmedName && parentPhone
      ? soft(
          supabase
            .from('dm_consultations')
            .select('id, status, grade_label, school, progress, memo, first_visit_at, enrolled_at, created_at')
            .eq('student_name', trimmedName)
            .eq('parent_phone', parentPhone)
            .order('created_at', { ascending: false })
            .limit(5)
        )
      : NONE,
    // 학습관리 앱 학생 링크 — student_notes.student_id 는 학습관리 앱 students.id 체계. students.tuition_student_id 로 역추적.
    soft(supabase.from('students').select('id').in('tuition_student_id', personIds)),
  ])

  // 5) 3차 병렬 — 전화·기타 상담 (학습관리 앱 id·동명이인 판정에 의존)
  const woraIds = ((woraRes.data as { id: string }[] | null) ?? []).map(r => r.id)
  const ilikeName = trimmedName ? sanitizeIlikeName(trimmedName) : ''

  const [callLogRes, notesRes, memosRes] = await Promise.all([
    // 구조화 통화·상담 원장(상담 기록 도구가 학생을 식별해 append) — 이름검색보다 우선.
    soft(
      supabase
        .from('student_call_logs')
        .select('channel, occurred_at, summary, created_by')
        .in('tuition_student_id', personIds)
        .order('occurred_at', { ascending: false })
        .limit(10)
    ),
    woraIds.length
      ? soft(
          supabase
            .from('student_notes')
            .select('category, title, content, note_date')
            .in('student_id', woraIds)
            .order('note_date', { ascending: false })
            .limit(10)
        )
      : NONE,
    // memos 는 학생 연결 컬럼이 없다 → 이름 ilike. 동명이인이면 스킵(오귀속 방지).
    !ambiguous && ilikeName.length >= 2
      ? soft(
          supabase
            .from('memos')
            .select('title, content, memo_type, created_at')
            .or(`content.ilike.%${ilikeName}%,raw_text.ilike.%${ilikeName}%`)
            .order('created_at', { ascending: false })
            .limit(5)
        )
      : NONE,
  ])

  // --- 조립 ---
  const subjectClasses = (subjectClassRes.data as { id: string; name: string; subject: string | null }[] | null) ?? []
  const classById = new Map(subjectClasses.map(c => [c.id, c]))
  const enrollments: EnrollmentRow[] = personRows.map(r => {
    const cls = r.class_id ? classById.get(r.class_id) : null
    return {
      subjectLabel: cls ? (formatClassName(cls) || cls.name) : '반 미상',
      status: (r.withdrawal_date ? '퇴원' : '재원') as '재원' | '퇴원',
    }
  })

  type ProgressRow = { subject: string | null; class_name: string | null; submitted_at: string | null; items: RawProgressItem[] | null; tuition_student_id?: string | null }
  type QaRow = { id: number; class_name: string | null; student_name: string; content: string; created_at: string; tuition_student_id?: string | null }

  // 동명이인이면 이름 폴백 행(tuition_student_id null)은 버린다 — 남의 진도·질문이 붙는 게 빈 것보다 나쁘다.
  const progress: ProgressEntry[] = ((progressRes.data as ProgressRow[] | null) ?? [])
    .filter(p => !ambiguous || p.tuition_student_id != null)
    .map(p => ({
      subject: p.subject,
      className: p.class_name,
      submittedAt: p.submitted_at,
      items: (Array.isArray(p.items) ? p.items : []).map(formatProgressItem),
    }))

  const qaItems: QaItem[] = ((qaRes.data as QaRow[] | null) ?? [])
    .filter(q => !ambiguous || q.tuition_student_id != null)
    .map(q => ({
      id: q.id,
      className: q.class_name,
      studentName: q.student_name,
      content: q.content,
      createdAt: q.created_at,
    }))

  type SchoolGradeRow = { year: number | null; semester: number | null; exam_type: string | null; score: number | string | null; notes: string | null }
  type AcademyGradeRow = { exam_name: string | null; subject: string | null; score: number | null; total: number | null; created_at: string | null }
  const schoolGrades: SchoolGradeItem[] = ((schoolGradesRes.data as SchoolGradeRow[] | null) ?? []).map(r => ({
    year: r.year,
    semester: r.semester,
    examType: r.exam_type,
    score: r.score,
    notes: r.notes,
  }))
  const academyGrades: AcademyGradeItem[] = ((academyGradesRes.data as AcademyGradeRow[] | null) ?? []).map(r => ({
    examName: r.exam_name,
    subject: r.subject,
    score: r.score,
    total: r.total,
    createdAt: r.created_at,
  }))

  // 신규 상담 — 직결(link) 우선, 이름+번호(phone) 보조. id 로 중복 제거.
  type ConsultRow = { id: string; status: string | null; grade_label: string | null; school: string | null; progress: string | null; memo: string | null; first_visit_at: string | null; enrolled_at: string | null; created_at: string | null }
  const consultMap = new Map<string, ConsultationItem>()
  for (const [rows, matchedBy] of [
    [(consultLinkRes.data as ConsultRow[] | null) ?? [], 'link'],
    [(consultPhoneRes.data as ConsultRow[] | null) ?? [], 'phone'],
  ] as const) {
    for (const r of rows) {
      if (consultMap.has(r.id)) continue
      consultMap.set(r.id, {
        status: r.status,
        gradeLabel: r.grade_label,
        school: r.school,
        progress: r.progress,
        memo: r.memo,
        firstVisitAt: r.first_visit_at,
        enrolledAt: r.enrolled_at,
        createdAt: r.created_at,
        matchedBy,
      })
    }
  }
  const consultItems = Array.from(consultMap.values()).sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  )

  type NoteRow = { category: string | null; title: string | null; content: string | null; note_date: string | null }
  type MemoRow = { title: string | null; content: string | null; memo_type: string | null; created_at: string }
  type CallLogRow = { channel: string; occurred_at: string; summary: string; created_by: string }
  const noteItems: NoteItem[] = ((notesRes.data as NoteRow[] | null) ?? []).map(r => ({
    category: r.category,
    title: r.title,
    content: r.content,
    noteDate: r.note_date,
  }))
  const memoItems: MemoItem[] = ((memosRes.data as MemoRow[] | null) ?? []).map(r => ({
    title: r.title,
    snippet: memoSnippet(r.content),
    memoType: r.memo_type,
    createdAt: r.created_at,
  }))
  // 구조화 원장 항목은 확정 귀속이라 이름검색과 달리 배지 불요 — MemoItem 형태로 앞에 합류.
  const callLogItems: MemoItem[] = ((callLogRes.data as CallLogRow[] | null) ?? []).map(r => ({
    title: `[${r.channel}] 상담 기록 (${r.created_by})`,
    snippet: memoSnippet(r.summary),
    memoType: 'call-log',
    createdAt: r.occurred_at,
  }))

  // 강사 앱 반 표기 — dm_classes 엔 subject 가 없지만 tuition_classes 와 id 공유(실측) → classById 로 과목 병기.
  const dmClass = dmClassRes.data as { id: string; name: string; schedule: unknown } | null
  const dmClassLabel = (() => {
    if (!dmClass) return null
    const tc = classById.get(dmClass.id)
    return formatClassName({ name: dmClass.name, subject: tc?.subject ?? null }) || dmClass.name
  })()
  const teacherName = (teacherRes.data as { name: string } | null)?.name ?? null

  const body: Student360Response = {
    sections: {
      identity: {
        name,
        school: student.school ?? dmStudent?.school ?? null,
        enrollmentStatus: student.withdrawal_date ? '퇴원' : '재원',
        enrollmentDate: student.enrollment_date ?? null,
        withdrawalDate: student.withdrawal_date ?? null,
        dmClassName: dmClassLabel,
        teacherName,
        dmStatus: dmStudent?.status ?? null,
        enrollments,
        note: dmStudentRes.note ?? (dmStudent ? null : '강사 앱에 연결된 학생 행이 없습니다'),
      },
      classes: {
        className: dmClassLabel,
        schedule: formatDmSchedule(dmClass?.schedule),
        progress,
        nameBased: true,
        note: dmClassRes.note ?? progressRes.note,
      },
      grades: {
        school: schoolGrades,
        academy: academyGrades,
        note: schoolGradesRes.note ?? academyGradesRes.note,
      },
      qa: {
        nameBased: true,
        matchedNames: nameCandidates,
        items: qaItems,
        note: qaRes.note,
      },
      consultations: {
        items: consultItems,
        note: consultLinkRes.note ?? consultPhoneRes.note,
      },
      callLogs: {
        notes: noteItems,
        memos: [...callLogItems, ...memoItems],
        memosSkipped: ambiguous,
        nameBased: true,
        note:
          (dupCheckFailed ? '동명이인 판정 조회 실패 — 오귀속 방지를 위해 동명이인으로 간주(이름 기반 검색 스킵)' : null) ??
          (ambiguous ? '동명이인이라 메모(통화 기록) 자동 검색 불가 — 오귀속 방지' : null) ??
          notesRes.note ??
          memosRes.note,
      },
    },
  }

  return NextResponse.json(body)
}
