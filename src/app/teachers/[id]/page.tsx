'use client'

import { toast } from 'sonner'
import { useState, useMemo, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Plus, Trash2, X, Check, Download } from 'lucide-react'
import { TButton } from '@/components/motion'
import EmptyState from '@/components/ui/EmptyState'
import type { GradeWithClasses, Payment, Teacher } from '@/types'
import { getStudentFee, getPaymentStatus, PAYMENT_STATUS_LABELS, parseClassDays, countClassDays, DAY_LABELS } from '@/types'
import { getActiveStudents, useGrades, usePayments, getCurrentMonth, formatMonth, safeMutate, swrFetcher } from '@/lib/utils'
import { calcTeacherPay, DEFAULT_PAY_RATIO } from '@/lib/salary'
import useSWR from 'swr'
import { formatWonNeg, formatClassName } from '@/lib/format'

// 세율·기본배분율은 @/lib/salary 단일 소스
const DEFAULT_RATIO = DEFAULT_PAY_RATIO

const fetcher = swrFetcher

// 급여명세서 HTML은 iframe doc.write로 들어간다(same-origin = 스크립트 실행됨).
// 학생명·반명·메모에 '<'·'&'가 오면 명세서가 조용히 깨진다 — 보간값은 전부 이스케이프 (2026-08-13 라인리뷰)
const esc = (v: string | null | undefined): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export default function TeacherDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: teacherId } = use(params)
  const router = useRouter()

  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth)
  const [editingRatio, setEditingRatio] = useState(false)
  const [ratioInput, setRatioInput] = useState('')

  const { data: teacher, mutate: mutateTeacher } = useSWR<Teacher>(`/api/teachers/${teacherId}`, fetcher)
  const { data: grades = [] } = useGrades<GradeWithClasses[]>()
  const { data: paymentsData, isLoading: paymentsLoading, error: paymentsError } = usePayments<Payment[]>(selectedMonth)
  const payments = useMemo(() => paymentsData ?? [], [paymentsData])
  const { data: bonusesData, isLoading: bonusesLoading, error: bonusesError, mutate: mutateBonuses } = useSWR<{ id: string; amount: number; memo: string | null; billing_month: string }[]>(
    `/api/teacher-bonuses?teacher_id=${teacherId}&billing_month=${selectedMonth}`, fetcher
  )
  const bonuses = useMemo(() => bonusesData ?? [], [bonusesData])
  // 과거 달 급여명세서는 그 달 스냅샷 요금으로 — 요금/선택과목 변동이 전달 명세서의
  // 원비·미납 표시를 바꾸지 않게 (2026-07-10 지시, 납부탭 feeForMonth와 동일 원리)
  const { data: feeSnapshotRows, isLoading: snapshotsLoading, error: snapshotsError } = useSWR<{ student_id: string; month: string; fee: number }[]>(
    `/api/fee-snapshots?months=${selectedMonth}`, fetcher
  )
  const feeSnapshots = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of Array.isArray(feeSnapshotRows) ? feeSnapshotRows : []) m.set(r.student_id, r.fee)
    return m
  }, [feeSnapshotRows])
  const currentKstMonth = getCurrentMonth()
  const feeFor = useMemo(() => (
    selectedMonth < currentKstMonth
      ? (id: string, liveFee: number) => feeSnapshots.get(id) ?? liveFee
      : (_id: string, liveFee: number) => liveFee
  ), [selectedMonth, currentKstMonth, feeSnapshots])
  // 수납/보너스/스냅샷 로딩 완료 전 PDF를 뽑으면 0원/오표시 명세서가 출력됨 (2026-07-10 전수점검 L4)
  const payrollLoading = paymentsLoading || bonusesLoading || snapshotsLoading
  // SWR error를 안 보면 조회 실패가 '수납 0원 명세서'로 fail-open — 정상 화면과 구분 불가 (2026-08-13 라인리뷰)
  const payrollError = !!(paymentsError || bonusesError || snapshotsError)

  // 보너스 추가 폼
  const [addingBonus, setAddingBonus] = useState(false)
  const [bonusAmount, setBonusAmount] = useState('')
  const [bonusMemo, setBonusMemo] = useState('')
  const [bonusSaving, setBonusSaving] = useState(false)

  const navigateMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // 이 선생님의 반 + 학생 목록 — 학년 오름차순 → 반 order_index
  const teacherClasses = useMemo(() =>
    [...grades]
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
      .flatMap(g =>
        [...g.classes]
          .filter(c => c.teacher_id === teacherId)
          .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
          .map(c => ({ ...c, gradeName: g.name }))
      )
  , [grades, teacherId])

  const teacherStudents = useMemo(() =>
    teacherClasses.flatMap(c =>
      getActiveStudents(c.students ?? [], selectedMonth).map(s => ({ ...s, class: c }))
    )
  , [teacherClasses, selectedMonth])

  // 납부 집계
  const paidByStudentId = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of payments) map.set(p.student_id, (map.get(p.student_id) ?? 0) + p.amount)
    return map
  }, [payments])

  const getStudentPaid = useCallback((studentId: string) =>
    paidByStudentId.get(studentId) ?? 0
  , [paidByStudentId])

  const payRatio = teacher?.pay_ratio ?? DEFAULT_RATIO

  // 급여 계산
  const payroll = useMemo(() => {
    const totalFee = teacherStudents.reduce((sum, s) => sum + feeFor(s.id, getStudentFee(s, s.class)), 0)
    const totalPaid = teacherStudents.reduce((sum, s) => sum + getStudentPaid(s.id), 0)
    const totalBonus = bonuses.reduce((sum, b) => sum + b.amount, 0)
    const pay = calcTeacherPay(totalPaid, payRatio, totalBonus) // 급여 수식은 @/lib/salary 단일 소스
    return { totalFee, totalPaid, teacherShare: pay.share, totalBonus, grossPay: pay.gross, tax: pay.tax, netPay: pay.net }
  }, [teacherStudents, getStudentPaid, bonuses, payRatio, feeFor])

  // 반별 수업시수 계산 (해당 월의 수업일수)
  const classSessionCounts = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const monthStart = new Date(y, m - 1, 1)
    const monthEnd = new Date(y, m, 1)
    const map = new Map<string, number>()
    for (const cls of teacherClasses) {
      const days = parseClassDays(cls.class_days)
      if (days && days.length > 0) {
        map.set(cls.id, countClassDays(monthStart, monthEnd, days))
      }
    }
    return map
  }, [teacherClasses, selectedMonth])

  // 학생별 상세 정보 (반별 그룹핑)
  const classDetails = useMemo(() =>
    teacherClasses.map(cls => {
      const students = getActiveStudents(cls.students ?? [], selectedMonth)
      const sessionCount = classSessionCounts.get(cls.id)
      const days = parseClassDays(cls.class_days)
      const studentDetails = students.map(s => {
        const fee = feeFor(s.id, getStudentFee(s, cls)) // 과거 달=그 달 스냅샷 (2026-07-10)
        const paid = getStudentPaid(s.id)
        const status = getPaymentStatus(paid, fee)
        return { ...s, fee, paid, status }
      })
      const clsFee = studentDetails.reduce((sum, s) => sum + s.fee, 0)
      const clsPaid = studentDetails.reduce((sum, s) => sum + s.paid, 0)
      return { cls, students: studentDetails, sessionCount, days, clsFee, clsPaid }
    })
  , [teacherClasses, selectedMonth, classSessionCounts, getStudentPaid, feeFor])

  // PDF 다운로드
  const downloadPayslipPDF = useCallback(() => {
    if (!teacher) return
    if (payrollLoading) { toast.info('수납 데이터를 불러오는 중입니다. 잠시 후 다시 시도하세요.'); return }
    if (payrollError) { toast.error('수납/보너스 데이터를 불러오지 못했습니다 — 0원 명세서 방지를 위해 인쇄를 막았습니다. 새로고침 후 다시 시도하세요.'); return }
    const [y, m] = selectedMonth.split('-').map(Number)
    const monthLabel = `${y}년 ${m}월`

    // HTML 기반 PDF 생성 (인쇄용)
    const statusLabel = (s: string) => s === 'paid' ? '완납' : s === 'partial' ? '부분' : '미납'
    const statusColor = (s: string) => s === 'paid' ? 'var(--paid-text)' : s === 'partial' ? 'var(--scheduled-text)' : 'var(--unpaid-text)'

    let studentRows = ''
    let rowNum = 0
    for (const cd of classDetails) {
      for (const s of cd.students) {
        rowNum++
        studentRows += `
          <tr style="border-bottom:1px dashed var(--border);">
            <td style="padding:6px 8px;text-align:center;font-size:12px;">${rowNum}</td>
            <td style="padding:6px 8px;font-size:12px;">${esc(formatClassName(cd.cls))}</td>
            <td style="padding:6px 8px;font-size:12px;font-weight:500;">${esc(s.name)}</td>
            <td style="padding:6px 8px;text-align:right;font-size:12px;">${s.fee.toLocaleString()}</td>
            <td style="padding:6px 8px;text-align:right;font-size:12px;">${s.paid.toLocaleString()}</td>
            <td style="padding:6px 8px;text-align:center;font-size:11px;color:${statusColor(s.status)};font-weight:600;">${s.status !== 'paid' ? statusLabel(s.status) : ''}</td>
          </tr>`
      }
    }

    let classInfoRows = ''
    for (const cd of classDetails) {
      const daysLabel = cd.days ? cd.days.map(d => DAY_LABELS[d]).join(', ') : '-'
      classInfoRows += `
        <tr style="border-bottom:1px dashed var(--border);">
          <td style="padding:6px 8px;font-size:12px;font-weight:500;">${esc(formatClassName(cd.cls))}</td>
          <td style="padding:6px 8px;text-align:center;font-size:12px;">${cd.students.length}명</td>
          <td style="padding:6px 8px;text-align:center;font-size:12px;">${daysLabel}</td>
          <td style="padding:6px 8px;text-align:center;font-size:12px;">${cd.sessionCount ?? '-'}회</td>
          <td style="padding:6px 8px;text-align:right;font-size:12px;">${cd.clsFee.toLocaleString()}원</td>
          <td style="padding:6px 8px;text-align:right;font-size:12px;">${cd.clsPaid.toLocaleString()}원</td>
        </tr>`
    }

    let bonusRows = ''
    if (bonuses.length > 0) {
      for (const b of bonuses) {
        bonusRows += `
          <tr style="border-bottom:1px dashed var(--border);">
            <td style="padding:6px 8px;font-size:12px;">${esc(b.memo || '보너스')}</td>
            <td style="padding:6px 8px;text-align:right;font-size:12px;">+${b.amount.toLocaleString()}원</td>
          </tr>`
      }
    }

    const unpaidCount = classDetails.reduce((sum, cd) => sum + cd.students.filter(s => s.status !== 'paid').length, 0)
    const paidCount = classDetails.reduce((sum, cd) => sum + cd.students.filter(s => s.status === 'paid').length, 0)

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>급여명세서 - ${esc(teacher.name)} ${monthLabel}</title>
<style>
  :root { ${['--blue', '--blue-bg', '--border', '--bg-card-hover', '--text-1', '--text-2', '--text-3', '--text-4', '--paid-text', '--scheduled-text', '--unpaid-text', '--green', '--red'].map(token => `${token}:${getComputedStyle(document.documentElement).getPropertyValue(token)}`).join(';')} }
  @page { size: A4; margin: 15mm; }
  body { font-family: -apple-system, 'Malgun Gothic', sans-serif; color: var(--text-1); line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; }
  .header { text-align: center; margin-bottom: 24px; border-bottom: 3px solid var(--blue); padding-bottom: 16px; }
  .header h1 { font-size: 22px; color: var(--blue); margin: 0 0 4px; }
  .header p { font-size: 13px; color: var(--text-3); margin: 0; }
  .section { margin-bottom: 20px; }
  .section h2 { font-size: 14px; font-weight: 700; color: var(--blue); margin: 0 0 8px; padding-bottom: 4px; border-bottom: 2px solid var(--blue); }
  .summary-table td { padding: 8px; font-size: 13px; }
  .summary-label { color: var(--text-3); width: 40%; }
  .summary-value { text-align: right; font-weight: 600; }
  .total-row { background: var(--blue-bg); }
  .total-row td { font-weight: 700 !important; font-size: 15px !important; color: var(--blue); }
  th { background: var(--bg-card-hover); font-size: 11px; font-weight: 600; color: var(--text-2); padding: 6px 8px; text-align: left; }
  .footer { margin-top: 32px; text-align: center; font-size: 11px; color: var(--text-4); }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; }
</style></head><body>
<div class="header">
  <h1>급여명세서</h1>
  <p>${monthLabel} | ${esc(teacher.name)} 선생님${teacher.subject ? ' | ' + esc(teacher.subject) : ''}</p>
  <p style="font-size:11px;color:var(--text-4);margin-top:4px;">급여일: ${m === 12 ? y + 1 : y}년 ${m === 12 ? 1 : m + 1}월 1일</p>
</div>

<div class="section">
  <h2>수업 현황</h2>
  <table>
    <thead><tr>
      <th>반</th><th style="text-align:center;">학생수</th><th style="text-align:center;">수업요일</th>
      <th style="text-align:center;">수업시수</th><th style="text-align:right;">총 원비</th><th style="text-align:right;">수납액</th>
    </tr></thead>
    <tbody>${classInfoRows}</tbody>
  </table>
</div>

<div class="section">
  <h2>학생별 납부 내역 (완납 ${paidCount}명 / 미납·부분 ${unpaidCount}명)</h2>
  <table>
    <thead><tr>
      <th style="text-align:center;width:30px;">No</th><th>반</th><th>이름</th>
      <th style="text-align:right;">원비</th><th style="text-align:right;">수납액</th><th style="text-align:center;">상태</th>
    </tr></thead>
    <tbody>${studentRows}</tbody>
  </table>
</div>

<div class="section">
  <h2>급여 계산</h2>
  <table class="summary-table">
    <tbody>
      <tr style="border-bottom:1px dashed var(--border);"><td class="summary-label">총 원비 (예정)</td><td class="summary-value">${payroll.totalFee.toLocaleString()}원</td></tr>
      <tr style="border-bottom:1px dashed var(--border);"><td class="summary-label">총 수납액</td><td class="summary-value">${payroll.totalPaid.toLocaleString()}원</td></tr>
      <tr style="border-bottom:1px dashed var(--border);"><td class="summary-label">배분 비율</td><td class="summary-value">${payRatio}%</td></tr>
      <tr style="border-bottom:1px dashed var(--border);"><td class="summary-label">선생님 배분액 (수납액 × ${payRatio}%)</td><td class="summary-value">${payroll.teacherShare.toLocaleString()}원</td></tr>
      ${bonusRows ? `<tr style="border-bottom:1px dashed var(--border);"><td class="summary-label">보너스 합계</td><td class="summary-value" style="color:var(--green);">+${payroll.totalBonus.toLocaleString()}원</td></tr>` : ''}
      ${bonusRows}
      <tr style="border-bottom:1px dashed var(--border);"><td class="summary-label">세전 합계</td><td class="summary-value">${payroll.grossPay.toLocaleString()}원</td></tr>
      <tr style="border-bottom:1px dashed var(--border);"><td class="summary-label">원천징수 (3.3%)</td><td class="summary-value" style="color:var(--red);">${formatWonNeg(payroll.tax)}</td></tr>
      <tr class="total-row"><td style="padding:10px 8px;">실수령액</td><td style="padding:10px 8px;text-align:right;">${payroll.netPay.toLocaleString()}원</td></tr>
    </tbody>
  </table>
</div>

<div class="footer">
  <p>본 명세서는 ${monthLabel} 수업분에 대한 급여명세서입니다.</p>
</div>
</body></html>`

    // 숨겨진 iframe으로 인쇄 (페이지 이동 없음)
    let iframe = document.getElementById('payslip-print-frame') as HTMLIFrameElement | null
    if (!iframe) {
      iframe = document.createElement('iframe')
      iframe.id = 'payslip-print-frame'
      iframe.style.position = 'fixed'
      iframe.style.right = '-9999px'
      iframe.style.bottom = '-9999px'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = 'none'
      document.body.appendChild(iframe)
    }
    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) { toast.error('인쇄를 열 수 없습니다.'); return }
    doc.open()
    doc.write(html)
    doc.close()
    setTimeout(() => {
      iframe!.contentWindow?.print()
    }, 300)
  }, [selectedMonth, teacher, classDetails, bonuses, payroll, payRatio, payrollLoading, payrollError])

  // 급여(돈) 조작 3곳 — safeMutate error를 버리면 실패가 성공처럼 화면이 닫힌다 (2026-08-13 라인리뷰)
  const saveRatio = async () => {
    const val = parseInt(ratioInput)
    if (isNaN(val) || val < 0 || val > 100) return
    const { error } = await safeMutate(`/api/teachers/${teacherId}`, 'PUT', { pay_ratio: val })
    if (error) { toast.error(`배분율 저장 실패: ${error}`); return }
    setEditingRatio(false)
    mutateTeacher()
  }

  const addBonus = async () => {
    if (bonusSaving) return // Enter 연타/더블탭 중복 생성 차단
    const amt = parseInt(bonusAmount)
    if (!amt || amt <= 0) return
    setBonusSaving(true)
    try {
      const { error } = await safeMutate('/api/teacher-bonuses', 'POST', {
        teacher_id: teacherId,
        billing_month: selectedMonth,
        amount: amt,
        memo: bonusMemo.trim() || null,
      })
      if (error) { toast.error(`보너스 추가 실패: ${error}`); return }
      setBonusAmount('')
      setBonusMemo('')
      setAddingBonus(false)
      mutateBonuses()
    } finally {
      setBonusSaving(false)
    }
  }

  const deleteBonus = async (bonusId: string) => {
    if (!confirm('이 보너스를 삭제하시겠습니까?')) return
    const { error } = await safeMutate(`/api/teacher-bonuses/${bonusId}`, 'DELETE')
    if (error) { toast.error(`보너스 삭제 실패: ${error}`); return }
    mutateBonuses()
  }

  if (!teacher) return (
    <div className="space-y-3">
      <div className="h-6 skeleton-shimmer rounded w-32 mb-4"></div>
      <div className="h-40 skeleton-shimmer rounded-xl"></div>
    </div>
  )

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-4">
        <TButton onClick={() => router.back()} className="p-1 text-[var(--text-4)] hover:text-[var(--text-3)]">
          <ChevronLeft className="w-5 h-5" />
        </TButton>
        <div>
          <h1 className="text-xl font-bold">{teacher.name}</h1>
          {teacher.subject && <p className="text-xs text-[var(--text-4)]">{teacher.subject}</p>}
        </div>
      </div>

      {/* 월 선택 */}
      <div className="flex items-center justify-center gap-3 mb-6">
        <TButton onClick={() => navigateMonth(-1)} className="p-2 hover:skeleton-shimmer rounded-lg">
          <ChevronLeft className="w-5 h-5" />
        </TButton>
        <span className="text-lg font-bold">{formatMonth(selectedMonth)}</span>
        <TButton onClick={() => navigateMonth(1)} className="p-2 hover:skeleton-shimmer rounded-lg">
          <ChevronRight className="w-5 h-5" />
        </TButton>
      </div>

      {/* 급여명세서 */}
      <div data-paper-card="" className="bg-[var(--bg-card)] rounded-xl border p-5 mb-4">
        <h2 className="font-bold text-sm mb-4">급여명세서</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between py-1.5 border-b">
            <span className="text-[var(--text-4)]">담당 반</span>
            <span className="font-medium">{teacherClasses.length}개 ({teacherStudents.length}명)</span>
          </div>
          <div className="flex justify-between py-1.5 border-b">
            <span className="text-[var(--text-4)]">총 원비</span>
            <span className="font-medium">{payroll.totalFee.toLocaleString()}원</span>
          </div>
          <div className="flex justify-between py-1.5 border-b">
            <span className="text-[var(--text-4)]">수납액</span>
            <span className="font-medium">{payroll.totalPaid.toLocaleString()}원</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b">
            <div className="flex items-center gap-1">
              <span className="text-[var(--text-4)]">선생님 배분</span>
              {editingRatio ? (
                <span className="flex items-center gap-1">
                  <span className="text-[var(--text-4)]">(</span>
                  <input
                    type="number"
                    value={ratioInput}
                    onChange={e => setRatioInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveRatio()}
                    className="w-12 px-1 py-0.5 border rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                    min={0} max={100} autoFocus
                  />
                  <span className="text-[var(--text-4)]">%)</span>
                  <TButton onClick={saveRatio} aria-label="저장" className="p-1.5 bg-[var(--blue-bg)] hover:bg-[var(--blue-dim)] text-[var(--blue)] rounded-full transition-colors"><Check className="w-3.5 h-3.5" strokeWidth={3} /></TButton>
                  <TButton onClick={() => setEditingRatio(false)} aria-label="취소" className="text-[var(--text-4)]"><X className="w-3.5 h-3.5" /></TButton>
                </span>
              ) : (
                <TButton
                  onClick={() => { setEditingRatio(true); setRatioInput(String(payRatio)) }}
                  className="text-[var(--blue)] hover:underline text-sm"
                >
                  ({payRatio}%)
                </TButton>
              )}
            </div>
            <span className="font-medium text-[var(--blue)]">{payroll.teacherShare.toLocaleString()}원</span>
          </div>

          {/* 보너스 */}
          <div className="flex justify-between items-center py-1.5 border-b">
            <span className="text-[var(--text-4)]">보너스</span>
            <span className="font-medium text-[var(--paid-text)]">+{payroll.totalBonus.toLocaleString()}원</span>
          </div>
          {bonuses.length > 0 && (
            <div className="pl-2 space-y-1 pb-1">
              {bonuses.map(b => (
                <div key={b.id} className="flex items-center justify-between text-xs text-[var(--text-3)]">
                  <span>{b.memo || '보너스'}</span>
                  <div className="flex items-center gap-1">
                    <span>+{b.amount.toLocaleString()}원</span>
                    <TButton onClick={() => deleteBonus(b.id)} className="p-0.5 text-[var(--text-4)] hover:text-[var(--unpaid-text)]">
                      <Trash2 className="w-3 h-3" />
                    </TButton>
                  </div>
                </div>
              ))}
            </div>
          )}

          {addingBonus ? (
            <div className="flex items-center gap-2 py-1">
              <input
                type="text"
                value={bonusMemo}
                onChange={e => setBonusMemo(e.target.value)}
                placeholder="항목명"
                className="flex-1 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                autoFocus
              />
              <input
                type="number"
                value={bonusAmount}
                onChange={e => setBonusAmount(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addBonus()}
                placeholder="금액"
                className="w-24 px-2 py-1 border rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              />
              <TButton onClick={addBonus} aria-label="추가" className="p-1.5 bg-[var(--blue-bg)] hover:bg-[var(--blue-dim)] text-[var(--blue)] rounded-full transition-colors"><Check className="w-3.5 h-3.5" strokeWidth={3} /></TButton>
              <TButton onClick={() => setAddingBonus(false)} aria-label="취소" className="text-[var(--text-4)]"><X className="w-4 h-4" /></TButton>
            </div>
          ) : (
            <TButton
              onClick={() => setAddingBonus(true)}
              className="flex items-center gap-1 text-xs text-[var(--blue)] font-medium hover:opacity-70 py-1"
            >
              <Plus className="w-3.5 h-3.5" /> 보너스 추가
            </TButton>
          )}

          <div className="flex justify-between py-1.5 border-b">
            <span className="text-[var(--text-4)]">세전 합계</span>
            <span className="font-bold">{payroll.grossPay.toLocaleString()}원</span>
          </div>
          <div className="flex justify-between py-1.5 border-b">
            <span className="text-[var(--text-4)]">원천징수 (3.3%)</span>
            <span className="font-medium text-[var(--unpaid-text)]">{formatWonNeg(payroll.tax)}</span>
          </div>
          <div className="flex justify-between py-2 mt-1 bg-[var(--bg-card-hover)] -mx-5 px-5 rounded-b-xl">
            <span className="font-bold">실수령액</span>
            <span className="font-bold text-lg text-[var(--blue)]">{payroll.netPay.toLocaleString()}원</span>
          </div>
        </div>
      </div>

      {/* PDF 다운로드 버튼 */}
      <TButton
        onClick={downloadPayslipPDF}
        disabled={payrollLoading || payrollError}
        className="w-full py-3 mb-4 text-[var(--blue)] bg-[var(--bg-card)] border border-[var(--blue)] rounded-xl text-sm font-medium hover:bg-[var(--blue-bg)] flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <Download className="w-4 h-4" />
        급여명세서 PDF 다운로드
      </TButton>

      {/* 반별 학생 상세 */}
      {classDetails.map(({ cls, students, sessionCount, days, clsFee, clsPaid }) => (
        <div data-paper-card="" key={cls.id} className="bg-[var(--bg-card)] rounded-xl border mb-4 overflow-hidden">
          <div className="px-4 py-3 bg-[var(--bg-card-hover)] border-b">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-bold">{formatClassName(cls)}</span>
                <span className="text-xs text-[var(--text-4)] ml-2">{students.length}명</span>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{clsPaid.toLocaleString()} <span className="text-xs text-[var(--text-4)]">/ {clsFee.toLocaleString()}원</span></p>
              </div>
            </div>
            {(days || sessionCount) && (
              <div className="flex gap-3 mt-1">
                {days && (
                  <span className="text-[11px] text-[var(--text-4)]">
                    수업요일: {days.map(d => DAY_LABELS[d]).join(', ')}
                  </span>
                )}
                {sessionCount != null && (
                  <span className="text-[11px] text-[var(--text-4)]">
                    이번달 {sessionCount}회
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="divide-y">
            {students.map(s => (
              <div key={s.id} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{s.name}</span>
                  {s.status !== 'paid' && (
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: s.status === 'partial' ? 'var(--scheduled-bg)' : 'var(--unpaid-bg)',
                        color: s.status === 'partial' ? 'var(--scheduled-text)' : 'var(--unpaid-text)',
                      }}
                    >
                      {PAYMENT_STATUS_LABELS[s.status]}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium">{s.paid.toLocaleString()}</span>
                  <span className="text-xs text-[var(--text-4)]"> / {s.fee.toLocaleString()}원</span>
                </div>
              </div>
            ))}
            {students.length === 0 && (
              <EmptyState title="학생이 없습니다" size="compact" />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
