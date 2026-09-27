import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// DB와 외부 HTTP만 대역. 실제 라우트·솔라피 함수가 만든 발송 요청을 검증한다.
const sendRequest = vi.fn()
const writes: unknown[] = []
let student: Record<string, unknown>
let existing: Record<string, unknown> | null
let classDays: string
let writeError: { message: string } | null
function builder(table: string) {
  let columns = '*'
  let writing = false
  const b: Record<string, unknown> = {}
  b.select = (value: string) => { columns = value; return b }
  for (const method of ['eq', 'is', 'in']) b[method] = () => b
  for (const method of ['insert', 'update']) b[method] = (row: unknown) => { writing = true; writes.push(row); return b }
  const result = () => {
    if (writing) return { data: null, error: writeError }
    if (table === 'tuition_students') {
      const row = Object.fromEntries(columns.split(',').map(key => [key.trim(), student[key.trim()]]))
      return { data: [row], error: null }
    }
    if (table === 'tuition_classes') return { data: [{ subject: '합성과목', class_days: classDays }], error: null }
    if (table === 'tuition_attendance') return { data: existing, error: null }
    throw new Error(`예상하지 않은 테이블: ${table}`)
  }
  b.maybeSingle = async () => result()
  b.then = (resolve: (value: unknown) => void) => resolve(result())
  return b
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => builder(table) } }))
import { POST } from '@/app/api/attendance/check-in/route'

// 합성 번호만 사용한다.
const MOTHER = '01000000001'
const FATHER = '01000000002'
const EXTRA = '01000000003'
const post = (action = 'check_in', confirm = false) => POST(new NextRequest('http://localhost/api/attendance/check-in', {
  method: 'POST', body: JSON.stringify({ code: '0001', action, confirm }),
}))
const flushSends = async () => { await vi.dynamicImportSettled() }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-16T06:04:00Z'))
  vi.stubEnv('SOLAPI_API_KEY', 'synthetic-key')
  vi.stubEnv('SOLAPI_API_SECRET', 'synthetic-secret')
  vi.stubEnv('SOLAPI_FROM', '01000000000')
  vi.stubEnv('SOLAPI_PFID', 'synthetic-profile')
  vi.stubEnv('SOLAPI_TEMPLATE_CHECKIN', 'synthetic-checkin')
  vi.stubEnv('SOLAPI_TEMPLATE_CHECKOUT', 'synthetic-checkout')
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (url !== 'https://api.solapi.com/messages/v4/send') throw new Error('예상하지 않은 HTTP 요청')
    return sendRequest(JSON.parse(String(init?.body)).message)
  }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  sendRequest.mockReset().mockImplementation(async () => new Response(JSON.stringify({ groupId: 'synthetic' })))
  student = { id: 'synthetic-student', name: '합성학생', class_id: 'synthetic-class',
    parent_phone: '010-0000-0001', parent_father_phone: FATHER, attendance_recipient: 'mother',
    attendance_extra_phone: null, phone: '010-0000-0004', withdrawal_date: null }
  existing = null
  classDays = '0,1,2,3,4,5,6'
  writeError = null
  writes.length = 0
})
afterEach(async () => {
  await flushSends()
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})

describe.each(['check_in', 'check_out'])('%s 추가 수신자', action => {
  it.each([undefined, null, ''])('추가 번호 %s이면 기존 수신자에게 1회만 발송', async extra => {
    student.attendance_extra_phone = extra
    const response = await post(action)
    expect(await response.json()).toEqual({ ok: true, action, time: '15:04', student: { name: '합성학생', classCount: 1 } })
    await flushSends()
    expect(sendRequest).toHaveBeenCalledExactlyOnceWith({ to: MOTHER, from: '01000000000',
      kakaoOptions: { pfId: 'synthetic-profile',
        templateId: action === 'check_in' ? 'synthetic-checkin' : 'synthetic-checkout',
        variables: { '#{학생명}': '합성학생', '#{시간}': '15:04' } } })
  })

  it('추가 번호가 있으면 같은 템플릿·변수로 각 번호에 정확히 1회 발송', async () => {
    student.attendance_extra_phone = EXTRA
    await post(action); await flushSends()
    expect(console.error).not.toHaveBeenCalled()
    const common = { from: '01000000000', kakaoOptions: { pfId: 'synthetic-profile',
      templateId: action === 'check_in' ? 'synthetic-checkin' : 'synthetic-checkout',
      variables: { '#{학생명}': '합성학생', '#{시간}': '15:04' } } }
    expect(sendRequest.mock.calls.map(([message]) => message)).toEqual([
      { to: MOTHER, ...common }, { to: EXTRA, ...common },
    ])
  })

  it.each(['01000000001', '010 (0000) 0001'])('숫자만 비교하면 같은 추가 번호 %s는 중복 발송하지 않음', async extra => {
    student.attendance_extra_phone = extra
    await post(action); await flushSends()
    expect(sendRequest).toHaveBeenCalledOnce()
    expect(sendRequest.mock.calls[0][0].to).toBe(MOTHER)
  })

  it.each(['primary', 'extra'])('%s 실패가 다른 수신자 발송을 막지 않으며 실패 구분을 남김', async role => {
    student.attendance_extra_phone = EXTRA
    sendRequest.mockImplementation(async ({ to }: { to: string }) => {
      if (to === (role === 'primary' ? MOTHER : EXTRA)) throw new Error('합성 발송 실패')
      return new Response(JSON.stringify({ groupId: 'synthetic' }))
    })
    const response = await post(action)
    expect(response.status).toBe(200)
    await flushSends()
    expect(sendRequest.mock.calls.map(([message]) => message.to)).toEqual([MOTHER, EXTRA])
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[attendance] alimtalk fail', '합성학생', role, '합성 발송 실패')
  })

  it('양쪽 발송 미완료 상태에서도 출결 응답이 반환되고 두 발송 모두 시작됨', async () => {
    student.attendance_extra_phone = EXTRA
    const releases: (() => void)[] = []
    sendRequest.mockImplementation(() => new Promise<Response>(resolve => {
      releases.push(() => resolve(new Response(JSON.stringify({ groupId: 'synthetic' }))))
    }))
    try {
      const response = await post(action)
      expect(response.status).toBe(200)
      await flushSends()
      expect(sendRequest.mock.calls.map(([message]) => message.to)).toEqual([MOTHER, EXTRA])
    } finally { releases.forEach(resolve => resolve()) }
  })
})

describe.each([null, ''])('아버지 선택+부 번호 %s 폴백', father => {
  it.each([null, EXTRA, '01000000001'])('추가 번호 %s와 무관하게 어머니로 폴백하고 중복은 제거', async extra => {
    Object.assign(student, { attendance_recipient: 'father', parent_father_phone: father, attendance_extra_phone: extra })
    await post(); await flushSends()
    expect(sendRequest.mock.calls.map(([message]) => message.to)).toEqual(extra === EXTRA ? [MOTHER, EXTRA] : [MOTHER])
  })
})
it('아버지를 선택하면 부 번호와 추가 번호에 발송하며 어머니 번호를 추가 번호로도 허용', async () => {
  Object.assign(student, { attendance_recipient: 'father', attendance_extra_phone: MOTHER })
  await post(); await flushSends()
  expect(sendRequest.mock.calls.map(([message]) => message.to)).toEqual([FATHER, MOTHER])
})
it('선택한 아버지 번호와 추가 번호가 정규화 후 같으면 1회만 발송', async () => {
  Object.assign(student, { attendance_recipient: 'father', attendance_extra_phone: '010-0000-0002' })
  await post(); await flushSends()
  expect(sendRequest.mock.calls.map(([message]) => message.to)).toEqual([FATHER])
})
it('기존 수신자 설정이 누락되면 어머니가 기본값', async () => {
  delete student.attendance_recipient
  await post(); await flushSends()
  expect(sendRequest.mock.calls.map(([message]) => message.to)).toEqual([MOTHER])
})
it('어머니·추가 번호가 없으면 아버지·학생 번호로 임의 발송하지 않음', async () => {
  student.parent_phone = null
  await post(); await flushSends()
  expect(sendRequest).not.toHaveBeenCalled()
})
it('기본 수신 번호가 없어도 추가 번호에 발송하고 학생·부 번호로 새 폴백하지 않음', async () => {
  Object.assign(student, { parent_phone: null, attendance_extra_phone: EXTRA })
  await post(); await flushSends()
  expect(sendRequest).toHaveBeenCalledOnce()
  expect(sendRequest.mock.calls[0][0].to).toBe(EXTRA)
})
it.each(['SOLAPI_API_KEY', 'SOLAPI_TEMPLATE_CHECKIN'])('%s 없으면 양쪽 발송 없음', async key => {
  student.attendance_extra_phone = EXTRA
  vi.stubEnv(key, '')
  await post(); await flushSends()
  expect(sendRequest).not.toHaveBeenCalled()
})
it.each(['수업일 확인', '이미 등원', '저장 실패'])('%s 가드가 추가 발송도 차단', async guard => {
  student.attendance_extra_phone = EXTRA
  if (guard === '수업일 확인') classDays = '1'
  if (guard === '이미 등원') existing = { id: 'existing', check_in_time: '2026-09-16T05:00:00Z' }
  if (guard === '저장 실패') writeError = { message: '합성 저장 실패' }
  const response = await post()
  const body = await response.json()
  expect(guard === '저장 실패' ? response.status : body.ok).toBe(guard === '저장 실패' ? 500 : false)
  await flushSends()
  expect(sendRequest).not.toHaveBeenCalled()
  if (guard !== '저장 실패') expect(writes).toHaveLength(0)
})
