'use client'

import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2, Pencil, Check, X, GraduationCap } from 'lucide-react'
import { TButton } from '@/components/motion'
import EmptyState from '@/components/ui/EmptyState'
import type { Payment, GradeWithClasses, Teacher } from '@/types'
import { formatWon, formatNumber, formatWonNeg} from '@/lib/format'
import { getStudentFee } from '@/types'
import { toast } from 'sonner'
import { getActiveStudents, useGrades, usePayments, useTeachers, getCurrentMonth, formatMonth, safeMutate, swrFetcher } from '@/lib/utils'
import { calcTeacherPay, DEFAULT_PAY_RATIO } from '@/lib/salary'
import useSWR from 'swr'

interface Expense {
  id: string
  billing_month: string
  category: 'fixed' | 'variable'
  name: string
  amount: number
  memo: string | null
}

const fetcher = swrFetcher

// 인증은 middleware가 책임 — finance_session HMAC 쿠키 미통과 시 /finance/auth 로 자동 리다이렉트.
// 이 페이지가 렌더되는 시점은 이미 PIN 통과 상태.
export default function FinancePage() {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth)

  const { data: gradesData } = useGrades<GradeWithClasses[]>()
  const { data: paymentsData } = usePayments<Payment[]>(selectedMonth)
  const { data: teachersData } = useTeachers<Teacher[]>()
  const { data: expensesData, mutate: mutateExpenses } = useSWR<Expense[]>(
    `/api/expenses?billing_month=${selectedMonth}`, fetcher
  )
  const { data: bonusesData } = useSWR<{ teacher_id: string; amount: number }[]>(
    `/api/teacher-bonuses?billing_month=${selectedMonth}`, fetcher
  )
  // 과거 달 "총 원비(예정)"는 그 달 스냅샷 요금으로 — 요금 인상 후 과거 달이 부풀려 보이던
  // 문제(납부탭 fee 스냅샷과 동일 원리, 2026-07-10 전수점검 F4). 현재/미래 달은 라이브 요금.
  const { data: feeSnapshotRows } = useSWR<{ student_id: string; month: string; fee: number }[]>(
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
      ? (s: { id: string }, fee: number) => feeSnapshots.get(s.id) ?? fee
      : (_s: { id: string }, fee: number) => fee
  ), [selectedMonth, currentKstMonth, feeSnapshots])
  // 5개 소스 전부 로드된 뒤에만 계산/렌더 — 일부만 도착한 상태로 순이익·급여가
  // 틀린 중간값으로 렌더됐다가 튀는 깜빡임 방지 (rule.swr_loading_guard, 2026-07-10 전수점검)
  const financeLoading =
    gradesData === undefined || paymentsData === undefined || teachersData === undefined ||
    expensesData === undefined || bonusesData === undefined || feeSnapshotRows === undefined
  const grades = useMemo(() => gradesData ?? [], [gradesData])
  const payments = useMemo(() => paymentsData ?? [], [paymentsData])
  const teachers = useMemo(() => teachersData ?? [], [teachersData])
  const expenses = useMemo(() => expensesData ?? [], [expensesData])
  const bonuses = useMemo(() => bonusesData ?? [], [bonusesData])

  const [addingCategory, setAddingCategory] = useState<'fixed' | 'variable' | null>(null)
  const [newName, setNewName] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newMemo, setNewMemo] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editAmount, setEditAmount] = useState('')

  const navigateMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const totalRevenue = useMemo(() =>
    payments.reduce((sum, p) => sum + p.amount, 0)
  , [payments])

  const totalFee = useMemo(() =>
    grades.flatMap(g =>
      g.classes.flatMap(c =>
        getActiveStudents(c.students ?? [], selectedMonth).map(s => feeFor(s, getStudentFee(s, c)))
      )
    ).reduce((sum, fee) => sum + fee, 0)
  , [grades, selectedMonth, feeFor])

  const teacherPayroll = useMemo(() => {
    const paidByStudent = new Map<string, number>()
    for (const p of payments) paidByStudent.set(p.student_id, (paidByStudent.get(p.student_id) ?? 0) + p.amount)

    return teachers.map(teacher => {
      const teacherClasses = grades.flatMap(g =>
        g.classes.filter(c => c.teacher_id === teacher.id)
      )
      const teacherStudents = teacherClasses.flatMap(c =>
        getActiveStudents(c.students ?? [], selectedMonth).map(s => ({ ...s, class: c }))
      )
      const paid = teacherStudents.reduce((sum, s) => sum + (paidByStudent.get(s.id) ?? 0), 0)
      const ratio = teacher.pay_ratio ?? DEFAULT_PAY_RATIO
      const bonus = bonuses.filter(b => b.teacher_id === teacher.id).reduce((sum, b) => sum + b.amount, 0)
      const pay = calcTeacherPay(paid, ratio, bonus) // 급여 수식은 @/lib/salary 단일 소스
      return { teacher, share: pay.share, bonus, gross: pay.gross, tax: pay.tax, net: pay.net }
    }).filter(t => t.gross > 0)
  }, [teachers, grades, payments, bonuses, selectedMonth])

  const totalTeacherPay = useMemo(() =>
    teacherPayroll.reduce((sum, t) => sum + t.net, 0)
  , [teacherPayroll])

  const totalTeacherTax = useMemo(() =>
    teacherPayroll.reduce((sum, t) => sum + t.tax, 0)
  , [teacherPayroll])

  const fixedExpenses = expenses.filter(e => e.category === 'fixed')
  const variableExpenses = expenses.filter(e => e.category === 'variable')
  const totalFixed = fixedExpenses.reduce((sum, e) => sum + e.amount, 0)
  const totalVariable = variableExpenses.reduce((sum, e) => sum + e.amount, 0)

  const totalExpense = totalTeacherPay + totalTeacherTax + totalFixed + totalVariable
  const profit = totalRevenue - totalExpense

  // 재무 비용 CRUD 실패가 성공처럼 보이던 것(폼 초기화 + 무표시) — error 표면화 + 입력 유지 (2026-08-13 라인리뷰)
  const addExpense = async () => {
    if (!newName.trim() || !addingCategory) return
    const { error } = await safeMutate('/api/expenses', 'POST', {
      billing_month: selectedMonth,
      category: addingCategory,
      name: newName.trim(),
      amount: parseInt(newAmount) || 0,
      memo: newMemo.trim() || null,
    })
    if (error) { toast.error(`비용 추가 실패: ${error}`); return }
    setNewName(''); setNewAmount(''); setNewMemo(''); setAddingCategory(null)
    mutateExpenses()
  }

  const updateExpense = async (id: string) => {
    if (!editName.trim()) return
    const { error } = await safeMutate(`/api/expenses/${id}`, 'PUT', {
      name: editName.trim(),
      amount: parseInt(editAmount) || 0,
    })
    if (error) { toast.error(`비용 수정 실패: ${error}`); return }
    setEditingId(null)
    mutateExpenses()
  }

  const deleteExpense = async (id: string, name: string) => {
    if (!confirm(`"${name}" 항목을 삭제하시겠습니까?`)) return
    const { error } = await safeMutate(`/api/expenses/${id}`, 'DELETE')
    if (error) { toast.error(`비용 삭제 실패: ${error}`); return }
    mutateExpenses()
  }

  const renderExpenseSection = (title: string, category: 'fixed' | 'variable', items: Expense[], total: number) => (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-[15px]">{title}</h2>
        <span className="text-sm font-semibold text-[var(--text-4)] tabular-nums">{formatWon(total)}</span>
      </div>

      {items.length > 0 && (
        <div className="space-y-0 mb-3">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-2 py-2.5 border-b border-[var(--border)] last:border-b-0">
              {editingId === item.id ? (
                <>
                  <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="flex-1 px-2.5 py-1.5 bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:bg-[var(--bg-card)]" autoFocus />
                  <input type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)} onKeyDown={e => e.key === 'Enter' && updateExpense(item.id)} className="w-28 px-2.5 py-1.5 bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:bg-[var(--bg-card)]" />
                  <span className="text-xs text-[var(--text-4)]">원</span>
                  <TButton onClick={() => updateExpense(item.id)} className="p-1.5 bg-[var(--blue-bg)] hover:bg-[var(--blue-dim)] text-[var(--blue)] rounded-full transition-colors"><Check className="w-3.5 h-3.5" strokeWidth={3} /></TButton>
                  <TButton onClick={() => setEditingId(null)} className="p-1.5 text-[var(--text-4)] hover:bg-[var(--bg-elevated)] rounded-lg"><X className="w-4 h-4" /></TButton>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{item.name}</span>
                  {item.memo && <span className="text-xs text-[var(--text-4)]">{item.memo}</span>}
                  <span className="text-sm font-semibold tabular-nums">{formatWon(item.amount)}</span>
                  <TButton onClick={() => { setEditingId(item.id); setEditName(item.name); setEditAmount(String(item.amount)) }} className="p-2 -m-1 text-[var(--text-4)] hover:text-[var(--text-3)] transition-colors">
                    <Pencil className="w-4 h-4" />
                  </TButton>
                  <TButton onClick={() => deleteExpense(item.id, item.name)} className="p-2 -m-1 text-[var(--text-4)] hover:text-[var(--unpaid-text)] transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </TButton>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {addingCategory === category ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="항목명" className="flex-1 px-2.5 py-1.5 bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:bg-[var(--bg-card)]" autoFocus />
            <input type="number" value={newAmount} onChange={e => setNewAmount(e.target.value)} onKeyDown={e => e.key === 'Enter' && addExpense()} placeholder="금액" className="w-28 px-2.5 py-1.5 bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:bg-[var(--bg-card)]" />
            <span className="text-xs text-[var(--text-4)]">원</span>
          </div>
          <div className="flex items-center gap-2">
            <input type="text" value={newMemo} onChange={e => setNewMemo(e.target.value)} onKeyDown={e => e.key === 'Enter' && addExpense()} placeholder="비고 (선택)" className="flex-1 px-2.5 py-1.5 bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:bg-[var(--bg-card)]" />
            <TButton onClick={addExpense} aria-label="항목 추가" className="p-1.5 bg-[var(--blue-bg)] hover:bg-[var(--blue-dim)] text-[var(--blue)] rounded-full transition-colors"><Check className="w-3.5 h-3.5" strokeWidth={3} /></TButton>
            <TButton onClick={() => { setAddingCategory(null); setNewName(''); setNewAmount(''); setNewMemo('') }} className="p-1.5 text-[var(--text-4)] hover:bg-[var(--bg-elevated)] rounded-lg"><X className="w-4 h-4" /></TButton>
          </div>
        </div>
      ) : (
        <TButton
          onClick={() => setAddingCategory(category)}
          className="flex items-center gap-1 text-sm text-[var(--blue)] font-semibold hover:opacity-70 transition-opacity"
        >
          <Plus className="w-4 h-4" /> 항목 추가
        </TButton>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      {/* 월 선택 */}
      <div className="flex items-center justify-center gap-4 mb-2">
        <TButton onClick={() => navigateMonth(-1)} className="p-2 hover:bg-[var(--bg-elevated)] rounded-xl transition-colors">
          <ChevronLeft className="w-5 h-5 text-[var(--text-3)]" />
        </TButton>
        <h1 className="text-lg font-bold tracking-tight">{formatMonth(selectedMonth)} 재정</h1>
        <TButton onClick={() => navigateMonth(1)} className="p-2 hover:bg-[var(--bg-elevated)] rounded-xl transition-colors">
          <ChevronRight className="w-5 h-5 text-[var(--text-3)]" />
        </TButton>
      </div>

      {financeLoading ? (
        <div className="space-y-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="card p-5 animate-pulse space-y-3">
              <div className="h-4 w-28 rounded bg-[var(--bg-elevated)]" />
              <div className="h-8 w-40 rounded bg-[var(--bg-elevated)]" />
              <div className="h-3 w-full rounded bg-[var(--bg-elevated)]" />
            </div>
          ))}
        </div>
      ) : (
      <>

      {/* 손익 요약 */}
      <div className="card overflow-hidden">
        <div className="p-5 pb-0">
          <h2 className="font-bold text-[15px] mb-3">월별 손익 요약</h2>
          <div className="space-y-0 text-sm">
            <div className="flex justify-between py-2.5 border-b border-[var(--border)]">
              <span className="text-[var(--text-4)]">총 원비 (예정)</span>
              <span className="font-medium tabular-nums">{formatWon(totalFee)}</span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-[var(--border)]">
              <span className="text-[var(--text-3)] font-medium">총 수입 (수납액)</span>
              <span className="font-bold text-[var(--blue)] tabular-nums">{formatWon(totalRevenue)}</span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-[var(--border)]">
              <span className="text-[var(--text-4)]">선생님 급여 (실지급)</span>
              <span className="font-medium text-[var(--unpaid-text)] tabular-nums">-{formatWon(totalTeacherPay)}</span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-[var(--border)]">
              <span className="text-[var(--text-4)]">원천징수세 (3.3%)</span>
              <span className="font-medium text-[var(--unpaid-text)] tabular-nums">{formatWonNeg(totalTeacherTax)}</span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-[var(--border)]">
              <span className="text-[var(--text-4)]">고정비</span>
              <span className="font-medium text-[var(--unpaid-text)] tabular-nums">{formatWonNeg(totalFixed)}</span>
            </div>
            <div className="flex justify-between py-2.5">
              <span className="text-[var(--text-4)]">변동비</span>
              <span className="font-medium text-[var(--unpaid-text)] tabular-nums">{formatWonNeg(totalVariable)}</span>
            </div>
          </div>
        </div>
        <div className={`flex justify-between items-center py-4 px-5 mt-2 ${profit >= 0 ? 'bg-[var(--blue-bg)]' : 'bg-[var(--red-dim)]'}`}>
          <span className="font-bold text-sm">순이익</span>
          <span className={`font-bold text-xl tabular-nums ${profit >= 0 ? 'text-[var(--blue)]' : 'text-[var(--unpaid-text)]'}`}>
            {profit >= 0 ? '+' : ''}{formatWon(profit)}
          </span>
        </div>
      </div>

      {/* 선생님 급여 자동 계산 */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-[15px]">선생님 급여</h2>
          <span className="text-sm font-semibold text-[var(--text-4)] tabular-nums">총 {formatWon((totalTeacherPay + totalTeacherTax))}</span>
        </div>
        {teacherPayroll.length === 0 ? (
          <EmptyState icon={GraduationCap} title="이번 달 선생님 급여가 없습니다" size="compact" />
        ) : (
          <div className="space-y-0">
            {teacherPayroll.map(({ teacher, bonus, gross, tax, net }) => (
              <div key={teacher.id} className="flex items-center justify-between py-2.5 border-b border-[var(--border)] last:border-b-0">
                <div>
                  <span className="text-sm font-semibold">{teacher.name}</span>
                  <span className="text-xs text-[var(--text-4)] ml-1.5">({teacher.pay_ratio ?? 40}%)</span>
                  {bonus > 0 && <span className="text-xs text-[var(--green)] ml-1.5">+보너스 {formatNumber(bonus)}</span>}
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{formatWon(net)}</p>
                  <p className="text-[10px] text-[var(--text-4)]">세전 {formatNumber(gross)} / 세금 {formatNumber(tax)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 고정비 */}
      {renderExpenseSection('고정비', 'fixed', fixedExpenses, totalFixed)}

      {/* 변동비 */}
      {renderExpenseSection('변동비', 'variable', variableExpenses, totalVariable)}
      </>
      )}
    </div>
  )
}
