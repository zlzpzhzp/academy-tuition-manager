// @vitest-environment jsdom
import { act, createElement as h, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../tests/e2e/payments-header-fixtures.cjs'
import { REGULAR_TUITION_MESSAGE, getRegularTuitionTitle } from '@/lib/billing-title'
import type BulkBillSendModal from '@/components/BulkBillSendModal'

// 같은 파일을 격리 기준 사본에서도 실행한다. 기본 경로는 반드시 새 달력 진입점이다.
const legacy = process.env.PAYMENTS_FILTER_ENTRY === 'legacy'
let data = fixture.scenario()
const cache = new Map<string, unknown>()
const info = vi.fn()
let modal: ComponentProps<typeof BulkBillSendModal> | null = null
vi.mock('sonner', () => ({ toast: { info: (...args: unknown[]) => info(...args), error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('swr', () => ({ mutate: vi.fn(), default: (key: string) => {
  if (!cache.has(key)) cache.set(key, fixture.fixture(data, `http://fixture${key}`))
  return { data: cache.get(key), isLoading: false, mutate: vi.fn() }
} }))
vi.mock('@/components/BulkBillSendModal', async importOriginal => {
  const { default: Modal } = await importOriginal<typeof import('@/components/BulkBillSendModal')>()
  return { default: (props: ComponentProps<typeof Modal>) => { modal = props; return h(Modal, props) } }
})
import PaymentsPage from '@/app/payments/page'
let host: HTMLDivElement, root: Root
let sends: Record<string,unknown>[]
let release: ((code?: string) => void) | undefined
let memoStatus = 200
const button = (text: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll('button')).find(b=>b.textContent?.trim()===text)!
const click = async (el: HTMLElement) => { expect(el).toBeTruthy(); await act(async()=>el.click()) }
const render = async () => { await act(async()=>root.render(h(PaymentsPage))) }
const applyOverdue = async () => {
  if (legacy) await click(button('청구지연',host))
  else {
    await click(host.querySelector('[aria-label="결제일 선택"]')!)
    const dialog=document.querySelector('[role="dialog"]')!
    await click(Array.from(dialog.querySelectorAll('button')).find(b=>b.textContent?.startsWith('청구지연 '))!)
    await click(button('적용',dialog))
  }
}
const bulkBadge = () => Array.from(host.querySelectorAll('button')).find(b=>b.title.includes('조건의 미발송'))!
const confirmSend = async () => {
  const resend = modal!.mode === 'resend'
  await click(button(resend ? '일괄 재발송' : '일괄 발송'))
  expect(sends).toEqual([]) // 모달의 2단계 확인 전에는 요청하지 않는다.
  await click(button(resend ? '확인, 재발송합니다' : '확인, 발송합니다'))
}
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(new Date('2026-09-13T04:00:00Z'))
  vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}))
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}unobserve(){}})
  vi.stubGlobal('scrollTo',vi.fn())
  Object.defineProperty(window,'scrollY',{value:0,configurable:true}); HTMLElement.prototype.scrollIntoView=vi.fn()
  data=fixture.scenario(); cache.clear(); info.mockClear(); modal=null; sends=[]; release=undefined; memoStatus=200
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if (url.startsWith('/api/monthly-memo') && !init?.method) return new Response(JSON.stringify({content:'검수 메모',updated_at:'v0'}))
    if (url.startsWith('/api/monthly-memo') && init?.method === 'PUT') return new Response(JSON.stringify({code: memoStatus === 409 ? 'MEMO_CONFLICT' : undefined}), {status: memoStatus})
    if (url==='/api/payssam/send' || url==='/api/payssam/resend') {
      sends.push(JSON.parse(String(init?.body)))
      return new Promise<Response>(resolve=>{release=(code='0000')=>resolve(new Response(JSON.stringify({code})))})
    }
    throw new Error(`미정의 API: ${url}`)
  }))
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals()})

describe('종전 칩 ↔ 새 달력 동일 합성 업무 계약',()=>{
  it('일반 명단 ID와 퇴원 섹션은 각각 동일',async()=>{
    await render();await applyOverdue()
    const normal=Array.from(host.querySelectorAll('[data-section-key] [data-student-row]')).map(el=>el.getAttribute('data-student-row')).sort()
    expect(normal).toEqual(['header-1','header-2','header-3','header-9'])
    const all=Array.from(host.querySelectorAll('[data-student-row]')).map(el=>el.getAttribute('data-student-row')).sort()
    expect(all).toEqual(['header-1','header-2','header-3','header-8','header-9'])
    expect(host.textContent).toContain('퇴원 (처리중)')
  })
  it('일괄 배지 N은 기존 대상 집합(퇴원 포함/월 제외 제외)을 보존',async()=>{
    await render();await applyOverdue();expect(bulkBadge().textContent).toBe('청구지연 일괄3')
    expect(bulkBadge().disabled).toBe(false)
  })
  it('모달 대상/금액과 electivesOnly 안내를 보존',async()=>{
    await render();await applyOverdue();await click(bulkBadge())
    expect(modal!.targets.map(t=>({id:t.studentId,amount:t.amount}))).toEqual([
      {id:'header-1',amount:300000},{id:'header-3',amount:500000},{id:'header-8',amount:300000},
    ])
    expect(modal!.targets.reduce((sum,t)=>sum+t.amount,0)).toBe(1100000)
    expect(modal!.excludedNote).toContain('선택과목분만 지연된 1명은 개별 발송: 검수학생2')
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.querySelector('h2')!.textContent).toBe('일괄 청구서 발송청구지연 일괄')
    expect(dialog.textContent).toContain('1,100,000')
    for (const target of modal!.targets) expect(dialog.textContent).toContain(target.studentName)
    expect(dialog.textContent).toContain(modal!.excludedNote)
  })
  it('재발송 배지 N·대상/금액은 필터에 따라 바꾸지 않는다',async()=>{
    await render();await applyOverdue();const badge=Array.from(host.querySelectorAll('button')).find(b=>b.title.includes('카톡 알림 재발송'))!
    expect(badge.textContent).toBe('재발송2');await click(badge)
    expect(modal!.mode).toBe('resend');expect(modal!.targets.map(t=>({id:t.studentId,amount:t.amount}))).toEqual([{id:'header-2',amount:300000},{id:'header-4',amount:300000}])
    expect(document.querySelector('[role="dialog"] h2')!.textContent).toBe('미결제 일괄 재발송결제일 지난 미결제')
  })
  it('전체 일괄은 기존 aria-disabled 안내 동작 보존',async()=>{
    await render();const badge=Array.from(host.querySelectorAll('button')).find(b=>b.title==='미납 또는 결제일 필터를 먼저 적용해주세요')!
    expect(badge.getAttribute('aria-disabled')).toBe('true');await click(badge)
    expect(info).toHaveBeenCalledWith('미납 또는 결제일 필터를 먼저 적용해주세요');expect(modal).toBeNull();expect(sends).toEqual([])
  })
  it('전원 electivesOnly인 경우 개별 발송 필요 배지와 명단 안내 보존',async()=>{
    data.grades[0].classes[0].students=[data.students[1]]
    await render();await applyOverdue();await click(button('개별 발송 필요1',host))
    expect(info.mock.calls.flat().join(' ')).toContain('검수학생2');expect(modal).toBeNull();expect(sends).toEqual([])
  })
  it('발송 중단은 다음 학생 발송을 막는다(대역 요청만)',async()=>{
    await render();await applyOverdue();await click(bulkBadge());await confirmSend()
    expect(sends).toHaveLength(1);expect(sends[0]).toMatchObject({studentId:'header-1',amount:300000,billingMonth:'2026-09'})
    await act(async()=>{Object.defineProperty(window,'scrollY',{value:300,configurable:true});window.dispatchEvent(new Event('scroll'))})
    const stop=button('중단',host)
    if (!legacy) {expect(stop.closest('[inert]')).toBeNull();expect(host.querySelector('[data-payments-header]')!.textContent).toContain('0/3')}
    await click(stop);await act(async()=>release!());expect(sends).toHaveLength(1)
  })
})

describe('반 일괄 버튼 제거 후 남는 납부·발송 계약', () => {
  it.each(['all', 'filter-unpaid', 'filter'])('%s: 반 헤더는 일괄 버튼 없이 정보·학생 추가를 유지한다', async path => {
    await render()
    if (path === 'filter-unpaid') await click(button('전체', host))
    if (path === 'filter') await applyOverdue()
    const add = host.querySelector<HTMLButtonElement>('button[aria-label="수학A에 학생 추가"]')!
    expect(add).not.toBeNull()
    expect(add.disabled).toBe(false)
    const header = add.parentElement!
    expect(header.textContent).toContain('수학A')
    expect(header.textContent).toContain('검수강사 · 월수금')
    expect(header.textContent).toContain('300,000원')
    expect(header.textContent).toMatch(/\d+\/\d+/)
    expect(header.textContent).not.toContain('일괄')
    expect(Array.from(header.querySelectorAll('button'))).toEqual([add])
    expect(host.querySelector('button[aria-label$="일괄 청구서 발송"]')).toBeNull()
    const filters = host.querySelector('[role="group"][aria-label="납부 필터"]')!
    expect(filters.textContent).toContain(path === 'all' ? '전체 일괄' : path === 'filter-unpaid' ? '미납 일괄' : '청구지연 일괄')
    expect(filters.textContent).toContain('재발송2')
    expect(sends).toEqual([])
  })

  it('전원납부 N/M과 학생 추가를 유지한다', async () => {
    data.grades[0].classes[0].students = [data.students[0]]
    data.payments = [{ ...data.payments[0], student_id: 'header-1', amount: 300000 }]
    await render()
    const add = host.querySelector<HTMLButtonElement>('button[aria-label="수학A에 학생 추가"]')!
    expect(add.parentElement!.textContent).toContain('전원납부 1/1')
    expect(Array.from(add.parentElement!.querySelectorAll('button'))).toEqual([add])
  })

  it('필터 모달은 지난달 미납·이 달 일괄 제외·선택과목분 지연을 계속 제외한다', async () => {
    data.students[0].enrollment_date = '2026-03-01' // 지난달 납부·종결 청구 없음
    await render(); await applyOverdue(); await click(bulkBadge())
    expect(modal!.targets.map(t => t.studentId)).toEqual(['header-3', 'header-8'])
    expect(modal!.excludedNote).toBe('지난달 미납 1명 제외: 검수학생1 / 선택과목분만 지연된 1명은 개별 발송: 검수학생2')
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain(modal!.excludedNote)
    expect(dialog.textContent).toContain('미납분 정리 후 개별 발송하세요')
    expect(dialog.textContent).not.toContain('검수학생9') // batch_exclude_month
    await confirmSend()
    expect(sends[0]).toMatchObject({ studentId: 'header-3', amount: 300000, billType: 'regular' })
    await click(button('중단'))
    await act(async () => release!())
    // 같은 학생의 정규/선택 분리 요청은 기존 계약대로 끝내고 다음 학생을 막는다.
    expect(sends[1]).toMatchObject({ studentId: 'header-3', amount: 200000, billType: 'electives' })
    await act(async () => release!())
    expect(sends.map(s => s.studentId)).toEqual(['header-3', 'header-3'])
  })

  it('여러 반의 동명 합성 학생을 ID로 연결해 각 반 금액·상품명·API 인자를 유지한다', async () => {
    const cls = data.grades[0].classes[0]
    const first = { ...data.students[0], name: '합성동명' }
    const second = { ...data.students[2], name: '합성동명', class_id: 'second-class', electives: [] }
    data.grades[0].classes = [
      { ...cls, students: [first] },
      { ...cls, id: 'second-class', name: 'B', subject: '영어', monthly_fee: 470000, students: [second] },
    ]
    await render(); await applyOverdue(); await click(bulkBadge())
    expect(modal!.targets.map(t => ({ id: t.studentId, amount: t.amount }))).toEqual([
      { id: 'header-1', amount: 300000 }, { id: 'header-3', amount: 470000 },
    ])
    await confirmSend()
    await act(async () => { release!(); await new Promise(resolve => setTimeout(resolve, 600)) })
    expect(sends).toEqual([
      { studentId: 'header-1', studentName: '합성동명', phone: '01000000000', amount: 300000, productName: getRegularTuitionTitle('수학', '2026-09', 'A'), message: REGULAR_TUITION_MESSAGE, billingMonth: '2026-09', billType: 'regular' },
      { studentId: 'header-3', studentName: '합성동명', phone: '01000000000', amount: 470000, productName: getRegularTuitionTitle('영어', '2026-09', 'B'), message: REGULAR_TUITION_MESSAGE, billingMonth: '2026-09', billType: 'regular' },
    ])
    await act(async () => release!())
    expect(host.textContent).toContain('2건 발송')
    expect(button('중단', host)).toBeUndefined()
  })

  it.each([['0000', '1건 발송'], ['SCHEDULED', '1건 예약(영업시간 외)'], ['FAILED', '1건 실패']])('필터 발송 결과 %s의 토스트·진행률 종료를 유지한다', async (code, result) => {
    data.grades[0].classes[0].students = [data.students[0]]
    await render(); await applyOverdue(); await click(bulkBadge()); await confirmSend()
    expect(host.querySelector('[data-payments-sticky-status]')!.textContent).toContain('0/1')
    await act(async () => release!(code))
    expect(sends).toHaveLength(1)
    expect(host.textContent).toContain(result)
    expect(button('중단', host)).toBeUndefined()
    expect(bulkBadge().disabled).toBe(false)
  })
})

// 반 전용 경로의 검증은 미납 필터로 이관한다. 청구지연·재발송 검증은 유지한다.
const startSending = async (path: string) => {
  if (path === 'filter-unpaid') await click(button('전체', host))
  else await applyOverdue()
  const trigger = path === 'resend' ? Array.from(host.querySelectorAll('button')).find(b => b.title.includes('카톡 알림 재발송'))! : bulkBadge()
  await click(trigger); await confirmSend()
}
describe('필터(미납·청구지연)와 재발송의 단일 sticky 진행률과 다음 요청 차단', () => {
  for (const path of ['filter-unpaid', 'filter', 'resend']) {
    it.each([200, 500, 409])(`${path}: 메모 상태 %s와 독립적으로 동일 중단 버튼 유지`, async status => {
      await render(); memoStatus = status
      if (status !== 200) await act(async () => {
        const textarea = host.querySelector('textarea')!
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '합성 보존 초안')
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(resolve => setTimeout(resolve, 550))
      })
      await startSending(path)
      expect(sends).toHaveLength(1)
      expect(host.querySelector('button[aria-label$="일괄 청구서 발송"]')).toBeNull()
      const otherBadge = path === 'resend' ? bulkBadge() : Array.from(host.querySelectorAll('button')).find(b => b.title.includes('카톡 알림 재발송'))!
      expect(otherBadge.disabled).toBe(true)
      const stop = button('중단', host), progress = stop.closest('[role="status"]')!
      expect(stop.closest('[data-payments-sticky-status]')).not.toBeNull()
      const header = host.querySelector('[data-payments-header]')!
      for (const y of [300, 1000, 0, 24, 400]) {
        await act(async () => { Object.defineProperty(window, 'scrollY', { value: y, configurable: true }); window.dispatchEvent(new Event('scroll')) })
        expect(Array.from(host.querySelectorAll('button')).filter(b => b.textContent === '중단')).toEqual([stop])
        expect(stop.closest('[role="status"]')).toBe(progress)
        expect(progress.parentElement).toBe(host.querySelector('[data-payments-sticky-status]'))
        if (status !== 200) expect(header.textContent).toContain(status === 409 ? '다른 기기' : '저장 실패')
      }
      await click(stop); expect(stop.disabled).toBe(true); expect(stop.textContent).toBe('중단중')
      expect(sends).toHaveLength(1) // 진행 중인 요청을 취소한 것으로 간주하지 않는다.
      await act(async () => release!())
      expect(sends).toHaveLength(1); expect(progress.isConnected).toBe(false)
      if (status !== 200) {
        expect(header.textContent).toContain(status === 409 ? '다른 기기' : '저장 실패')
        await click(button('메모 확인')); expect(document.activeElement).toBe(host.querySelector('textarea'))
        expect(host.querySelector('textarea')!.value).toBe('합성 보존 초안')
      }
    })
    it(`${path}: 단일 청구 학생은 중단하지 않으면 응답 뒤 다음 요청을 보낸다(양성 대조)`, async () => {
      data.students[2].electives = [] // 대상 간 중단 계약. 동일 학생의 정규/선택 두 요청은 기존 별도 경계다.
      await render(); await startSending(path); expect(sends).toHaveLength(1)
      await act(async () => { release!(); await new Promise(resolve => setTimeout(resolve, 600)) })
      expect(sends).toHaveLength(2)
      await click(button('중단')); await act(async () => release!()); expect(sends).toHaveLength(2)
    })
  }
})
