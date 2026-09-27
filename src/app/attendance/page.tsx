'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Calendar, Check, X, Clock, LogOut, RotateCcw, Loader2, type LucideIcon } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import { motion } from '@/components/paperMotion'
import { TButton, FadeInUp } from '@/components/motion'
import { toast } from 'sonner'
import useSWR from 'swr'
import type { GradeWithClasses, Student } from '@/types'
import { useGrades, getActiveStudents, swrFetcher } from '@/lib/utils'
import { formatClassName } from '@/lib/format'
import { TERMINAL_STATUSES } from '@/lib/withdrawalStatuses'

type AttendanceStatus = 'present' | 'absent' | 'late' | 'early_leave' | 'makeup'

interface AttendanceRecord {
  id: string
  student_id: string
  date: string
  status: AttendanceStatus
  note: string | null
  created_at: string
  updated_at: string
}

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: '출석',
  absent: '결석',
  late: '지각',
  early_leave: '조퇴',
  makeup: '보강',
}

const STATUS_SHORT: Record<AttendanceStatus, string> = {
  present: '출',
  absent: '결',
  late: '지',
  early_leave: '조',
  makeup: '보',
}

const STATUS_ICON: Record<AttendanceStatus, LucideIcon> = {
  present: Check,
  absent: X,
  late: Clock,
  early_leave: LogOut,
  makeup: RotateCcw,
}

const STATUS_TOKENS: Record<AttendanceStatus, { fg: string; bg: string }> = {
  present:     { fg: 'var(--paid-text)',   bg: 'var(--paid-bg)' },
  absent:      { fg: 'var(--unpaid-text)', bg: 'var(--unpaid-bg)' },
  late:        { fg: 'var(--scheduled-text)',      bg: 'var(--orange-dim)' },
  early_leave: { fg: 'var(--scheduled-text)', bg: 'var(--scheduled-bg)' },
  makeup:      { fg: 'var(--blue)',        bg: 'var(--blue-dim)' },
}

const ORDER: AttendanceStatus[] = ['present', 'late', 'early_leave', 'absent', 'makeup']

function todayKstString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dd = new Date(y, m - 1, d)
  const dow = ['일', '월', '화', '수', '목', '금', '토'][dd.getDay()]
  return `${m}월 ${d}일 (${dow})`
}

const fetcher = swrFetcher

export default function AttendancePage() {
  const [date, setDate] = useState<string>(todayKstString())
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null)
  const [savingMap, setSavingMap] = useState<Record<string, AttendanceStatus | null>>({})

  const { data: grades = [] } = useGrades<GradeWithClasses[]>()
  // recordsLoading 가드 필수 — 로딩중 records=[]로 전원 미체크처럼 보여 일괄출석이
  // 기존 결석/지각 기록을 덮어쓸 수 있음 (rule.swr_loading_guard, 2026-07-10 전수점검)
  const { data: recordsData, isLoading: recordsLoading, mutate: mutateRecords } = useSWR<AttendanceRecord[]>(
    `/api/attendance?date=${date}`,
    fetcher,
    { refreshInterval: 30000 },
  )
  const records = useMemo(() => recordsData ?? [], [recordsData])
  // 퇴원 "처리완료" 학생만 명단에서 제외, 처리중 퇴원생은 유지 (결제 페이지 처리완료 분류와 동일 기준).
  // ⚠️ 2026-07-18부터 이 테이블엔 진행중 상태(resettle_pending/scheduled)도 저장된다 —
  //   '행 존재 = 완료'로 읽으면 처리중 퇴원생이 출결 명단에서 사라진다 (2026-08-13 라인리뷰 P2).
  //   종결 상태 집합은 서버와 같은 정본(@/lib/withdrawalStatuses)을 import — 사본을 두면 서버에
  //   상태가 추가될 때 화면만 옛 기준으로 갈라진다 (2026-08-16 라인리뷰). 조회는 보는 달로 스코프.
  const TERMINAL_WITHDRAWAL = useMemo(() => new Set<string>(TERMINAL_STATUSES), [])
  const { data: withdrawalStatuses = [] } = useSWR<{ student_id: string; status: string }[]>(
    `/api/withdrawal-status?billing_month=${date.slice(0, 7)}`,
    fetcher,
  )
  const completedWithdrawnIds = useMemo(
    () => new Set(withdrawalStatuses.filter(w => TERMINAL_WITHDRAWAL.has(w.status)).map(w => w.student_id)),
    [withdrawalStatuses, TERMINAL_WITHDRAWAL],
  )

  // 첫 반 자동 선택
  useEffect(() => {
    if (selectedClassId) return
    for (const g of grades) {
      if (g.classes && g.classes.length > 0) {
        setSelectedClassId(g.classes[0].id)
        return
      }
    }
  }, [grades, selectedClassId])

  const allClasses = useMemo(() => {
    const out: { id: string; label: string; gradeName: string; students: Student[] }[] = []
    for (const g of grades) {
      for (const c of g.classes || []) {
        out.push({ id: c.id, label: formatClassName(c), gradeName: g.name, students: c.students || [] })
      }
    }
    return out
  }, [grades])

  const selectedClass = useMemo(
    () => allClasses.find(c => c.id === selectedClassId) ?? null,
    [allClasses, selectedClassId],
  )

  const activeStudents = useMemo(() => {
    if (!selectedClass) return []
    // 퇴원 "처리완료" 학생만 출결 명단에서 제외 (처리중 퇴원생은 유지)
    return getActiveStudents(selectedClass.students, date.slice(0, 7))
      .filter(s => !completedWithdrawnIds.has(s.id))
  }, [selectedClass, date, completedWithdrawnIds])

  const recordByStudent = useMemo(() => {
    const m = new Map<string, AttendanceRecord>()
    for (const r of records) m.set(r.student_id, r)
    return m
  }, [records])


  const stats = useMemo(() => {
    const tally = { present: 0, absent: 0, late: 0, early_leave: 0, makeup: 0, unmarked: 0 }
    for (const s of activeStudents) {
      const r = recordByStudent.get(s.id)
      if (!r) tally.unmarked++
      else tally[r.status]++
    }
    return tally
  }, [activeStudents, recordByStudent])

  const navigateDate = useCallback((delta: number) => {
    const [y, m, d] = date.split('-').map(Number)
    const dd = new Date(y, m - 1, d + delta)
    setDate(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`)
  }, [date])

  const handleSetStatus = useCallback(async (studentId: string, status: AttendanceStatus | null) => {
    if (recordsLoading) return // 로딩중 stale 스냅샷 기준 토글 방지
    if (savingMap[studentId] !== undefined) return // 저장중 재탭 방지 — optimistic id로 DELETE 날아가는 버그 차단
    const current = recordByStudent.get(studentId)
    const isToggleOff = status !== null && current?.status === status
    const finalStatus = isToggleOff ? null : status

    // Optimistic UI — SWR 캐시 즉시 업데이트, 서버 응답은 비동기로 검증
    const optimisticRecords: AttendanceRecord[] = (() => {
      if (finalStatus === null) {
        return records.filter(r => r.student_id !== studentId)
      }
      const now = new Date().toISOString()
      const next = records.filter(r => r.student_id !== studentId)
      next.push({
        id: current?.id ?? `optimistic-${studentId}-${date}`,
        student_id: studentId,
        date,
        status: finalStatus,
        note: current?.note ?? null,
        created_at: current?.created_at ?? now,
        updated_at: now,
      })
      return next
    })()
    mutateRecords(optimisticRecords, { revalidate: false })

    setSavingMap(prev => ({ ...prev, [studentId]: finalStatus }))

    try {
      if (finalStatus === null) {
        // optimistic id는 서버에 없는 가짜 id — revalidate 완료 전 토글오프 시 진짜 id로 재조회
        let deleteId = current?.id
        if (deleteId?.startsWith('optimistic-')) {
          const fresh: AttendanceRecord[] = await fetcher(`/api/attendance?date=${date}`)
          deleteId = fresh.find(r => r.student_id === studentId)?.id
        }
        if (deleteId) {
          const res = await fetch(`/api/attendance?id=${deleteId}`, { method: 'DELETE' })
          if (!res.ok) throw new Error((await res.json()).error || '삭제 실패')
        }
      } else {
        const res = await fetch('/api/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entries: [{ student_id: studentId, date, status: finalStatus }],
          }),
        })
        if (!res.ok) throw new Error((await res.json()).error || '저장 실패')
      }
      // 성공 — 서버 데이터로 revalidate
      mutateRecords()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '저장 실패'
      toast.error(msg)
      // 실패 — 서버에서 원래 데이터로 rollback
      mutateRecords()
    } finally {
      setSavingMap(prev => {
        const next = { ...prev }
        delete next[studentId]
        return next
      })
    }
  }, [date, records, recordByStudent, mutateRecords, recordsLoading, savingMap])

  const handleMarkAllPresent = useCallback(async () => {
    if (recordsLoading) {
      toast.info('출결 기록 불러오는 중입니다')
      return
    }
    const targets = activeStudents.filter(s => !recordByStudent.has(s.id))
    if (targets.length === 0) {
      toast.info('미체크 학생이 없습니다')
      return
    }
    setSavingMap(prev => ({ ...prev, ...Object.fromEntries(targets.map(s => [s.id, 'present' as const])) }))
    // Optimistic — 출석 N건 즉시 반영 후 서버 검증
    const now = new Date().toISOString()
    const optimisticRecords: AttendanceRecord[] = [
      ...records,
      ...targets.map(s => ({
        id: `optimistic-${s.id}-${date}`,
        student_id: s.id,
        date,
        status: 'present' as AttendanceStatus,
        note: null,
        created_at: now,
        updated_at: now,
      })),
    ]
    mutateRecords(optimisticRecords, { revalidate: false })
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: targets.map(s => ({ student_id: s.id, date, status: 'present' })),
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || '저장 실패')
      toast.success(`${targets.length}명 출석 처리`)
      mutateRecords()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '저장 실패'
      toast.error(msg)
      mutateRecords() // rollback
    } finally {
      setSavingMap(prev => {
        const next = { ...prev }
        for (const s of targets) delete next[s.id]
        return next
      })
    }
  }, [activeStudents, records, recordByStudent, date, mutateRecords, recordsLoading])

  return (
    <div className="space-y-4">
      {/* 출결 페이지 진입/탈출 단서 — Navbar에서 숨겨진 페이지라 닫기 버튼 명시 */}
      <FadeInUp>
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            대시보드
          </Link>
          <h1 className="text-[15px] font-bold text-[var(--text-1)]">출결</h1>
          <span className="w-12" />
        </div>
      </FadeInUp>
      {/* Date navigator */}
      <FadeInUp>
        <div data-paper-card="" className="bg-[var(--bg-card)] rounded-2xl p-4 flex items-center justify-between">
          <TButton
            type="button"
            onClick={() => navigateDate(-1)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-3)] hover:bg-[var(--bg-elevated)]"
            aria-label="이전 날짜"
          >
            <ChevronLeft className="w-5 h-5" />
          </TButton>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--text-4)]" />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="bg-transparent text-[var(--text-1)] text-base font-bold focus:outline-none"
              style={{ colorScheme: 'dark' }}
            />
            <span className="text-[var(--text-4)] text-sm">{formatDate(date)}</span>
          </div>
          <TButton
            type="button"
            onClick={() => navigateDate(1)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-3)] hover:bg-[var(--bg-elevated)]"
            aria-label="다음 날짜"
          >
            <ChevronRight className="w-5 h-5" />
          </TButton>
        </div>
      </FadeInUp>

      {/* Stats */}
      <FadeInUp delay={0.05}>
        <div className="grid grid-cols-5 gap-2">
          {(['present', 'late', 'early_leave', 'absent', 'makeup'] as AttendanceStatus[]).map(s => {
            const tokens = STATUS_TOKENS[s]
            const Icon = STATUS_ICON[s]
            const count = stats[s]
            const isActive = count > 0
            return (
              <div
                key={s}
                className={`rounded-xl px-2 py-2.5 text-center transition-opacity ${isActive ? '' : 'opacity-50'}`}
                style={{ background: isActive ? tokens.bg : 'var(--bg-elevated)' }}
              >
                <Icon className="w-3.5 h-3.5 mx-auto mb-1" style={{ color: isActive ? tokens.fg : 'var(--text-4)' }} />
                <div className="text-[10px] font-medium" style={{ color: isActive ? tokens.fg : 'var(--text-4)' }}>{STATUS_LABEL[s]}</div>
                <div className="text-base font-bold tabular-nums" style={{ color: isActive ? tokens.fg : 'var(--text-4)' }}>{count}</div>
              </div>
            )
          })}
        </div>
      </FadeInUp>

      {/* Class selector */}
      <FadeInUp delay={0.1}>
        <div className="overflow-x-auto -mx-4 px-4">
          <div className="flex gap-2 pb-1">
            {allClasses.map(c => {
              const active = c.id === selectedClassId
              return (
                <TButton
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedClassId(c.id)}
                  className={`px-3.5 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-[var(--blue)] text-[var(--on-action)]'
                      : 'bg-[var(--bg-card)] text-[var(--text-3)] hover:text-[var(--text-1)]'
                  }`}
                >
                  {c.gradeName} · {c.label}
                </TButton>
              )
            })}
          </div>
        </div>
      </FadeInUp>

      {/* Quick action */}
      {!recordsLoading && activeStudents.length > 0 && stats.unmarked > 0 && (
        <FadeInUp delay={0.13}>
          <TButton
            type="button"
            onClick={handleMarkAllPresent}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[var(--paid-bg)] text-[var(--paid-text)] hover:opacity-90"
          >
            미체크 {stats.unmarked}명 일괄 출석 처리
          </TButton>
        </FadeInUp>
      )}

      {/* Student list */}
      <div data-paper-card="" className="bg-[var(--bg-card)] rounded-2xl overflow-hidden">
        {activeStudents.length === 0 ? (
          <div className="text-center text-[var(--text-4)] text-sm py-12">
            반을 선택해주세요
          </div>
        ) : (
          activeStudents.map((student, idx) => {
            const record = recordByStudent.get(student.id)
            const saving = savingMap[student.id] !== undefined
            const pendingStatus = savingMap[student.id]
            const currentStatus = saving ? pendingStatus : (record?.status ?? null)

            return (
              <motion.div
                key={student.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: (idx < 8 ? idx * 0.02 : 0) }}
                className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)] last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[var(--text-1)] truncate">
                    {student.name}
                  </div>
                  {record?.note && (
                    <div className="text-xs text-[var(--text-4)] truncate mt-0.5">
                      {record.note}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {ORDER.map(s => {
                    const tokens = STATUS_TOKENS[s]
                    const isSelected = currentStatus === s
                    const Icon = STATUS_ICON[s]
                    return (
                      <TButton
                        key={s}
                        type="button"
                        onClick={() => handleSetStatus(student.id, s)}
                        disabled={saving}
                        whileTap={{ scale: 0.985, transition: { duration: 0.09 } }}
                        animate={{ scale: isSelected ? 1.05 : 1 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                        className={`w-9 h-9 rounded-lg text-xs font-bold flex items-center justify-center ${
                          saving ? 'opacity-50' : isSelected ? '' : 'opacity-55 hover:opacity-90'
                        }`}
                        style={
                          isSelected
                            ? { background: tokens.bg, color: tokens.fg, border: `2px solid ${tokens.fg}`, boxShadow: `0 0 0 1px ${tokens.bg}, 0 4px 12px -2px rgba(var(--paper-ink),0.16)` }
                            : { background: 'var(--bg-elevated)', color: 'var(--text-4)', border: '2px solid transparent' }
                        }
                        aria-label={STATUS_LABEL[s]}
                        aria-pressed={isSelected}
                        title={STATUS_LABEL[s]}
                      >
                        <AnimatePresence mode="wait">
                          {saving && pendingStatus === s ? (
                            <motion.span
                              key="loading"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                            >
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            </motion.span>
                          ) : isSelected ? (
                            <motion.span
                              key="icon"
                              initial={{ scale: 0.6, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0.6, opacity: 0 }}
                              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                            >
                              <Icon className="w-4 h-4" />
                            </motion.span>
                          ) : (
                            <motion.span
                              key="text"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                            >
                              {STATUS_SHORT[s]}
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </TButton>
                    )
                  })}
                </div>
              </motion.div>
            )
          })
        )}
      </div>
    </div>
  )
}
