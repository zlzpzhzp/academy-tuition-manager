// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cache = new Map<string, unknown>()
const mutate = vi.fn()
vi.mock('swr', () => ({ mutate: vi.fn(), default: (key: string) => ({ data: cache.get(key), mutate }) }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
import SpecialPage from '@/app/special/page'

type Kind = 'class' | 'group'
type RosterStudent = {
  id: string; name: string; enrollment_date?: string | null; withdrawal_date?: string | null
  parent_phone?: string; payssam_recipient: 'mother'; batch_exclude_month?: string | null
}
type Bill = { student_id: string; bill_id: string; amount: number; status: string; bill_note: string }
type Payment = { id: string; student_id: string; amount: number; method: string; label: string }
const student = (id: string, enrollment_date?: string | null): RosterStudent => ({
  id, name: `합성학생-${id}`, enrollment_date, withdrawal_date: null,
  parent_phone: '01000000000', payssam_recipient: 'mother',
})

function scenario(kind: Kind, periodStart: string | null | undefined = '2026-07-23') {
  const winter = periodStart === '2027-01-05'
  const start = winter ? '2027-01-05' : '2026-07-23'
  const before = winter ? '2026-12-01' : '2026-07-01'
  const eligible = [student('before', before), student('on-day', start), student('undated', null),
    student('sent', before), student('paid', before), student('direct', before)]
  // 실명 없이 지시의 등록일 다섯 형태와 그중 한 명의 이후 퇴원을 재현한다.
  const lateDates = winter
    ? ['2027-01-06', '2027-01-07', '2027-02-01', '2027-02-01', '2027-02-02']
    : ['2026-08-06', '2026-08-07', '2026-09-01', '2026-09-01', '2026-09-02']
  const late = lateDates.map((date, i) => student(`late-${i + 1}`, date))
  late[1].withdrawal_date = winter ? '2027-02-23' : '2026-08-23'
  const boundary = student('withdrawn-on-start', before)
  boundary.withdrawal_date = start
  const students = [...eligible, ...late, boundary]
  const bills: Bill[] = ['sent', 'paid'].map(status => ({
    student_id: status, bill_id: `bill-${status}`, amount: 100000, status, bill_note: '합성 특강',
  }))
  const payments: Payment[] = [{ id: 'pay-direct', student_id: 'direct', amount: 100000, method: 'cash', label: '합성 특강' }]
  const grades = [{ id: 'grade', name: '합성학년', classes: kind === 'class' ? [{ id: 'class', name: '검수반', students }] : [] }]
  const data = {
    special: kind === 'class' ? [{ class_id: 'class', label: '합성 특강', fee: 100000, period_start: periodStart }] : [],
    bills: kind === 'class' ? bills : [], payments: kind === 'class' ? payments : [],
    groups: kind === 'group' ? [{ id: 'group', name: '검수그룹', label: '합성 특강', bill_note: '합성 특강', fee: 100000,
      period_start: periodStart, students }] : [],
    groupBills: kind === 'group' ? bills : [], groupPayments: kind === 'group' ? payments : [],
  }
  cache.set('/api/grades', grades)
  cache.set('/api/special', data)
  return { grades, data, students, eligible, late, boundary }
}

let host: HTMLDivElement, root: Root
const sends: Record<string, unknown>[] = []
const confirm = vi.fn<(message: string) => boolean>(() => false)
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!
const render = async () => { await act(async () => root.render(h(SpecialPage))) }
const click = async (el: HTMLElement) => { expect(el).toBeTruthy(); await act(async () => el.click()) }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-15T04:00:00Z'))
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('confirm', confirm)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== '/api/payssam/send' || init?.method !== 'POST') throw new Error(`미정의 요청: ${url}`)
    sends.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ code: '0000' }))
  }))
  cache.clear(); sends.length = 0; mutate.mockClear(); confirm.mockReset(); confirm.mockReturnValue(false)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); vi.useRealTimers(); vi.unstubAllGlobals()
})

describe.each<Kind>(['class', 'group'])('%s 특강의 실제 페이지 계약', kind => {
  it.each(['2026-07-23', null, undefined, '2027-01-05'])('시작일 %s: 명단·헤더·일괄 대상에서 후등록 다섯 명이 동시에 빠진다', async periodStart => {
    // undefined도 실제 누락 필드로 전달한다(기본 인자 대신 필드를 지운다).
    const fixture = scenario(kind, periodStart)
    if (periodStart === undefined) {
      for (const row of [...fixture.data.special, ...fixture.data.groups]) Reflect.deleteProperty(row, 'period_start')
    }
    const before = structuredClone({ grades: fixture.grades, data: fixture.data })
    await render()
    const card = host.querySelector('[data-paper-card]')!
    expect(card.firstElementChild!.textContent).toContain('2/6')
    expect(card.textContent).not.toContain('전원납부')
    for (const st of fixture.eligible) expect(card.textContent).toContain(st.name)
    for (const st of [...fixture.late, fixture.boundary]) expect(card.textContent).not.toContain(st.name)
    expect(button('일괄청구 3')).toBeTruthy()
    expect(button('발송됨').title).toBe('탭하면 파기/취소/재발송')
    expect(button('납부완료').title).toBe('결제선생 결제완료')
    expect(button('납부완료 · 현금').title).toBe('탭하면 납부 취소')
    expect(host.querySelectorAll('[title="현장 직접 납부"]')).toHaveLength(4)
    expect(fetch).not.toHaveBeenCalled()

    await click(button('일괄청구 3'))
    expect(sends).toEqual([]) // 확인 거절은 모든 발송을 막는다.
    const label = kind === 'class' ? '합성학년 검수반' : '검수그룹'
    expect(confirm).toHaveBeenLastCalledWith(
      `${label} — 일괄 특강비 청구\n\n미청구 3명에게 100,000원씩 청구서를 발송합니다.\n합계 300,000원\n\n⚠️ 실제 결제선생 청구서가 발송됩니다. 진행할까요?`,
    )
    confirm.mockReturnValue(true)
    await click(button('일괄청구 3'))
    expect(sends.map(body => body.studentId)).toEqual(['before', 'on-day', 'undated'])
    expect(sends.every(body => body.amount === 100000 && body.isRegularTuition === false)).toBe(true)
    expect({ grades: fixture.grades, data: fixture.data }).toEqual(before) // 원본 학생·그룹 멤버·청구·납부 무변경
  })

  it('남은 대상만 전원 납부면 2/2로 접고, 펼치면 기존 납부 행을 표시한다', async () => {
    const fixture = scenario(kind)
    fixture.students.splice(0, fixture.students.length, ...fixture.eligible.slice(4), ...fixture.late)
    await render()
    expect(host.textContent).toContain('전원납부 2/2')
    expect(host.textContent).not.toContain('일괄청구')
    expect(host.textContent).not.toContain('합성학생-paid')
    await click(host.querySelector<HTMLElement>('[data-paper-card]')!.firstElementChild as HTMLElement)
    expect(host.textContent).toContain('합성학생-paid')
    expect(host.textContent).toContain('합성학생-direct')
    for (const st of fixture.late) expect(host.textContent).not.toContain(st.name)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('대상이 없으면 전원납부나 일괄청구를 표시하지 않는다', async () => {
    const fixture = scenario(kind)
    fixture.students.splice(0, fixture.students.length, ...fixture.late)
    await render()
    expect(host.textContent).not.toContain('전원납부')
    expect(host.textContent).not.toContain('일괄청구')
    for (const st of fixture.late) expect(host.textContent).not.toContain(st.name)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('이 달 일괄제외·번호 없는 학생은 명단에 남고 기존 청구 가드를 유지한다', async () => {
    const fixture = scenario(kind)
    fixture.students.push({ ...student('excluded', '2026-07-01'), batch_exclude_month: '2026-09' },
      { ...student('no-phone', '2026-07-01'), parent_phone: undefined })
    await render()
    expect(host.textContent).toContain('합성학생-excluded')
    expect(host.textContent).toContain('합성학생-no-phone')
    expect(host.querySelector('[data-paper-card]')!.firstElementChild!.textContent).toContain('2/8')
    confirm.mockReturnValue(true)
    await click(button('일괄청구 4'))
    expect(confirm.mock.calls[0][0]).toContain('미청구 3명에게')
    expect(confirm.mock.calls[0][0]).toContain('(학부모 번호 없는 1명 제외)')
    expect(sends.map(body => body.studentId)).toEqual(['before', 'on-day', 'undated'])
  })
})

it('같은 화면의 반·그룹은 각각 자기 행의 시작일을 따른다', async () => {
  const group = scenario('group', '2027-01-05')
  const cls = scenario('class', '2026-07-23')
  cls.students.splice(0, cls.students.length, student('summer-member', '2026-07-23'), student('winter-member', '2026-12-01'))
  group.students.splice(0, group.students.length, ...cls.students)
  cache.set('/api/special', { ...cls.data, groups: group.data.groups, groupBills: [], groupPayments: [] })
  await render()
  const cards = host.querySelectorAll('[data-paper-card]')
  expect(cards[0].textContent).toContain('합성학생-summer-member')
  expect(cards[0].textContent).not.toContain('합성학생-winter-member')
  expect(cards[0].firstElementChild!.textContent).toContain('0/1')
  expect(cards[1].textContent).toContain('합성학생-winter-member')
  expect(cards[1].firstElementChild!.textContent).toContain('0/2')
})
