'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import useSWR from 'swr'
import { Flame, Send, Check, Clock, Loader2, Wallet, Camera, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { TButton } from '@/components/motion'
import type { Student, GradeWithClasses, PaymentMethod } from '@/types'
import { useGrades, swrFetcher, getCurrentMonth, isBatchExcluded as isBatchExcludedForMonth } from '@/lib/utils'
import { billingPhone } from '@/lib/student-codes'
import { isSendSuccess, sendFailReason } from '@/lib/payssamJudge'
import { formatWon, formatClassName } from '@/lib/format'
import { METHOD_LABELS } from '@/lib/constants'
import { compressImageToBlob } from '@/lib/compressImage'
import MethodPickerPopup from '@/components/payments/MethodPickerPopup'
import BillActionModal from '@/components/BillActionModal'
import { SpecialSkeleton } from '@/components/Skeleton'
import AnimatedModal from '@/components/ui/AnimatedModal'

/**
 * '이 달만 일괄청구 제외' — 공용 헬퍼(@/lib/utils) 위임. 판정 이력:
 * 🔴 2026-08-05: 이 플래그를 납부 화면만 보고 특강 화면은 안 봐서, "청구 만들지 마라"
 *   (현장 카드결제)로 걸어둔 학생이 특강 일괄청구 대상에 남아 있었다(정국, 정가 10만 vs
 *   확정 5만). 그날 특강도 지키게 확장 — 당시 실제로 달라진 건 정국 1명(나머지 보유자는
 *   특강 청구·직접납부가 이미 있어 어차피 비대상).
 * ※ 특강 탭엔 월 네비게이션이 없어 항상 현재 달(getCurrentMonth) 기준이 의도다 —
 *   납부 탭(selectedMonth)과 다른 게 맞다. 여기 판정은 '일괄 대상 제외'뿐이고,
 *   화면 부재 판정(isBatchExcludedNoBill)은 특강엔 해당 없음(제외자도 명단·배지에 계속 보임).
 */
function isBatchExcluded(s: { batch_exclude_month?: string | null }): boolean {
  return isBatchExcludedForMonth(s, getCurrentMonth())
}

const SPECIAL_LABEL = '여름방학 특강'
const SPECIAL_MONTH = '2026-07' // 특강 청구 billing_month (정규와 bill_note로 구분)
const SPECIAL_START = '2026-07-23' // 특강 시작일 — 이 이전 퇴원생은 특강 대상 아님
// 반기반 여름특강 청구서 안내문구 (학부모용 message) — 운영자 지시 2026-07-15. bill_note(내부 매칭키)와 별개.
const SPECIAL_MESSAGE = '7/23 ~ 8/13 3주간 진행되는 여름특강비 입니다.\n정규원비와는 별개로 1회 결제해주시면 됩니다.\n감사합니다!'

// 특강 대상 학생 필터 (2026-07-09 사용자 지시: 퇴원생 반영 버그 수정).
// getActiveStudents('2026-07')은 7월 중 퇴원생도 포함해 특강탭에 남던 버그 →
// 특강 시작(7/23) 이후에도 재원인 학생만. 반별·명단그룹 통일.
// 경계: 퇴원일 '당일'은 미수강으로 본다 — calcRefund/getLastClassDate와 같은 규칙.
// >= 였을 때 퇴원일이 특강 첫날(7/23)과 같은 학생이 대상으로 남아 특강비가 청구됐다.
// (2026-07-22 마동석 — 7/23 퇴원인데 7/23 개강 특강 30만이 청구돼 있었음)
const isSpecialActive = (s: { withdrawal_date?: string | null }): boolean =>
  !s.withdrawal_date || s.withdrawal_date > SPECIAL_START

interface SpecialRow {
  class_id: string
  label: string
  fee: number
  hours_note: string | null
  teacher_note: string | null
  period_start: string | null
  period_end: string | null
  due_date: string | null
}
interface SpecialBill {
  student_id: string
  bill_id: string
  amount: number
  status: string
  short_url: string | null
  sent_at: string | null
}
interface SpecialPayment {
  id: string
  student_id: string
  amount: number
  method: string
  paid_at: string | null
  receipt_images?: string[]
}
interface SpecialGroupStudent {
  id: string
  name: string
  phone: string | null
  parent_phone: string | null
  parent_father_phone: string | null
  payssam_recipient: string
  withdrawal_date: string | null
  batch_exclude_month?: string | null
}
interface SpecialGroup {
  id: string
  label: string
  name: string
  subject: string | null
  fee: number
  schedule_note: string | null
  bill_note: string
  product_name: string | null
  order_index: number
  period_start: string | null
  period_end: string | null
  due_date: string | null
  students: SpecialGroupStudent[]
}
interface SpecialGroupBill extends SpecialBill { bill_note: string }
interface SpecialGroupPayment extends SpecialPayment { label: string }

const fetcher = swrFetcher

export default function SpecialPage() {
  const { data: gradesData } = useGrades<GradeWithClasses[]>()
  // ?? [] 를 그대로 쓰면 매 렌더마다 새 배열이라, 이걸 의존하는 useMemo(sectionStats)가 매번 재계산되고
  // 그 결과로 useEffect가 매 렌더 setState → 무한 렌더가 된다. 참조를 고정한다. (2026-07-26)
  const grades = useMemo(() => gradesData ?? [], [gradesData])
  const { data, mutate } = useSWR<{ special: SpecialRow[]; bills: SpecialBill[]; payments: SpecialPayment[]; groups: SpecialGroup[]; groupBills: SpecialGroupBill[]; groupPayments: SpecialGroupPayment[] }>('/api/special', fetcher)
  // 로딩 가드: grades(캐시로 빨리 뜸)만 있고 특강 data가 아직이면 모든 반이 "특강 없음"으로 깜빡임 → 둘 다 로드 전엔 스켈레톤
  const loading = gradesData === undefined || data === undefined
  const [billing, setBilling] = useState<string | null>(null)
  const [batch, setBatch] = useState<{ classId: string; done: number; total: number } | null>(null)
  // 직접납부 결제수단 피커
  const [methodPickerFor, setMethodPickerFor] = useState<{ student: Student; sp: SpecialRow } | null>(null)
  const methodAnchorRef = useRef<HTMLButtonElement>(null)
  // 영수증 업로드 (2026-07-09: 납부탭처럼 카드/PAY 특강 납부에 영수증 사진)
  const [receiptUploading, setReceiptUploading] = useState<string | null>(null)
  // 전원납부한 반/그룹은 접어둔다 (2026-07-26 운영자님 지시 — 납부탭과 동일 동작).
  // 키: 반기반=class_id, 명단그룹=group_id. 미납이 남은 곳만 펼쳐서 할 일이 바로 보이게.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  // 영수증 뷰어 (2026-07-26 운영자님 신고: 이미 올린 사진을 보려고 누르면 업로드 창만 떴다.
  // 특강탭엔 '보기'가 아예 없었고 배지가 항상 업로드 label이었음 — 납부탭 모달과 같은 뷰어를 붙인다.)
  const [receiptViewer, setReceiptViewer] = useState<{ paymentId: string; studentName: string } | null>(null)
  const [receiptSigned, setReceiptSigned] = useState<{ stored: string; url: string }[]>([])
  const [receiptLoading, setReceiptLoading] = useState(false)
  const [receiptZoom, setReceiptZoom] = useState<string | null>(null)

  const loadReceipts = useCallback(async (paymentId: string) => {
    setReceiptLoading(true)
    try {
      const res = await fetch(`/api/special/pay/${paymentId}/receipt`)
      if (!res.ok) { toast.error('영수증을 불러오지 못했습니다'); setReceiptSigned([]); return }
      const { signed } = await res.json() as { signed?: { stored: string; url: string }[] }
      setReceiptSigned(signed ?? [])
    } catch {
      toast.error('영수증을 불러오지 못했습니다'); setReceiptSigned([])
    } finally { setReceiptLoading(false) }
  }, [])

  const openReceiptViewer = useCallback((paymentId: string, studentName: string) => {
    setReceiptViewer({ paymentId, studentName })
    setReceiptZoom(null)
    setReceiptSigned([])
    void loadReceipts(paymentId)
  }, [loadReceipts])

  const handleReceiptDelete = useCallback(async (paymentId: string, stored: string) => {
    if (!confirm('이 영수증 사진을 삭제할까요?')) return
    const res = await fetch(`/api/special/pay/${paymentId}/receipt`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: stored }),
    })
    if (!res.ok) { toast.error('삭제 실패'); return }
    setReceiptZoom(null)
    await loadReceipts(paymentId)
    await mutate()
  }, [loadReceipts, mutate])
  const handleReceiptUpload = useCallback(async (paymentId: string, files: FileList | null) => {
    if (!files || files.length === 0) return
    setReceiptUploading(paymentId)
    try {
      for (const file of Array.from(files)) {
        const blob = await compressImageToBlob(file, 1200, 0.8)
        const fd = new FormData()
        fd.append('file', new File([blob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' }))
        const res = await fetch(`/api/special/pay/${paymentId}/receipt`, { method: 'POST', body: fd })
        if (!res.ok) { const e = await res.json().catch(() => ({})); toast.error(`영수증 업로드 실패: ${e.error || ''}`); await mutate(); return }
      }
      toast.success('영수증 등록 완료')
      await mutate()
    } finally { setReceiptUploading(null) }
  }, [mutate])

  const specialByClass = useMemo(() => {
    const m = new Map<string, SpecialRow>()
    for (const s of data?.special ?? []) m.set(s.class_id, s)
    return m
  }, [data])

  // student_id → 최신 '활성' 특강 청구 (bills는 sent_at desc 정렬).
  // 파기·취소분까지 매핑하면 그 학생이 미청구 집계·일괄청구 대상에서 조용히 빠진다 —
  // 파기했으면 다시 청구할 수 있어야 한다 (2026-08-13 라인리뷰)
  const billByStudent = useMemo(() => {
    const m = new Map<string, SpecialBill>()
    for (const b of data?.bills ?? []) {
      if (b.status !== 'sent' && b.status !== 'paid') continue
      if (!m.has(b.student_id)) m.set(b.student_id, b)
    }
    return m
  }, [data])

  // student_id → 직접 납부 기록
  const payByStudent = useMemo(() => {
    const m = new Map<string, SpecialPayment>()
    for (const p of data?.payments ?? []) if (!m.has(p.student_id)) m.set(p.student_id, p)
    return m
  }, [data])

  const period = useMemo(() => {
    const any = data?.special?.[0]
    if (!any?.period_start || !any?.period_end) return ''
    const f = (s: string) => { const [, m, d] = s.split('-'); return `${Number(m)}/${Number(d)}` }
    return `${f(any.period_start)} ~ ${f(any.period_end)}`
  }, [data])

  // 명단 그룹 특강 — 청구/납부 매핑 (key = student_id|bill_note)
  const groupBillByStudent = useMemo(() => {
    const m = new Map<string, SpecialGroupBill>()
    for (const b of data?.groupBills ?? []) {
      const k = `${b.student_id}|${b.bill_note}`
      if (!m.has(k)) m.set(k, b)
    }
    return m
  }, [data])
  const groupPayByStudent = useMemo(() => {
    const m = new Map<string, SpecialGroupPayment>()
    for (const p of data?.groupPayments ?? []) {
      const k = `${p.student_id}|${p.label}`
      if (!m.has(k)) m.set(k, p)
    }
    return m
  }, [data])
  // 반/그룹별 납부 집계 — 접기 판정과 헤더 배지에 공용. (paid = 직접납부 있거나 청구가 paid)
  const sectionStats = useMemo(() => {
    const m = new Map<string, { paid: number; total: number; fullyPaid: boolean }>()
    for (const grade of grades) {
      for (const cls of (grade.classes ?? [])) {
        if (!specialByClass.has(cls.id)) continue
        const students = ((cls.students ?? []) as { id: string; withdrawal_date?: string | null }[]).filter(isSpecialActive)
        const paid = students.filter(s => !!payByStudent.get(s.id) || billByStudent.get(s.id)?.status === 'paid').length
        m.set(cls.id, { paid, total: students.length, fullyPaid: students.length > 0 && paid === students.length })
      }
    }
    for (const g of data?.groups ?? []) {
      const students = g.students.filter(isSpecialActive)
      const paid = students.filter(s => {
        const k = `${s.id}|${g.bill_note}`
        return !!groupPayByStudent.get(k) || groupBillByStudent.get(k)?.status === 'paid'
      }).length
      m.set(g.id, { paid, total: students.length, fullyPaid: students.length > 0 && paid === students.length })
    }
    return m
  }, [grades, data, specialByClass, billByStudent, payByStudent, groupBillByStudent, groupPayByStudent])

  // 기본 상태: 미납 남은 곳은 펼치고, 전원납부한 곳은 접는다
  useEffect(() => {
    if (sectionStats.size === 0) return
    setExpandedSections(prev => {
      const next = new Set(prev)
      for (const [key, stat] of sectionStats) {
        if (stat.fullyPaid) next.delete(key)
        else next.add(key)
      }
      // 바뀐 게 없으면 같은 참조를 돌려준다 — 새 Set을 매번 만들면 상태가 계속 갱신돼 렌더가 돈다
      if (next.size === prev.size && [...next].every(k => prev.has(k))) return prev
      return next
    })
  }, [sectionStats])

  const [groupMethodPickerFor, setGroupMethodPickerFor] = useState<{ student: SpecialGroupStudent; group: SpecialGroup } | null>(null)
  // 발송된 특강 청구서 액션(파기/취소/재발송) — 납부탭 BillActionModal 재사용
  const [billActionTarget, setBillActionTarget] = useState<{ studentId: string; studentName: string; phone: string; billId: string; amount: number; status: 'sent' | 'paid' | 'cancelled'; billingMonth: string } | null>(null)
  // 그룹을 label별로 묶어 섹션 헤더 분리 (영어 여름특강 / 고2 기하 특강 …)
  const groupsByLabel = useMemo(() => {
    const m = new Map<string, SpecialGroup[]>()
    for (const g of data?.groups ?? []) {
      if (!m.has(g.label)) m.set(g.label, [])
      m.get(g.label)!.push(g)
    }
    return [...m.entries()]
  }, [data])

  // clsName 은 학부모에게 가는 상품명(불변), clsLabel 은 우리 화면용 과목 병기 표기 — 둘을 한 인자로 묶으면
  // 표기를 고칠 때 학부모 문구까지 바뀐다 (2026-08-08)
  const handleBill = useCallback(async (student: Student, sp: SpecialRow, clsName: string, clsLabel: string) => {
    if (billing) return
    const phone = billingPhone(student)
    if (!phone) { toast.error(`${student.name}: 학부모 번호가 없습니다`); return }
    if (!confirm(
      `${student.name} — ${clsLabel} 여름특강\n\n${formatWon(sp.fee)} 청구서를 결제선생으로 발송합니다.\n진행할까요?`,
    )) return
    setBilling(student.id)
    try {
      const r = await fetch('/api/payssam/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id,
          studentName: student.name,
          phone,
          amount: sp.fee,
          billingMonth: SPECIAL_MONTH,
          isRegularTuition: false,
          billNote: SPECIAL_LABEL,
          productName: `${clsName} 여름특강`,
          message: SPECIAL_MESSAGE,
        }),
      })
      const res = await r.json()
      if (!isSendSuccess(r, res)) throw new Error(sendFailReason(r, res))
      if (res.code === 'SCHEDULED') toast.success(`${student.name}: 영업시간 외 — ${res.scheduled_at_kst} 예약 발송`)
      else toast.success(`${student.name}: 특강비 청구서 발송 완료`)
      await mutate()
    } catch (e) {
      toast.error(`발송 실패: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBilling(null)
    }
  }, [billing, mutate])

  // 반별 일괄 청구 — 아직 청구 안 된(bill 없는) 학생 전원에게 순차 발송
  const handleBatch = useCallback(async (clsName: string, sp: SpecialRow, students: Student[], clsLabel: string) => {
    if (batch || billing) return
    // 직접납부(현금 등) 완료자는 청구서 없어도 미청구 아님 — 이중청구 방지 (2026-07-10 전수점검)
    const unbilled = students.filter(s => !billByStudent.get(s.id) && !payByStudent.get(s.id) && !isBatchExcluded(s))
    const targets = unbilled.filter(s => billingPhone(s))
    const noPhone = unbilled.filter(s => !billingPhone(s))
    if (targets.length === 0) {
      toast(noPhone.length ? `청구 대상 없음 (번호 없는 ${noPhone.length}명 제외)` : '이미 전원 청구되었습니다')
      return
    }
    if (!confirm(
      `${clsLabel} — 일괄 특강비 청구\n\n` +
      `미청구 ${targets.length}명에게 ${formatWon(sp.fee)}씩 청구서를 발송합니다.\n` +
      `합계 ${formatWon(sp.fee * targets.length)}` +
      (noPhone.length ? `\n(학부모 번호 없는 ${noPhone.length}명 제외)` : '') +
      `\n\n⚠️ 실제 결제선생 청구서가 발송됩니다. 진행할까요?`,
    )) return
    setBatch({ classId: sp.class_id, done: 0, total: targets.length })
    let ok = 0
    const failed: string[] = []
    for (let i = 0; i < targets.length; i++) {
      const st = targets[i]
      try {
        const r = await fetch('/api/payssam/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId: st.id,
            studentName: st.name,
            phone: billingPhone(st),
            amount: sp.fee,
            billingMonth: SPECIAL_MONTH,
            isRegularTuition: false,
            billNote: SPECIAL_LABEL,
            productName: `${clsName} 여름특강`,
            message: SPECIAL_MESSAGE,
          }),
        })
        const res = await r.json().catch(() => ({}))
        if (isSendSuccess(r, res)) ok++
        else failed.push(`${st.name}(${sendFailReason(r, res)})`)
      } catch { failed.push(`${st.name}(네트워크 오류)`) }
      setBatch(b => (b ? { ...b, done: i + 1 } : b))
    }
    if (failed.length > 0) toast.error(`${clsLabel}: ${ok}/${targets.length}명 발송 — 실패 ${failed.length}명: ${failed.join(', ')}`)
    else toast.success(`${clsLabel}: ${ok}/${targets.length}명 청구서 발송 완료`)
    await mutate()
    setBatch(null)
  }, [batch, billing, billByStudent, payByStudent, mutate])

  // 직접 납부 (현장 카드/현금/이체/PAY 등) — 결제선생 청구와 별개로 즉시 납부 기록
  const handleDirectPay = useCallback(async (student: Student, sp: SpecialRow, method: PaymentMethod) => {
    const label = METHOD_LABELS[method] ?? method
    if (!confirm(`${student.name} — 여름방학 특강비\n\n${formatWon(sp.fee)} · ${label} 납부 처리합니다.\n진행할까요?`)) return
    try {
      const r = await fetch('/api/special/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: student.id, amount: sp.fee, method }),
      })
      const res = await r.json()
      if (!r.ok) throw new Error(res.error || '납부 처리 실패')
      toast.success(`${student.name}: ${label} 납부 완료`)
      await mutate()
    } catch (e) {
      toast.error(`납부 실패: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [mutate])

  // 직접 납부 취소
  const handleCancelPay = useCallback(async (student: Student, payId: string) => {
    if (!confirm(`${student.name} 특강비 납부 기록을 취소합니다.\n진행할까요?`)) return
    try {
      const r = await fetch('/api/special/pay', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: payId }),
      })
      if (!r.ok) throw new Error('취소 실패')
      toast.success(`${student.name}: 납부 취소`)
      await mutate()
    } catch (e) {
      toast.error(`취소 실패: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [mutate])

  // ── 명단 그룹 특강 핸들러 (영어 특강 등) ──
  const handleGroupBill = useCallback(async (student: SpecialGroupStudent, group: SpecialGroup) => {
    if (billing) return
    const phone = billingPhone(student as unknown as Student)
    if (!phone) { toast.error(`${student.name}: 학부모 번호가 없습니다`); return }
    if (!confirm(`${student.name} — ${group.name}\n\n${formatWon(group.fee)} 청구서를 결제선생으로 발송합니다.\n진행할까요?`)) return
    setBilling(student.id)
    try {
      const r = await fetch('/api/payssam/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id, studentName: student.name, phone,
          amount: group.fee, billingMonth: SPECIAL_MONTH, isRegularTuition: false,
          billNote: group.bill_note, productName: group.product_name ?? group.name,
          message: `${student.name} ${group.label} 안내입니다.`,
        }),
      })
      const res = await r.json()
      if (!isSendSuccess(r, res)) throw new Error(sendFailReason(r, res))
      if (res.code === 'SCHEDULED') toast.success(`${student.name}: 영업시간 외 — ${res.scheduled_at_kst} 예약 발송`)
      else toast.success(`${student.name}: 특강비 청구서 발송 완료`)
      await mutate()
    } catch (e) {
      toast.error(`발송 실패: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBilling(null)
    }
  }, [billing, mutate])

  const handleGroupBatch = useCallback(async (group: SpecialGroup) => {
    if (batch || billing) return
    const students = group.students.filter(isSpecialActive)
    // 직접납부 완료자 제외 — 헤더 카운트(groupPayByStudent 반영)와 동일 기준, 이중청구 방지 (2026-07-10)
    const unbilled = students.filter(s =>
      !groupBillByStudent.get(`${s.id}|${group.bill_note}`) && !groupPayByStudent.get(`${s.id}|${group.bill_note}`)
      && !isBatchExcluded(s))
    const targets = unbilled.filter(s => billingPhone(s as unknown as Student))
    const noPhone = unbilled.filter(s => !billingPhone(s as unknown as Student))
    if (targets.length === 0) {
      toast(noPhone.length ? `청구 대상 없음 (번호 없는 ${noPhone.length}명 제외)` : '이미 전원 청구되었습니다')
      return
    }
    if (!confirm(
      `${group.name} — 일괄 특강비 청구\n\n` +
      `미청구 ${targets.length}명에게 ${formatWon(group.fee)}씩 청구서를 발송합니다.\n` +
      `합계 ${formatWon(group.fee * targets.length)}` +
      (noPhone.length ? `\n(학부모 번호 없는 ${noPhone.length}명 제외)` : '') +
      `\n\n⚠️ 실제 결제선생 청구서가 발송됩니다. 진행할까요?`,
    )) return
    setBatch({ classId: group.id, done: 0, total: targets.length })
    let ok = 0
    const failed: string[] = []
    for (let i = 0; i < targets.length; i++) {
      const st = targets[i]
      try {
        const r = await fetch('/api/payssam/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId: st.id, studentName: st.name, phone: billingPhone(st as unknown as Student),
            amount: group.fee, billingMonth: SPECIAL_MONTH, isRegularTuition: false,
            billNote: group.bill_note, productName: group.product_name ?? group.name,
            message: `${st.name} ${group.label} 안내입니다.`,
          }),
        })
        const res = await r.json().catch(() => ({}))
        if (isSendSuccess(r, res)) ok++
        else failed.push(`${st.name}(${sendFailReason(r, res)})`)
      } catch { failed.push(`${st.name}(네트워크 오류)`) }
      setBatch(b => (b ? { ...b, done: i + 1 } : b))
    }
    if (failed.length > 0) toast.error(`${group.name}: ${ok}/${targets.length}명 발송 — 실패 ${failed.length}명: ${failed.join(', ')}`)
    else toast.success(`${group.name}: ${ok}/${targets.length}명 청구서 발송 완료`)
    await mutate()
    setBatch(null)
  }, [batch, billing, groupBillByStudent, groupPayByStudent, mutate])

  const handleGroupDirectPay = useCallback(async (student: SpecialGroupStudent, group: SpecialGroup, method: PaymentMethod) => {
    const label = METHOD_LABELS[method] ?? method
    if (!confirm(`${student.name} — ${group.name}\n\n${formatWon(group.fee)} · ${label} 납부 처리합니다.\n진행할까요?`)) return
    try {
      const r = await fetch('/api/special/pay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: student.id, amount: group.fee, method, label: group.bill_note }),
      })
      const res = await r.json()
      if (!r.ok) throw new Error(res.error || '납부 처리 실패')
      toast.success(`${student.name}: ${label} 납부 완료`)
      await mutate()
    } catch (e) {
      toast.error(`납부 실패: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [mutate])

  return (
    <div className="pt-4 pb-24">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-1">
        <Flame className="w-5 h-5 text-[var(--orange)]" />
        <h1 className="text-lg font-bold text-[var(--text-1)]">여름방학 특강</h1>
      </div>
      {period && <p className="text-[12px] text-[var(--text-4)] mb-4">특강기간 {period} · 결제일 7/23</p>}

      {loading ? (
        <SpecialSkeleton />
      ) : (
      <>
      {grades.map(grade => (
        <div key={grade.id} className="mb-6">
          <h2 className="text-base font-bold text-[var(--text-2)] mb-2">{grade.name}</h2>
          <div className="space-y-3">
            {(grade.classes ?? []).map(cls => {
              const sp = specialByClass.get(cls.id)
              const students = (cls.students ?? []).filter(isSpecialActive)
              const stat = sectionStats.get(cls.id)
              const isExpanded = !sp || expandedSections.has(cls.id)
              return (
                <div key={cls.id} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
                  <div
                    className={`flex items-start justify-between gap-2 px-4 py-2.5 bg-[var(--bg-card-hover)]/50 ${isExpanded ? 'border-b border-[var(--border)]' : ''} ${sp ? 'cursor-pointer active:bg-[var(--bg-elevated)] select-none' : ''}`}
                    onClick={sp ? () => toggleSection(cls.id) : undefined}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                      {sp && (
                        <ChevronRight
                          className={`w-3.5 h-3.5 shrink-0 text-[var(--text-4)] transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                        />
                      )}
                      {/* 과목 병기(수학H) — subject 칩은 formatClassName 에 흡수돼 제거 (중복 표기 방지) */}
                      <span className="text-sm font-bold text-[var(--text-1)] whitespace-nowrap">{formatClassName(cls)}</span>
                      {sp?.teacher_note && <span className="text-[11px] text-[var(--text-3)] whitespace-nowrap">· {sp.teacher_note}</span>}
                      {sp?.hours_note && <span className="text-[11px] text-[var(--text-4)] whitespace-nowrap">· {sp.hours_note}</span>}
                    </div>
                    {sp ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold text-[var(--blue)] whitespace-nowrap">{formatWon(sp.fee)}</span>
                        {stat && stat.total > 0 && (
                          stat.fullyPaid ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--paid-bg)] text-[var(--paid-text)] tracking-tight whitespace-nowrap">
                              전원납부 {stat.paid}/{stat.total}
                            </span>
                          ) : (
                            <span className="text-[11px] text-[var(--text-4)] whitespace-nowrap tabular-nums">{stat.paid}/{stat.total}</span>
                          )
                        )}
                        {(() => {
                          const pendingN = students.filter(s => !billByStudent.get(s.id) && !payByStudent.get(s.id) && !isBatchExcluded(s)).length
                          if (pendingN === 0) return null
                          const isBatching = batch?.classId === sp.class_id
                          return (
                            <TButton
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleBatch(`${grade.name}${cls.name}`, sp, students, `${grade.name} ${formatClassName(cls)}`) }}
                              disabled={!!batch || !!billing}
                              className="flex items-center gap-0.5 text-[11px] font-bold text-white bg-[var(--blue)] px-2 py-0.5 rounded-full hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap"
                            >
                              {isBatching && batch
                                ? <><Loader2 className="w-3 h-3 animate-spin" />{batch.done}/{batch.total}</>
                                : <><Send className="w-3 h-3" />일괄청구 {pendingN}</>}
                            </TButton>
                          )
                        })()}
                      </div>
                    ) : (
                      <span className="text-[12px] font-semibold text-[var(--text-4)] shrink-0">특강 없음</span>
                    )}
                  </div>

                  {sp && isExpanded && (
                    <div className="divide-y divide-[var(--border)]">
                      {students.length === 0 ? (
                        <p className="px-4 py-3 text-[12px] text-[var(--text-4)]">학생 없음</p>
                      ) : students.map((student, idx) => {
                        const bill = billByStudent.get(student.id)
                        const directPay = payByStudent.get(student.id)
                        const isPaid = !!directPay || bill?.status === 'paid'
                        const isSent = !isPaid && bill?.status === 'sent'
                        const isBusy = billing === student.id
                        return (
                          <div key={student.id} className="flex items-center justify-between gap-2 px-4 py-2">
                            <span className="text-sm text-[var(--text-2)] min-w-0">
                              <span className="text-[11px] text-[var(--text-4)] mr-1 tabular-nums">{idx + 1}.</span>
                              {student.name}
                              {/* 이 달 일괄청구 제외 = 청구를 만들면 안 되는 학생(현장결제·정산 등).
                                  일괄에서 빼는 것만으론 부족하다 — 옆의 개별 '청구' 버튼은 그대로 눌리고,
                                  그 사유(예: 그 학생만 다른 금액)는 이 화면 어디에도 안 보인다.
                                  2026-08-05 정국: 반 정가 100,000 인데 5만으로 정해진 건이었다. */}
                              {isBatchExcluded(student) && (
                                <span className="text-[9px] ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--orange-dim)] text-[var(--orange)] font-bold whitespace-nowrap">
                                  청구 제외 · 메모 확인
                                </span>
                              )}
                            </span>
                            {isPaid ? (
                              <span className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => directPay ? handleCancelPay(student, directPay.id) : undefined}
                                  className="flex items-center gap-0.5 text-[11px] font-bold text-[var(--paid-text)] bg-[var(--paid-bg)] px-2 py-0.5 rounded-full"
                                  title={directPay ? '탭하면 납부 취소' : '결제선생 결제완료'}
                                >
                                  <Check className="w-3 h-3" /> 납부완료{directPay ? ` · ${METHOD_LABELS[directPay.method] ?? directPay.method}` : ''}
                                </button>
                                {directPay && (directPay.method === 'card' || directPay.method === 'pay') && (
                                  <ReceiptBadge
                                    payment={directPay}
                                    studentName={student.name}
                                    uploading={receiptUploading === directPay.id}
                                    onView={openReceiptViewer}
                                    onUpload={handleReceiptUpload}
                                  />
                                )}
                              </span>
                            ) : isSent ? (
                              <span className="flex items-center gap-1.5 shrink-0">
                                <TButton
                                  type="button"
                                  onClick={() => bill && setBillActionTarget({ studentId: student.id, studentName: student.name, phone: billingPhone(student) ?? '', billId: bill.bill_id, amount: bill.amount, status: 'sent', billingMonth: SPECIAL_MONTH })}
                                  className="flex items-center gap-0.5 text-[11px] font-bold text-[var(--orange)] bg-[var(--orange-dim)] px-2 py-0.5 rounded-full hover:opacity-90 active:scale-95 transition-all"
                                  title="탭하면 파기/취소/재발송"
                                >
                                  <Clock className="w-3 h-3" /> 발송됨
                                </TButton>
                                <TButton
                                  type="button"
                                  onClick={(e) => { methodAnchorRef.current = e.currentTarget as HTMLButtonElement; setMethodPickerFor({ student, sp }) }}
                                  className="flex items-center gap-0.5 text-[11px] font-bold text-[var(--blue)] bg-[var(--blue-dim)] px-2 py-0.5 rounded-full hover:opacity-90 active:scale-95 transition-all"
                                  title="현장 직접 납부"
                                >
                                  <Wallet className="w-3 h-3" /> 납부
                                </TButton>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 shrink-0">
                                <TButton
                                  type="button"
                                  onClick={() => handleBill(student, sp, `${grade.name}${cls.name}`, `${grade.name} ${formatClassName(cls)}`)}
                                  disabled={isBusy}
                                  className="flex items-center gap-0.5 text-[11px] font-bold text-white bg-[var(--blue)] px-2 py-0.5 rounded-full hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                                >
                                  {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                                  청구
                                </TButton>
                                <TButton
                                  type="button"
                                  onClick={(e) => { methodAnchorRef.current = e.currentTarget as HTMLButtonElement; setMethodPickerFor({ student, sp }) }}
                                  className="flex items-center gap-0.5 text-[11px] font-bold text-[var(--blue)] bg-[var(--blue-dim)] px-2 py-0.5 rounded-full hover:opacity-90 active:scale-95 transition-all"
                                  title="현장 직접 납부"
                                >
                                  <Wallet className="w-3 h-3" /> 납부
                                </TButton>
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* 명단 그룹 특강 (영어 특강·고2 기하 등 — 정규반과 별개 명단, label별 섹션) */}
      {groupsByLabel.map(([label, grps]) => (
        <div key={label} className="mb-6">
          <h2 className="text-base font-bold text-[var(--text-2)] mb-2">{label}</h2>
          <div className="space-y-3">
            {grps.map(group => {
              const students = group.students.filter(isSpecialActive)
              const pendingN = students.filter(s =>
                !groupBillByStudent.get(`${s.id}|${group.bill_note}`) && !groupPayByStudent.get(`${s.id}|${group.bill_note}`)
                && !isBatchExcluded(s),
              ).length
              const isBatching = batch?.classId === group.id
              const groupStat = sectionStats.get(group.id)
              const isGroupExpanded = expandedSections.has(group.id)
              return (
                <div key={group.id} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
                  <div
                    className={`flex items-start justify-between gap-2 px-4 py-2.5 bg-[var(--bg-card-hover)]/50 ${isGroupExpanded ? 'border-b border-[var(--border)]' : ''} cursor-pointer active:bg-[var(--bg-elevated)] select-none`}
                    onClick={() => toggleSection(group.id)}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                        <ChevronRight
                          className={`w-3.5 h-3.5 shrink-0 text-[var(--text-4)] transition-transform duration-200 ${isGroupExpanded ? 'rotate-90' : ''}`}
                        />
                        <span className="text-sm font-bold text-[var(--text-1)] whitespace-nowrap">{group.name}</span>
                        <span className="text-sm font-bold text-[var(--blue)] whitespace-nowrap">{formatWon(group.fee)}</span>
                        {groupStat && groupStat.total > 0 && (
                          groupStat.fullyPaid ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--paid-bg)] text-[var(--paid-text)] tracking-tight whitespace-nowrap">
                              전원납부 {groupStat.paid}/{groupStat.total}
                            </span>
                          ) : (
                            <span className="text-[11px] text-[var(--text-4)] whitespace-nowrap tabular-nums">{groupStat.paid}/{groupStat.total}</span>
                          )
                        )}
                      </div>
                      {group.schedule_note && <p className="text-[11px] text-[var(--text-3)] mt-0.5 leading-relaxed">{group.schedule_note}</p>}
                    </div>
                    {pendingN > 0 && (
                      <TButton
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleGroupBatch(group) }}
                        disabled={!!batch || !!billing}
                        className="flex items-center gap-0.5 text-[11px] font-bold text-white bg-[var(--blue)] px-2 py-0.5 rounded-full hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap shrink-0 mt-0.5"
                      >
                        {isBatching && batch
                          ? <><Loader2 className="w-3 h-3 animate-spin" />{batch.done}/{batch.total}</>
                          : <><Send className="w-3 h-3" />일괄청구 {pendingN}</>}
                      </TButton>
                    )}
                  </div>
                  {isGroupExpanded && (
                  <div className="divide-y divide-[var(--border)]">
                    {students.map((student, idx) => {
                      const bill = groupBillByStudent.get(`${student.id}|${group.bill_note}`)
                      const directPay = groupPayByStudent.get(`${student.id}|${group.bill_note}`)
                      const isPaid = !!directPay || bill?.status === 'paid'
                      const isSent = !isPaid && bill?.status === 'sent'
                      const isBusy = billing === student.id
                      return (
                        <div key={student.id} className="flex items-center justify-between gap-2 px-4 py-2">
                          <span className="text-sm text-[var(--text-2)] min-w-0">
                            <span className="text-[11px] text-[var(--text-4)] mr-1 tabular-nums">{idx + 1}.</span>
                            {student.name}
                          </span>
                          {isPaid ? (
                            <span className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => directPay ? handleCancelPay(student as unknown as Student, directPay.id) : undefined}
                                className="flex items-center gap-0.5 text-[11px] font-bold text-[var(--paid-text)] bg-[var(--paid-bg)] px-2 py-0.5 rounded-full"
                                title={directPay ? '탭하면 납부 취소' : '결제선생 결제완료'}
                              >
                                <Check className="w-3 h-3" /> 납부완료{directPay ? ` · ${METHOD_LABELS[directPay.method] ?? directPay.method}` : ''}
                              </button>
                              {directPay && (directPay.method === 'card' || directPay.method === 'pay') && (
                                <ReceiptBadge
                                  payment={directPay}
                                  studentName={student.name}
                                  uploading={receiptUploading === directPay.id}
                                  onView={openReceiptViewer}
                                  onUpload={handleReceiptUpload}
                                />
                              )}
                            </span>
                          ) : isSent ? (
                            <span className="flex items-center gap-1.5 shrink-0">
                              <TButton
                                type="button"
                                onClick={() => bill && setBillActionTarget({ studentId: student.id, studentName: student.name, phone: billingPhone(student as unknown as Student) ?? '', billId: bill.bill_id, amount: bill.amount, status: 'sent', billingMonth: SPECIAL_MONTH })}
                                className="flex items-center gap-0.5 text-[11px] font-bold text-[var(--orange)] bg-[var(--orange-dim)] px-2 py-0.5 rounded-full hover:opacity-90 active:scale-95 transition-all"
                                title="탭하면 파기/취소/재발송"
                              >
                                <Clock className="w-3 h-3" /> 발송됨
                              </TButton>
                              <TButton
                                type="button"
                                onClick={(e) => { methodAnchorRef.current = e.currentTarget as HTMLButtonElement; setGroupMethodPickerFor({ student, group }) }}
                                className="flex items-center gap-0.5 text-[11px] font-bold text-[var(--blue)] bg-[var(--blue-dim)] px-2 py-0.5 rounded-full hover:opacity-90 active:scale-95 transition-all"
                                title="현장 직접 납부"
                              >
                                <Wallet className="w-3 h-3" /> 납부
                              </TButton>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 shrink-0">
                              <TButton
                                type="button"
                                onClick={() => handleGroupBill(student, group)}
                                disabled={isBusy}
                                className="flex items-center gap-0.5 text-[11px] font-bold text-white bg-[var(--blue)] px-2 py-0.5 rounded-full hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                              >
                                {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                                청구
                              </TButton>
                              <TButton
                                type="button"
                                onClick={(e) => { methodAnchorRef.current = e.currentTarget as HTMLButtonElement; setGroupMethodPickerFor({ student, group }) }}
                                className="flex items-center gap-0.5 text-[11px] font-bold text-[var(--blue)] bg-[var(--blue-dim)] px-2 py-0.5 rounded-full hover:opacity-90 active:scale-95 transition-all"
                                title="현장 직접 납부"
                              >
                                <Wallet className="w-3 h-3" /> 납부
                              </TButton>
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {grades.length === 0 && (
        <div className="flex items-center justify-center py-20 text-[var(--text-4)]">특강 대상 반이 없습니다</div>
      )}
      </>
      )}

      {/* 직접 납부 결제수단 선택 (납부탭과 동일 UX) */}
      {methodPickerFor && (
        <MethodPickerPopup
          currentMethod="card"
          anchorRef={methodAnchorRef}
          onClose={() => setMethodPickerFor(null)}
          onMethodChange={(m) => {
            const { student, sp } = methodPickerFor
            setMethodPickerFor(null)
            handleDirectPay(student, sp, m)
          }}
        />
      )}

      {/* 명단 그룹 특강 직접 납부 결제수단 선택 */}
      {groupMethodPickerFor && (
        <MethodPickerPopup
          currentMethod="card"
          anchorRef={methodAnchorRef}
          onClose={() => setGroupMethodPickerFor(null)}
          onMethodChange={(m) => {
            const { student, group } = groupMethodPickerFor
            setGroupMethodPickerFor(null)
            handleGroupDirectPay(student, group, m)
          }}
        />
      )}

      {/* 발송된 특강 청구서 액션 — 파기/취소/재발송 (납부탭과 동일 모달 재사용) */}
      {billActionTarget && (
        <BillActionModal
          studentId={billActionTarget.studentId}
          studentName={billActionTarget.studentName}
          phone={billActionTarget.phone}
          billId={billActionTarget.billId}
          amount={billActionTarget.amount}
          status={billActionTarget.status}
          billingMonth={billActionTarget.billingMonth}
          subject={null}
          onClose={() => setBillActionTarget(null)}
          onSuccess={() => { setBillActionTarget(null); mutate() }}
        />
      )}

      {/* 영수증 뷰어 — 이미 올린 사진 보기 + 추가/삭제 (2026-07-26 신설) */}
      <AnimatedModal open={!!receiptViewer} onClose={() => { setReceiptViewer(null); setReceiptZoom(null) }} maxWidth="max-w-lg" variant="sheet">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-[var(--text-1)]">
              {receiptViewer?.studentName} 영수증
            </h3>
            {receiptViewer && (
              <label className="cursor-pointer text-xs font-bold text-[var(--accent)] bg-[var(--accent-dim)] px-3 py-1.5 rounded-full flex items-center gap-1 active:scale-95 transition-transform">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async e => {
                    // e.currentTarget은 await 뒤 null — 먼저 잡아둬야 TypeError로 아래 갱신이 끊기지 않는다 (2026-08-13 라인리뷰)
                    const input = e.currentTarget
                    const pid = receiptViewer.paymentId
                    await handleReceiptUpload(pid, input.files)
                    input.value = ''
                    await loadReceipts(pid)
                  }}
                />
                {receiptUploading === receiptViewer.paymentId
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Camera className="w-3.5 h-3.5" />}
                사진 추가
              </label>
            )}
          </div>

          {receiptLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {[0, 1].map(i => (
                <div key={i} className="aspect-square rounded-xl bg-[var(--bg-elevated)] animate-pulse" />
              ))}
            </div>
          ) : receiptSigned.length === 0 ? (
            <p className="text-sm text-[var(--text-4)] py-8 text-center">등록된 영수증이 없습니다</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {receiptSigned.map(({ stored, url }) => (
                <div key={stored} className="relative group">
                  <button
                    type="button"
                    onClick={() => setReceiptZoom(url)}
                    className="w-full aspect-square overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] active:scale-95 transition-transform"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="영수증" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  </button>
                  <button
                    type="button"
                    onClick={() => receiptViewer && handleReceiptDelete(receiptViewer.paymentId, stored)}
                    className="absolute top-1.5 right-1.5 text-[10px] font-bold text-[var(--red)] bg-[var(--bg-1)]/90 px-2 py-1 rounded-full"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </AnimatedModal>

      {/* 확대 보기 */}
      <AnimatedModal open={!!receiptZoom} onClose={() => setReceiptZoom(null)} maxWidth="max-w-3xl">
        {receiptZoom && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={receiptZoom} alt="영수증 확대" className="w-full h-auto rounded-xl" />
        )}
      </AnimatedModal>
    </div>
  )
}

// 영수증 배지 — 사진이 있으면 '보기'(뷰어), 없으면 바로 업로드.
// 2026-07-26 이전엔 항상 업로드 label이라, 이미 올린 사진을 보려고 눌러도 파일 선택창만 떴다.
function ReceiptBadge({
  payment, studentName, uploading, onView, onUpload,
}: {
  payment: { id: string; receipt_images?: string[] | null }
  studentName: string
  uploading: boolean
  onView: (paymentId: string, studentName: string) => void
  onUpload: (paymentId: string, files: FileList | null) => void
}) {
  const count = payment.receipt_images?.length ?? 0

  if (uploading) {
    return <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-4)]" />
  }

  if (count > 0) {
    return (
      <button
        type="button"
        onClick={() => onView(payment.id, studentName)}
        title={`영수증 ${count}장 보기`}
        className="flex items-center gap-0.5 text-[10px] font-bold text-[var(--paid-text)] bg-[var(--paid-bg)] px-1.5 py-0.5 rounded-full active:scale-95 transition-transform"
      >
        <Camera className="w-3 h-3" />{count}
      </button>
    )
  }

  return (
    <label className="cursor-pointer flex items-center" title="영수증 사진 등록">
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { onUpload(payment.id, e.target.files); e.currentTarget.value = '' }}
      />
      <span className="flex items-center gap-0.5 text-[10px] font-bold text-[var(--orange)] bg-[var(--orange-dim)] px-1.5 py-0.5 rounded-full animate-pulse">
        <Camera className="w-3 h-3" />영수증
      </span>
    </label>
  )
}
