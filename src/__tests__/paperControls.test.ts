// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnimatedModal from '@/components/ui/AnimatedModal'
import DatePickerPopup from '@/components/payments/DatePickerPopup'
import MethodPickerPopup from '@/components/payments/MethodPickerPopup'
import BulkBillSendModal from '@/components/BulkBillSendModal'
import PaymentModal from '@/components/PaymentModal'
import InstallPrompt from '@/components/InstallPrompt'
import type { Payment, Student, GradeWithClasses } from '@/types'
import StudentModal from '@/components/StudentModal'
import StudentDetailModal from '@/components/StudentDetailModal'
import fixtures from '../../tests/e2e/paper-fixtures.cjs'

vi.mock('next/navigation', () => ({ usePathname: () => '/payments' }))
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('대역으로 대체하지 않은 요청') }))
  document.body.style.overflow = 'auto'
  localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const button = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!
const click = async (b: HTMLElement) => act(async () => b.click())

describe('종이 UI의 포털·대화형 계약', () => {
  it('중첩 모달에서 Escape는 최상단만 닫으며 마지막 닫기까지 스크롤 잠금 유지', async () => {
    function Modals() {
      const [outer, setOuter] = useState(true), [inner, setInner] = useState(false)
      return h(AnimatedModal, { open: outer, onClose: () => setOuter(false), children: h('div', {},
        h('button', { onClick: () => setInner(true) }, '중첩 열기'),
        h(AnimatedModal, { open: inner, onClose: () => setInner(false), children: h('button', {}, '내부 버튼') })) })
    }
    await act(async () => root.render(h(Modals)))
    await click(button('중첩 열기'))
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2)
    expect(host.querySelector('[role="dialog"]')).toBeNull() // body portal
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 600)) })
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.body.style.overflow).toBe('hidden')
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 600)) })
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    expect(document.body.style.overflow).toBe('auto')
  })
  it('날짜 피커는 고른 날짜를 먼저 전달하고 닫으며 월말 이동을 보존', async () => {
    const events: string[] = []
    await act(async () => root.render(h(DatePickerPopup, { inlineDate: '2026-01-31', anchorRef: { current: host }, onDateChange: d => events.push(d), onClose: () => events.push('close') })))
    await click(document.querySelector('[aria-label="다음 달"]') as HTMLElement)
    expect(events).toEqual(['2026-02-28'])
    events.length = 0
    await click(button('15'))
    expect(events).toEqual(['2026-01-15','close'])
  })
  it('수단 피커는 원래 method 코드를 전달하고 닫는다', async () => {
    const events: string[] = []
    await act(async () => root.render(h(MethodPickerPopup, { currentMethod: 'card', anchorRef: { current: host }, onMethodChange: m => events.push(m), onClose: () => events.push('close') })))
    await click(button('현금'))
    expect(events).toEqual(['cash','close'])
  })
  it('일괄발송은 명단·금액을 표시하고 확인 2단계와 뒤로·중복 제출 방지를 유지', async () => {
    let finish!: () => void
    const confirm = vi.fn(() => new Promise<void>(r => { finish = r }))
    await act(async () => root.render(h(BulkBillSendModal, { className: '합성반', targets: [{ studentId: 'paper-a', studentName: '합성A', className: '합성반', amount: 300000 }, { studentId: 'paper-b', studentName: '합성B', className: '합성반', amount: 150000 }], onClose() {}, onConfirm: confirm })))
    expect(document.body.textContent).toContain('450,000')
    await click(button('일괄 발송')); expect(confirm).not.toHaveBeenCalled()
    await click(button('뒤로')); expect(confirm).not.toHaveBeenCalled()
    await click(button('일괄 발송')); await click(button('확인, 발송합니다'))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(button('발송 시작...').disabled).toBe(true)
    await click(button('발송 시작...')); expect(confirm).toHaveBeenCalledTimes(1)
    await act(async () => finish())
  })
  it('납부 입력은 표시 애니메이션과 독립적으로 대상·정수 금액·수단·월을 저장한다', async () => {
    let finish!: () => void
    const payloads: Partial<Payment>[] = []
    await act(async () => root.render(h(PaymentModal, { studentId: 'paper-a', defaultAmount: 345678, defaultBillingMonth: '2026-09', onClose() {}, onSave: data => { payloads.push(data); return new Promise<void>(r => { finish = r }) } })))
    const form = document.querySelector('form')!
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toMatchObject({ student_id: 'paper-a', amount: 345678, method: 'card', billing_month: '2026-09', cash_receipt: null })
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(payloads).toHaveLength(1)
    await act(async () => finish())
  })
  it('새 납부 메모 기본값은 지난달 메모에서 결제선생 [bill:…] 태그만 뺀다(2026-09-27)', async () => {
    const payloads: Partial<Payment>[] = []
    await act(async () => root.render(h(PaymentModal, { studentId: 'paper-a', defaultAmount: 1000, defaultBillingMonth: '2026-09', prevMemo: '[bill:TM-old1][bill:TM-old2] 합성 비고', prevMethod: 'payssam', onClose() {}, onSave: data => { payloads.push(data); return Promise.resolve() } })))
    const form = document.querySelector('form')!
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(payloads).toHaveLength(1)
    expect(String(payloads[0].memo ?? '')).not.toContain('[bill:')
    expect(String(payloads[0].memo ?? '')).toContain('합성 비고')
  })
  it('학생 수정 모달의 기존 학생 메모 편집·저장 계약을 보존', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]')))
    const onSave = vi.fn()
    const student = { ...fixtures.students[3], memo:'수정 모달 합성 원문', attendance_code:'1234' } as Student
    await act(async () => root.render(h(StudentModal, { student, grades:fixtures.grades as GradeWithClasses[], onSave, onClose() {} })))
    const memo = document.querySelector('textarea')!
    expect(memo.value).toBe('수정 모달 합성 원문')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(memo,'편집한 합성 메모')
      memo.dispatchEvent(new Event('input',{bubbles:true}))
    })
    await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ memo:'편집한 합성 메모' }))
  })
  it('학생 상세 모달의 학생 메모 원문·색상 편집 경로를 보존', async () => {
    const writes: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { writes.push(JSON.parse(String(init.body))); return new Response('{"success":true}') }
      const data = url === '/api/students/paper-4' ? { ...fixtures.students[3], memo:'상세 합성 메모' } : fixtures.fixture(`http://fixture${url}`)
      return new Response(JSON.stringify(data))
    }))
    await act(async () => root.render(h(StudentDetailModal, { studentId:'paper-4', onClose() {} })))
    expect(document.querySelector<HTMLInputElement>('[placeholder="학생에 대한 메모"]')?.value).toBe('상세 합성 메모')
    await click(document.querySelector('[aria-label="비고 저장"]') as HTMLElement)
    expect(writes).toEqual([{ memo:'상세 합성 메모', memo_color:'yellow' }])
  })
  it('설치 배너의 투명 여백 계약과 닫기 동작을 유지한다', async () => {
    await act(async () => root.render(h(InstallPrompt)))
    const e = new Event('beforeinstallprompt')
    Object.assign(e, { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' }) })
    await act(async () => window.dispatchEvent(e))
    const banner = document.querySelector('[aria-label="앱 설치 안내"]')!
    expect(banner.classList.contains('pointer-events-none')).toBe(true)
    expect(banner.firstElementChild?.classList.contains('pointer-events-auto')).toBe(true)
    await click(document.querySelector('[aria-label="나중에"]') as HTMLElement)
    expect(document.querySelector('[aria-label="앱 설치 안내"]')).toBeNull()
  })
})
