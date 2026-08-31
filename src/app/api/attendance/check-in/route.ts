/**
 * 키오스크 등하원 처리 API
 * - 인증 우회 (학원 내부 태블릿용, middleware 화이트리스트)
 * - rate limit (POST 분당 200건은 middleware 처리)
 * - 코드 → 학생 식별 → tuition_attendance upsert + 솔라피 알림톡 발송 (심사 통과 후)
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { validateInput, rules } from '@/lib/validate'
import { todaysSubjectsLabel } from '@/lib/format'

interface CheckInBody {
  code?: string
  action?: 'check_in' | 'check_out'
}

// 서버 TZ가 KST가 아닐 수 있음(Vercel=UTC). UTC+9 shift 후 getUTC* 로 KST 벽시계 직접 계산.
// (구버전은 이름만 Kst, 실제론 로컬TZ → 등하원 시각이 9시간 어긋나 표시됨. 2026-06-17 9app-review P0 fix)
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

// 무효 코드 시도 쿨다운 (2026-07-10 전수점검): 4자리 코드 전수 스캔으로 출결 위조/이름 열거를
// 시도하는 경우를 차단. 유효 코드 입력(정상 등하원)은 카운트하지 않으므로 실사용 무영향.
// 사용자의 "이름조회 비민감" 결정(0c14361)은 존중 — 정상 조회는 제한 없음, '연속 실패'만 제한.
const invalidAttempts = new Map<string, number[]>()
function invalidCodeBlocked(ip: string): boolean {
  const now = Date.now()
  const stamps = (invalidAttempts.get(ip) ?? []).filter(t => now - t < 5 * 60_000)
  invalidAttempts.set(ip, stamps)
  if (invalidAttempts.size > 5000) invalidAttempts.clear()
  // 30회/5분 — 키오스크는 태블릿 1대(IP 1개)를 전교생이 공유하므로 등원 러시 오타를 감안해
  // 여유있게. 그래도 4자리 전수(10,000개) 스캔엔 28시간+ 걸려 실효 차단.
  return stamps.length >= 30
}
function recordInvalidCode(ip: string) {
  const stamps = invalidAttempts.get(ip) ?? []
  stamps.push(Date.now())
  invalidAttempts.set(ip, stamps)
}
function clientIp(request: NextRequest): string {
  return request.headers.get('cf-connecting-ip')?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown'
}

function todayKstString(): string {
  const kst = new Date(Date.now() + KST_OFFSET_MS)
  return kst.toISOString().slice(0, 10)
}

function nowKstHHmm(): string {
  const kst = new Date(Date.now() + KST_OFFSET_MS)
  return `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`
}


export async function POST(request: NextRequest) {
  let body: CheckInBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 })
  }

  const validationError = validateInput([
    rules.requiredString('code', body.code),
    rules.requiredString('action', body.action),
  ])
  if (validationError) return validationError

  const code = String(body.code).trim()
  const action = body.action!
  if (!/^\d{4}$/.test(code)) {
    return NextResponse.json({ error: '출결번호는 4자리 숫자여야 합니다' }, { status: 400 })
  }
  const ip = clientIp(request)
  if (invalidCodeBlocked(ip)) {
    return NextResponse.json({ error: '잘못된 번호 시도가 많습니다. 잠시 후 다시 시도하세요' }, { status: 429 })
  }
  if (action !== 'check_in' && action !== 'check_out') {
    return NextResponse.json({ error: 'action은 check_in 또는 check_out' }, { status: 400 })
  }

  // 학생 식별 (활성 학생만)
  const { data: students, error: studentError } = await supabase
    .from('tuition_students')
    .select('id, name, class_id, parent_phone, parent_father_phone, attendance_recipient, phone, withdrawal_date')
    .eq('attendance_code', code)
    .is('withdrawal_date', null)
  if (studentError) {
    return NextResponse.json({ error: studentError.message }, { status: 500 })
  }
  if (!students || students.length === 0) {
    recordInvalidCode(ip)
    return NextResponse.json({ error: '등록되지 않은 번호입니다' }, { status: 404 })
  }

  // 같은 학생 여러 반 등록된 경우(같은 이름) → 학생 1명으로 묶음 처리, 출결 row 1개만
  const firstStudent = students[0]
  const sameName = students.filter(s => s.name === firstStudent.name)
  const studentName = firstStudent.name
  const studentId = firstStudent.id

  const date = todayKstString()
  const nowIso = new Date().toISOString()
  const timeText = nowKstHHmm()

  // 두 과목 수강생 — 이 출결이 어느 과목 수업인지 note에 남긴다 (2026-08-31 운영자님 지시:
  // "나중에 샘들이 확인할때 알아볼 수 있게 정리". 키오스크 조작·알림톡 무변경, 기록 주석 전용).
  // 판정 실패는 무시 — 주석은 best-effort, 출결 자체를 막지 않는다.
  let subjectNote: string | null = null
  try {
    if (firstStudent.parent_phone) {
      const { data: personRows } = await supabase
        .from('tuition_students')
        .select('class_id')
        .eq('name', firstStudent.name)
        .eq('parent_phone', firstStudent.parent_phone)
        .is('withdrawal_date', null)
      const classIds = (personRows ?? []).map(r => r.class_id).filter((v): v is string => !!v)
      if (classIds.length >= 2) {
        const { data: classes } = await supabase
          .from('tuition_classes')
          .select('subject, class_days')
          .in('id', classIds)
        const weekday = new Date(`${date}T00:00:00`).getDay() // TZ=Asia/Seoul (instrumentation)
        subjectNote = todaysSubjectsLabel(
          (classes ?? []).map(c => ({ subject: c.subject, classDays: c.class_days })), weekday)
      }
    }
  } catch (e) {
    console.error('[attendance] 과목 주석 판정 실패(출결은 계속):', e instanceof Error ? e.message : String(e))
  }

  // 오늘 출결 row 확인 (학생 1번 row 기준)
  const { data: existing } = await supabase
    .from('tuition_attendance')
    .select('id, status, check_in_time, check_out_time, note')
    .eq('student_id', studentId)
    .eq('date', date)
    .maybeSingle()

  if (action === 'check_in') {
    if (existing?.check_in_time) {
      return NextResponse.json({
        ok: false,
        message: `${studentName} 학생은 이미 등원 체크되었습니다 (${new Date(existing.check_in_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })})`,
        student: { name: studentName },
      })
    }
    if (existing) {
      const { error } = await supabase
        .from('tuition_attendance')
        // 사람이 쓴 기존 메모는 덮지 않는다 — 비어 있을 때만 과목 주석
        .update({ status: 'present', check_in_time: nowIso, updated_at: nowIso, ...(subjectNote && !existing.note ? { note: subjectNote } : {}) })
        .eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const { error } = await supabase
        .from('tuition_attendance')
        .insert({ student_id: studentId, date, status: 'present', check_in_time: nowIso, ...(subjectNote ? { note: subjectNote } : {}) })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } else {
    // check_out
    if (existing?.check_out_time) {
      return NextResponse.json({
        ok: false,
        message: `${studentName} 학생은 이미 하원 체크되었습니다 (${new Date(existing.check_out_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })})`,
        student: { name: studentName },
      })
    }
    if (existing) {
      const { error } = await supabase
        .from('tuition_attendance')
        .update({ check_out_time: nowIso, updated_at: nowIso })
        .eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      // 등원 없이 하원 — 학생이 다른 곳에서 등원 처리됐을 수도. status='present'로 행 생성하고 check_out만 기록
      const { error } = await supabase
        .from('tuition_attendance')
        .insert({ student_id: studentId, date, status: 'present', check_out_time: nowIso, ...(subjectNote ? { note: subjectNote } : {}) })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  // 솔라피 알림톡 — fire-and-forget. 응답 지연 방지(학원 출퇴근 빠른 흐름).
  // 카카오 API 200~2000ms 소요 → 응답에 포함시키면 키오스크 체감 느림. 백그라운드 처리.
  const tplId = action === 'check_in'
    ? process.env.SOLAPI_TEMPLATE_CHECKIN
    : process.env.SOLAPI_TEMPLATE_CHECKOUT
  // 출결 알림 수신자 — attendance_recipient 설정(기본 어머니). 아버지 선택인데 부 번호 없으면 어머니로 fallback
  const parentPhone = firstStudent.attendance_recipient === 'father'
    ? (firstStudent.parent_father_phone || firstStudent.parent_phone || '')
    : (firstStudent.parent_phone || '')
  if (tplId && parentPhone && process.env.SOLAPI_API_KEY) {
    void (async () => {
      try {
        const { sendAlimtalk } = await import('@/lib/solapi')
        await sendAlimtalk({
          to: parentPhone,
          templateId: tplId,
          variables: { 학생명: studentName, 시간: timeText },
        })
      } catch (e) {
        console.error('[attendance] alimtalk fail', studentName, e instanceof Error ? e.message : String(e))
      }
    })()
  }

  // 내부 UUID·attendance row는 무인증 키오스크 응답에 노출하지 않음 (GET은 7/4 보안스윕에서 제거, POST도 통일)
  return NextResponse.json({
    ok: true,
    action,
    student: {
      name: studentName,
      classCount: sameName.length,
    },
    time: timeText,
  })
}

/** 학생 조회 (코드 → 이름) — 키오스크에서 입력 중 미리보기용 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  if (!code || !/^\d{4}$/.test(code)) {
    return NextResponse.json({ error: '4자리 숫자 코드 필요' }, { status: 400 })
  }
  const ip = clientIp(request)
  if (invalidCodeBlocked(ip)) {
    return NextResponse.json({ student: null }, { status: 429 })
  }
  const { data, error } = await supabase
    .from('tuition_students')
    .select('id, name, class_id')
    .eq('attendance_code', code)
    .is('withdrawal_date', null)
    .limit(1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    recordInvalidCode(ip)
    return NextResponse.json({ student: null }, { status: 200 })
  }
  // UUID 미노출 (보안스윕 2026-07-04): 내부 student id는 IDOR pivot 재료라 미리보기 응답서 제거.
  // 미리보기는 이름만 필요(프론트도 name만 사용). 열거는 위 미들웨어 레이트리밋으로 이미 차단.
  return NextResponse.json({ student: { name: data[0].name } })
}
