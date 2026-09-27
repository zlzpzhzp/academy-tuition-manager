// @vitest-environment jsdom
import { act, createElement as h, type ButtonHTMLAttributes, type PropsWithChildren } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Student } from '@/types'

// 애니메이션 껍데기만 대체하고 StudentModal의 실제 입력·저장 로직을 실행한다.
vi.mock('@/components/ui/AnimatedModal', () => ({ default: ({ children }: PropsWithChildren) => h('div', null, children) }))
vi.mock('@/components/motion', () => ({ TButton: (props: ButtonHTMLAttributes<HTMLButtonElement>) => h('button', props) }))
import StudentModal from '@/components/StudentModal'

let host: HTMLDivElement, root: Root
const onSave = vi.fn()
const fixture: Student = { id: 'synthetic-student', name: '합성학생', class_id: 'synthetic-class',
  enrollment_date: '2026-09-16', created_at: '2026-09-16T00:00:00Z',
  parent_phone: '01000000001', attendance_recipient: 'father', payssam_recipient: 'mother' }
const render = async (student?: Student) => {
  await act(async () => root.render(h(StudentModal, { student, grades: [], onSave, onClose: vi.fn() })))
}
const input = (label: string) => {
  const el = Array.from(host.querySelectorAll('label')).find(node => node.textContent?.includes(label))!
  expect(el).toBeTruthy()
  return (el.control ?? el.parentElement!.querySelector('input')) as HTMLInputElement
}
const fill = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const submit = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }) }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url !== '/api/students?active=true') throw new Error('실네트워크 금지')
    return new Response('[]')
  }))
  onSave.mockReset().mockResolvedValue(undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('신규 학생에서 선택 입력·도움말을 표시하고 입력 번호를 저장한다', async () => {
  await render()
  const extra = input('추가 수신 번호(선택)')
  expect(extra.type).toBe('tel')
  expect(extra.required).toBe(false)
  expect(extra.value).toBe('')
  expect(host.textContent).toContain('등하원 알림을 이 번호에도 함께 보냅니다')
  await fill(input('이름'), '합성학생')
  await fill(input('어머니 번호'), '01000000001')
  await fill(extra, '01000000003')
  expect(extra.value).toBe('010-0000-0003')
  await submit()
  expect(onSave).toHaveBeenCalledOnce()
  expect(onSave.mock.calls[0][0]).toMatchObject({ attendance_extra_phone: '010-0000-0003', attendance_recipient: 'mother', payssam_recipient: 'mother' })
})
it('저장된 추가 번호를 다시 표시·수정하며 두 수신자 선택을 보존한다', async () => {
  await render({ ...fixture, attendance_extra_phone: '01000000003' })
  const extra = input('추가 수신 번호(선택)')
  expect(extra.value).toBe('010-0000-0003')
  await fill(extra, '01000000005'); await submit()
  expect(onSave.mock.calls[0][0]).toMatchObject({ attendance_extra_phone: '010-0000-0005', attendance_recipient: 'father', payssam_recipient: 'mother' })
})
it('기존 추가 번호를 비우면 NULL을 저장한다', async () => {
  await render({ ...fixture, attendance_extra_phone: '01000000003' })
  await fill(input('추가 수신 번호(선택)'), ''); await submit()
  expect(onSave.mock.calls[0][0].attendance_extra_phone).toBeNull()
})
it('추가 번호 없이도 저장할 수 있다', async () => {
  await render(fixture); await submit()
  expect(onSave).toHaveBeenCalledOnce()
  expect(onSave.mock.calls[0][0].attendance_extra_phone).toBeNull()
})
it('기존 번호 필드와 같은 입력 포맷·형식 경고를 표시한다', async () => {
  await render(fixture)
  const parent = input('어머니 번호'), extra = input('추가 수신 번호(선택)')
  for (const value of ['0200000000', '01000000003', '010', '']) {
    await fill(parent, value); await fill(extra, value)
    expect(extra.value).toBe(parent.value)
    expect(extra.getAttribute('aria-invalid')).toBe(parent.getAttribute('aria-invalid'))
  }
})
