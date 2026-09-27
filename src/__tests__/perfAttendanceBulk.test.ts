// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const grades = [{ id: 'g', name: '학년', classes: [
  { id: 'c1', name: 'A', subject: '수학', students: [{ id: 'a', name: 'fixture-a' }, { id: 'b', name: 'fixture-b' }] },
  { id: 'c2', name: 'B', subject: '영어', students: [{ id: 'c', name: 'fixture-c' }] },
] }]
const empty: never[] = []
const successToast = vi.fn()
const errorToast = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => successToast(...a), error: (...a: unknown[]) => errorToast(...a), info: vi.fn() } }))
vi.mock('@/lib/utils', async original => ({ ...await original<typeof import('@/lib/utils')>(), useGrades: () => ({ data: grades }) }))
vi.mock('swr', () => ({
  mutate: vi.fn(),
  default: function useMockSWR(key: string) {
    const [records, setRecords] = useState([{ id: 'existing-b', student_id: 'b', status: 'present', note: null }])
    return { data: key.startsWith('/api/attendance?') ? records : empty, isLoading: false, mutate: async (next?: typeof records) => { if (next) setRecords(next) } }
  },
}))
import AttendancePage from '@/app/attendance/page'

let root: Root
let container: HTMLDivElement
let finish: (res: Response) => void
const requests: { entries: { student_id: string; status: string }[] }[] = []
const button = (text: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(text))!
const studentButtons = (name: string) => Array.from(container.querySelectorAll('div.truncate')).find(d => d.textContent === name)!.parentElement!.parentElement!.querySelectorAll<HTMLButtonElement>('button')
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  requests.length = 0
  successToast.mockClear()
  errorToast.mockClear()
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    return new Promise<Response>(r => { finish = r })
  }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(createElement(AttendancePage)) })
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe('perf #9 일괄 출석', () => {
  it('응답 전 대상만 잠그고, 개별 수정 차단·다른 학생/반 조작 유지', async () => {
    await act(async () => { button('일괄 출석').click() })
    expect(Array.from(studentButtons('fixture-a')).every(b => b.disabled)).toBe(true)
    expect(Array.from(studentButtons('fixture-b')).every(b => !b.disabled)).toBe(true)
    await act(async () => { studentButtons('fixture-a')[3].click() })
    expect(requests).toHaveLength(1)
    expect(successToast).not.toHaveBeenCalled()
    await act(async () => { button('영어B').click() })
    expect(Array.from(studentButtons('fixture-c')).every(b => !b.disabled)).toBe(true)
    await act(async () => { finish(new Response('{}')) })
    expect(successToast).toHaveBeenCalledWith('1명 출석 처리')
    await act(async () => { button('수학A').click() })
    expect(Array.from(studentButtons('fixture-a')).every(b => !b.disabled)).toBe(true)
  })
  it('500이면 성공 토스트 없이 오류 표시·대상 잠금 해제', async () => {
    await act(async () => { button('일괄 출석').click() })
    await act(async () => { finish(new Response(JSON.stringify({ error: '모의 저장 실패' }), { status: 500 })) })
    expect(successToast).not.toHaveBeenCalled()
    expect(errorToast).toHaveBeenCalledWith('모의 저장 실패')
    expect(Array.from(studentButtons('fixture-a')).every(b => !b.disabled)).toBe(true)
  })
})
