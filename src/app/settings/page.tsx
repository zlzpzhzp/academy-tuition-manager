'use client'

import { toast } from 'sonner'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Pencil, Trash2, ChevronDown, X, Check, ArrowRightLeft, ChevronUp, LogOut, ScrollText, UserCircle, FileText, BookPlus, UsersRound, FileSearch } from 'lucide-react'
import { TButton } from '@/components/motion'
import EmptyState from '@/components/ui/EmptyState'
import type { Class, Student, Teacher } from '@/types'
import { DAY_LABELS, parseClassDays } from '@/types'
import { getActiveStudents, safeMutate, safeFetch, useGrades, revalidateGrades, useTeachers, revalidateTeachers } from '@/lib/utils'
import { formatWon, formatClassName } from '@/lib/format'

const SUBJECT_COLORS = ['bg-[#1c2d45] text-[#5b9cf5]', 'bg-[#1a3328] text-[#34d399]', 'bg-[#2a1e3a] text-[#9b82e8]', 'bg-[#332200] text-[#e5a731]', 'bg-[#351c2d] text-[#d96a9e]', 'bg-[#1a3232] text-[#3cbfcf]', 'bg-[#302e1a] text-[#d4b032]', 'bg-[var(--red-dim)] text-[var(--unpaid-text)]']

type GradeWithClasses = import('@/types').Grade & { classes: (Class & { students?: Student[] })[] }

const SUBJECT_TABS = ['수학', '영어'] as const
const CLASS_NAME_PRESETS = ['H', 'S', 'A', 'N', 'K', '기하', '기하(원장)', '기하(류)', '확통', '미적분', '미적/확통'] as const

// 모듈 스코프로 분리 — 렌더 바디 안에서 정의하면 매 렌더마다 새 컴포넌트 정체성이 생겨
// 요일 버튼 서브트리가 통째로 unmount/remount 되던 문제(입력 중 포커스/애니메이션 유실) 방지.
function DayPicker({ days, setDays }: { days: number[]; setDays: (d: number[]) => void }) {
  return (
    <div className="flex gap-0.5" role="group" aria-label="수업 요일 선택">
      {[1, 2, 3, 4, 5, 6].map(d => (
        <TButton
          key={d}
          type="button"
          onClick={() => setDays(days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort())}
          className={`w-7 h-7 rounded text-xs font-medium ${
            days.includes(d) ? 'bg-[var(--blue)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-3)] hover:bg-[var(--bg-elevated)]'
          }`}
          aria-pressed={days.includes(d)}
          aria-label={DAY_LABELS[d]}
        >
          {DAY_LABELS[d]}
        </TButton>
      ))}
    </div>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const { data: grades = [], isLoading: loading } = useGrades<GradeWithClasses[]>()
  const { data: teachers = [] } = useTeachers<Teacher[]>()
  const [selectedSubject, setSelectedSubject] = useState<string>('수학')
  const [addingClassToGrade, setAddingClassToGrade] = useState<string | null>(null)
  const [newClassName, setNewClassName] = useState('')
  const [newClassNameCustom, setNewClassNameCustom] = useState(false)
  const [newClassFee, setNewClassFee] = useState('')
  const [newClassSubject, setNewClassSubject] = useState('')
  const [newClassDays, setNewClassDays] = useState<number[]>([])
  const [newClassTeacherId, setNewClassTeacherId] = useState('')
  const [editingClassId, setEditingClassId] = useState<string | null>(null)
  const [editClassName, setEditClassName] = useState('')
  const [editClassNameCustom, setEditClassNameCustom] = useState(false)
  const [editClassFee, setEditClassFee] = useState('')
  const [editClassSubject, setEditClassSubject] = useState('')
  const [editClassDays, setEditClassDays] = useState<number[]>([])
  const [editClassTeacherId, setEditClassTeacherId] = useState('')

  // 선생님 관리
  const [addingTeacher, setAddingTeacher] = useState(false)
  const [newTeacherName, setNewTeacherName] = useState('')
  const [newTeacherPhone, setNewTeacherPhone] = useState('')
  const [newTeacherSubject, setNewTeacherSubject] = useState('')
  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null)
  const [editTeacherName, setEditTeacherName] = useState('')
  const [editTeacherPhone, setEditTeacherPhone] = useState('')
  const [editTeacherSubject, setEditTeacherSubject] = useState('')

  // 감사 로그
  const [showLogs, setShowLogs] = useState(false)
  const [logs, setLogs] = useState<{ id: string; entity_type: string; action: string; summary: string; details: Record<string, unknown> | null; created_at: string }[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  // 2026-07-31 조용한실패 점검: 실패는 ⚠️ 로그로 남는데 '최근 100건 나열'뿐이라 묻혔다.
  // 경고만 보는 토글을 둔다(기본은 경고 우선 — 사람이 봐야 할 건 그쪽이다).
  const [warnOnly, setWarnOnly] = useState(false)
  const loadLogs = async (opts?: { warnOnly?: boolean }) => {
    const w = opts?.warnOnly ?? warnOnly
    setWarnOnly(w)
    setShowLogs(true)
    setLogsLoading(true)
    const { data, error } = await safeFetch<typeof logs>(`/api/audit-logs?limit=100${w ? '&warnOnly=1' : ''}`)
    // 조회 실패를 빈 목록으로 그리면 '경고 없음'과 화면상 동일 — 뷰어 자체가 조용히 실패한다 (2026-08-13 라인리뷰)
    if (error) toast.error(`감사 로그를 불러오지 못했습니다: ${error}`)
    setLogs(data ?? [])
    setLogsLoading(false)
  }

  // 대시보드 경고 배지에서 ?logs=warn 으로 들어오면 바로 경고 목록을 연다.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).get('logs') !== 'warn') return
    void loadLogs({ warnOnly: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 학생 반이동
  const [transferClass, setTransferClass] = useState<(Class & { students?: Student[] }) | null>(null)
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set())
  const [targetClassId, setTargetClassId] = useState<string>('')
  const [transferring, setTransferring] = useState(false)

  const existingSubjects = useMemo(() => {
    const subjects = new Set<string>()
    grades.forEach(g => g.classes?.forEach(c => { if (c.subject) subjects.add(c.subject) }))
    return Array.from(subjects).sort()
  }, [grades])

  const getSubjectColor = useCallback((subject: string) => {
    const idx = existingSubjects.indexOf(subject)
    return SUBJECT_COLORS[idx >= 0 ? idx % SUBJECT_COLORS.length : 0]
  }, [existingSubjects])

  const allClasses = useMemo(() =>
    grades.flatMap(g => g.classes.map(c => ({ ...c, gradeName: g.name })))
  , [grades])

  const fetchGrades = revalidateGrades

  // ─── 반 추가 폼 초기화 ───
  const resetClassForm = () => {
    setNewClassName(''); setNewClassNameCustom(false); setNewClassFee(''); setNewClassSubject(''); setNewClassDays([]); setNewClassTeacherId('')
  }

  const openClassFormForGrade = (gradeId: string) => {
    resetClassForm()
    setNewClassSubject(selectedSubject)
    setAddingClassToGrade(gradeId)
  }

  const addClass = async () => {
    if (!newClassName.trim() || !addingClassToGrade) return
    // 반은 과목 하위 단위 — 과목 없는 반은 이름만으로 특정 불가('중3H'가 수학/영어 양쪽에 존재)
    if (!newClassSubject.trim()) { toast.error('과목을 선택해주세요'); return }
    const feeValue = newClassFee.trim() ? parseInt(newClassFee) : 0
    const { error } = await safeMutate('/api/classes', 'POST', {
      grade_id: addingClassToGrade,
      name: newClassName.trim(),
      monthly_fee: isNaN(feeValue) ? 0 : feeValue,
      subject: newClassSubject.trim(),
      class_days: newClassDays.length > 0 ? newClassDays.join(',') : null,
      teacher_id: newClassTeacherId || null,
    })
    if (error) { toast.error(`반 추가 실패: ${error}`); return }
    setAddingClassToGrade(null)
    resetClassForm()
    fetchGrades()
  }

  const updateClass = async (id: string) => {
    if (!editClassName.trim()) return
    if (!editClassSubject.trim()) { toast.error('과목을 선택해주세요'); return }
    const { error } = await safeMutate(`/api/classes/${id}`, 'PUT', {
      name: editClassName.trim(),
      monthly_fee: parseInt(editClassFee) || 0,
      subject: editClassSubject.trim(),
      class_days: editClassDays.length > 0 ? editClassDays.join(',') : null,
      teacher_id: editClassTeacherId || null,
    })
    if (error) { toast.error(`반 수정 실패: ${error}`); return }
    setEditingClassId(null)
    fetchGrades()
  }

  const deleteClass = async (id: string, name: string) => {
    if (!confirm(`"${name}" 반을 삭제하시겠습니까?`)) return
    const { error } = await safeMutate(`/api/classes/${id}`, 'DELETE')
    if (error) { toast.error(`반 삭제 실패: ${error}`); return }
    fetchGrades()
  }

  // ─── 학생 반이동 ───
  const openTransfer = (cls: Class & { students?: Student[] }) => {
    setTransferClass(cls)
    setSelectedStudents(new Set())
    setTargetClassId('')
  }

  const toggleStudentSelect = (id: string) => {
    setSelectedStudents(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectAllStudents = () => {
    if (!transferClass?.students) return
    const active = getActiveStudents(transferClass.students)
    if (selectedStudents.size === active.length) {
      setSelectedStudents(new Set())
    } else {
      setSelectedStudents(new Set(active.map(s => s.id)))
    }
  }

  const executeTransfer = async () => {
    if (selectedStudents.size === 0 || !targetClassId) return
    setTransferring(true)
    const promises = Array.from(selectedStudents).map(sid =>
      safeMutate(`/api/students/${sid}`, 'PUT', { class_id: targetClassId })
    )
    const ids = Array.from(selectedStudents)
    const results = await Promise.all(promises)
    setTransferring(false)
    const failedIds = ids.filter((_, i) => results[i].error)
    if (failedIds.length > 0) {
      // '누가' 안 옮겨졌는지 나열 + 실패분만 선택 유지한 채 모달을 열어둬 재시도 가능하게 (2026-08-13 라인리뷰)
      const nameOf = (sid: string) => transferClass?.students?.find(st => st.id === sid)?.name ?? sid.slice(0, 8)
      toast.error(`이동 실패 ${failedIds.length}명: ${failedIds.map(nameOf).join(', ')} — 다시 시도하세요`)
      setSelectedStudents(new Set(failedIds))
      fetchGrades()
      return
    }
    setTransferClass(null)
    setSelectedStudents(new Set())
    setTargetClassId('')
    fetchGrades()
  }

  const swapClassOrder = async (classList: (Class & { students?: Student[] })[], idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir
    if (targetIdx < 0 || targetIdx >= classList.length) return
    const a = classList[idx]
    const b = classList[targetIdx]
    // order_index가 같거나 null이면 스왑이 무동작(눌러도 안 움직임) — 현재 표시 순서대로
    // 전체 재부여 후 스왑 반영 (2026-07-10 전수점검 L7)
    let failedCount = 0
    if (a.order_index == null || b.order_index == null || a.order_index === b.order_index) {
      const reordered = [...classList]
      ;[reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]]
      const results = await Promise.all(reordered.map((c, i) => safeMutate(`/api/classes/${c.id}`, 'PUT', { order_index: i + 1 })))
      failedCount = results.filter(r => r.error).length
    } else {
      const results = await Promise.all([
        safeMutate(`/api/classes/${a.id}`, 'PUT', { order_index: b.order_index }),
        safeMutate(`/api/classes/${b.id}`, 'PUT', { order_index: a.order_index }),
      ])
      failedCount = results.filter(r => r.error).length
    }
    // 부분 실패 무알림이면 순서가 깨진 채 사용자는 모른다 (2026-08-13 라인리뷰) — 재조회로 실상 표시
    if (failedCount > 0) toast.error(`순서 변경 ${failedCount}건 실패 — 화면을 새로고침한 순서가 실제 상태입니다`)
    fetchGrades()
  }

  // ─── 선생님 CRUD ───
  const addTeacher = async () => {
    if (!newTeacherName.trim()) return
    const { error } = await safeMutate('/api/teachers', 'POST', {
      name: newTeacherName.trim(),
      phone: newTeacherPhone || null,
      subject: newTeacherSubject || null,
    })
    if (error) { toast.error(`선생님 등록 실패: ${error}`); return }
    setAddingTeacher(false)
    setNewTeacherName(''); setNewTeacherPhone(''); setNewTeacherSubject('')
    revalidateTeachers()
  }

  const updateTeacher = async (id: string) => {
    if (!editTeacherName.trim()) return
    const { error } = await safeMutate(`/api/teachers/${id}`, 'PUT', {
      name: editTeacherName.trim(),
      phone: editTeacherPhone || null,
      subject: editTeacherSubject || null,
    })
    if (error) { toast.error(`선생님 수정 실패: ${error}`); return }
    setEditingTeacherId(null)
    revalidateTeachers()
  }

  const deleteTeacher = async (id: string, name: string) => {
    if (!confirm(`"${name}" 선생님을 삭제하시겠습니까?\n배정된 반에서도 해제됩니다.`)) return
    const { error } = await safeMutate(`/api/teachers/${id}`, 'DELETE')
    if (error) { toast.error(`선생님 삭제 실패: ${error}`); return }
    revalidateTeachers()
    fetchGrades()
  }

  const swapTeacherOrder = async (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir
    if (targetIdx < 0 || targetIdx >= teachers.length) return
    const a = teachers[idx]
    const b = teachers[targetIdx]
    if (a.order_index == null || b.order_index == null || a.order_index === b.order_index) {
      // 동률/null 스왑 무동작 방지 — 표시 순서대로 재부여 후 스왑 (2026-07-10 전수점검 L7)
      const reordered = [...teachers]
      ;[reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]]
      await Promise.all(reordered.map((t, i) => safeMutate(`/api/teachers/${t.id}`, 'PUT', { order_index: i + 1 })))
    } else {
      await Promise.all([
        safeMutate(`/api/teachers/${a.id}`, 'PUT', { order_index: b.order_index }),
        safeMutate(`/api/teachers/${b.id}`, 'PUT', { order_index: a.order_index }),
      ])
    }
    revalidateTeachers()
  }

  const getTeacherName = (teacherId?: string | null) => {
    if (!teacherId) return null
    return teachers.find(t => t.id === teacherId)?.name ?? null
  }

  const formatFee = formatWon

  const allSubjectsInUse = useMemo(() => {
    const set = new Set<string>()
    grades.forEach(g => g.classes.forEach(c => { if (c.subject) set.add(c.subject) }))
    SUBJECT_TABS.forEach(s => set.add(s))
    return Array.from(set)
  }, [grades])

  if (loading) return (
    <div className="space-y-3">
      <div className="h-6 skeleton-shimmer rounded-xl w-32 mb-6"></div>
      <div className="flex gap-2 mb-6">
        <div className="flex-1 h-10 skeleton-shimmer rounded-lg"></div>
        <div className="h-10 skeleton-shimmer rounded-lg w-28"></div>
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, gi) => (
          <div key={gi} className="bg-[var(--bg-card)] rounded-xl border overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3">
              <div className="w-5 h-5 skeleton-shimmer rounded"></div>
              <div className="h-4 skeleton-shimmer rounded-xl w-28 flex-1"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div>
      <h1 className="text-[22px] font-bold tracking-tight mb-6">과목/반 설정</h1>

      {/* 과목 탭 */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        {allSubjectsInUse.map(subject => (
          <TButton
            key={subject}
            onClick={() => setSelectedSubject(subject)}
            className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              selectedSubject === subject
                ? 'bg-[var(--blue)] text-white'
                : 'bg-[var(--bg-elevated)] text-[var(--text-3)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            {subject}
          </TButton>
        ))}
      </div>

      {/* 학년별 반 관리 */}
      {grades.length === 0 ? (
        <EmptyState icon={BookPlus} title="반을 추가해주세요" description="학년과 반을 추가하면 학생을 등록할 수 있어요" size="page" />
      ) : (
        <div className="space-y-2 mb-6">
          {grades.map((grade) => {
            const classesInSubject = grade.classes.filter(c => (c.subject ?? '') === selectedSubject)
            const totalStudents = classesInSubject.reduce((sum, cls) => sum + getActiveStudents(cls.students ?? []).length, 0)
            return (
              <div key={grade.id} className="card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3">
                  <span className="flex-1 font-semibold text-sm">{grade.name}</span>
                  <span className="text-xs text-[var(--text-4)] mr-1">{classesInSubject.length}개 반</span>
                  <span className="text-xs text-[var(--text-4)]">{totalStudents}명</span>
                </div>

                <div className="border-t border-[var(--border)] bg-[var(--bg-card-hover)]/50 px-4 py-3">
                  {classesInSubject.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {classesInSubject.map((cls, clsIdx) => (
                        <div key={cls.id} className="flex items-center gap-1.5 sm:gap-2 bg-[var(--bg-card)] rounded-lg px-2 sm:px-3 py-2">
                          {editingClassId === cls.id ? (
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <select
                                  value={SUBJECT_TABS.includes(editClassSubject as typeof SUBJECT_TABS[number]) ? editClassSubject : '__custom__'}
                                  onChange={e => {
                                    if (e.target.value === '__custom__') { setEditClassSubject(''); return }
                                    setEditClassSubject(e.target.value)
                                  }}
                                  className="w-[72px] shrink-0 px-1.5 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)] bg-[var(--bg-card)]"
                                >
                                  {SUBJECT_TABS.map(s => <option key={s} value={s}>{s}</option>)}
                                  <option value="__custom__">직접입력</option>
                                </select>
                                {!SUBJECT_TABS.includes(editClassSubject as typeof SUBJECT_TABS[number]) && (
                                  <input type="text" list="subject-list" value={editClassSubject} onChange={e => setEditClassSubject(e.target.value)} placeholder="과목" className="w-14 shrink-0 px-1.5 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]" />
                                )}
                                {editClassNameCustom ? (
                                  <input type="text" value={editClassName} onChange={e => setEditClassName(e.target.value)} className="flex-1 min-w-0 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]" placeholder="반 이름" autoFocus />
                                ) : (
                                  <select
                                    value={CLASS_NAME_PRESETS.includes(editClassName as typeof CLASS_NAME_PRESETS[number]) ? editClassName : '__custom__'}
                                    onChange={e => {
                                      if (e.target.value === '__custom__') { setEditClassNameCustom(true); setEditClassName(''); return }
                                      setEditClassName(e.target.value)
                                    }}
                                    className="flex-1 min-w-0 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)] bg-[var(--bg-card)]"
                                  >
                                    <option value="">반 선택...</option>
                                    {CLASS_NAME_PRESETS.map(n => <option key={n} value={n}>{n}</option>)}
                                    <option value="__custom__">직접입력</option>
                                  </select>
                                )}
                                <TButton onClick={() => updateClass(cls.id)} className="shrink-0 p-1.5 bg-[var(--blue-bg)] hover:bg-[var(--blue-dim)] text-[var(--blue)] rounded-full transition-colors" aria-label="저장"><Check className="w-3.5 h-3.5" strokeWidth={3} /></TButton>
                                <TButton onClick={() => setEditingClassId(null)} className="shrink-0 text-[var(--text-4)] p-1" aria-label="취소"><X className="w-4 h-4" /></TButton>
                              </div>
                              <div className="flex items-center gap-2 pl-1 min-w-0">
                                <span className="text-xs text-[var(--text-3)] shrink-0">원비</span>
                                <input type="number" value={editClassFee} onChange={e => setEditClassFee(e.target.value)} className="flex-1 min-w-0 max-w-[140px] px-2 py-1 border rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-[var(--blue)]" placeholder="원비" />
                                <span className="text-xs text-[var(--text-4)] shrink-0">원</span>
                              </div>
                              <div className="flex items-center gap-2 pl-1 min-w-0 flex-wrap">
                                <span className="text-xs text-[var(--text-3)] shrink-0">요일</span>
                                <DayPicker days={editClassDays} setDays={setEditClassDays} />
                              </div>
                              {teachers.length > 0 && (
                                <div className="flex items-center gap-2 pl-1 min-w-0">
                                  <span className="text-xs text-[var(--text-3)] shrink-0">선생님</span>
                                  <select value={editClassTeacherId} onChange={e => setEditClassTeacherId(e.target.value)} className="flex-1 min-w-0 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)] bg-[var(--bg-card)]">
                                    <option value="">없음</option>
                                    {teachers.map(t => <option key={t.id} value={t.id}>{t.name}{t.subject ? ` (${t.subject})` : ''}</option>)}
                                  </select>
                                </div>
                              )}
                            </div>
                          ) : (
                            <>
                              {/* 순서 변경 버튼 */}
                              <div className="flex flex-col shrink-0">
                                <TButton
                                  onClick={() => swapClassOrder(classesInSubject, clsIdx, -1)}
                                  disabled={clsIdx === 0}
                                  className="p-0 text-[var(--text-4)] hover:text-[var(--text-3)] disabled:opacity-20 disabled:hover:text-[var(--text-4)]"
                                  aria-label="위로"
                                >
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </TButton>
                                <TButton
                                  onClick={() => swapClassOrder(classesInSubject, clsIdx, 1)}
                                  disabled={clsIdx === classesInSubject.length - 1}
                                  className="p-0 text-[var(--text-4)] hover:text-[var(--text-3)] disabled:opacity-20 disabled:hover:text-[var(--text-4)]"
                                  aria-label="아래로"
                                >
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </TButton>
                              </div>
                              {cls.subject && (
                                <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded-full shrink-0 ${getSubjectColor(cls.subject)}`}>{cls.subject}</span>
                              )}
                              <span className="flex-1 text-xs sm:text-sm truncate min-w-0">{cls.name}</span>
                              {getTeacherName(cls.teacher_id) && (
                                <span className="text-[10px] sm:text-xs text-[var(--text-3)] shrink-0 hidden sm:inline">{getTeacherName(cls.teacher_id)}</span>
                              )}
                              {cls.class_days && (
                                <span className="text-[10px] sm:text-xs text-[var(--text-4)] shrink-0 hidden sm:inline">{parseClassDays(cls.class_days)?.map(d => DAY_LABELS[d]).join('/')}</span>
                              )}
                              <span className="text-xs sm:text-sm font-medium text-[var(--blue)] shrink-0">{formatFee(cls.monthly_fee)}</span>
                              <span className="text-[10px] sm:text-xs text-[var(--text-4)] shrink-0">{getActiveStudents(cls.students ?? []).length}명</span>
                              <TButton onClick={() => openTransfer(cls)} className="p-0.5 sm:p-1 text-[var(--text-4)] hover:text-[var(--blue)] shrink-0" aria-label="학생 반이동" title="학생 반이동">
                                <ArrowRightLeft className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                              </TButton>
                              <TButton onClick={() => { setEditingClassId(cls.id); setEditClassName(cls.name); setEditClassFee(String(cls.monthly_fee)); setEditClassSubject(cls.subject || ''); setEditClassDays(parseClassDays(cls.class_days) ?? []); setEditClassTeacherId(cls.teacher_id || '') }} className="p-0.5 sm:p-1 text-[var(--text-4)] hover:text-[var(--text-3)] shrink-0" aria-label="반 수정">
                                <Pencil className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                              </TButton>
                              <TButton onClick={() => deleteClass(cls.id, formatClassName(cls))} className="p-0.5 sm:p-1 text-[var(--text-4)] hover:text-[var(--unpaid-text)] shrink-0" aria-label="반 삭제">
                                <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                              </TButton>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {addingClassToGrade === grade.id ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <select
                          value={SUBJECT_TABS.includes(newClassSubject as typeof SUBJECT_TABS[number]) ? newClassSubject : '__custom__'}
                          onChange={e => {
                            if (e.target.value === '__custom__') { setNewClassSubject(''); return }
                            setNewClassSubject(e.target.value)
                          }}
                          className="w-[72px] shrink-0 px-1.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)] bg-[var(--bg-card)]"
                        >
                          {SUBJECT_TABS.map(s => <option key={s} value={s}>{s}</option>)}
                          <option value="__custom__">직접입력</option>
                        </select>
                        {!SUBJECT_TABS.includes(newClassSubject as typeof SUBJECT_TABS[number]) && (
                          <input
                            type="text" value={newClassSubject} onChange={e => setNewClassSubject(e.target.value)}
                            placeholder="과목" list="subject-list" className="w-14 shrink-0 px-1.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                          />
                        )}
                        {newClassNameCustom ? (
                          <input
                            type="text" value={newClassName} onChange={e => setNewClassName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addClass()}
                            placeholder="반 이름" className="flex-1 min-w-0 px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]" autoFocus
                          />
                        ) : (
                          <select
                            value={CLASS_NAME_PRESETS.includes(newClassName as typeof CLASS_NAME_PRESETS[number]) ? newClassName : '__custom__'}
                            onChange={e => {
                              if (e.target.value === '__custom__') { setNewClassNameCustom(true); setNewClassName(''); return }
                              setNewClassName(e.target.value)
                            }}
                            className="flex-1 min-w-0 px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)] bg-[var(--bg-card)]"
                            autoFocus
                          >
                            <option value="">반 선택...</option>
                            {CLASS_NAME_PRESETS.map(n => <option key={n} value={n}>{n}</option>)}
                            <option value="__custom__">직접입력</option>
                          </select>
                        )}
                        <TButton onClick={() => addClass()} className="shrink-0 p-1.5 bg-[var(--blue-bg)] hover:bg-[var(--blue-dim)] text-[var(--blue)] rounded-full transition-colors" aria-label="저장"><Check className="w-3.5 h-3.5" strokeWidth={3} /></TButton>
                        <TButton onClick={() => { setAddingClassToGrade(null); resetClassForm() }} className="shrink-0 text-[var(--text-4)] p-1" aria-label="취소"><X className="w-4 h-4" /></TButton>
                      </div>
                      <div className="flex items-center gap-2 pl-1 min-w-0">
                        <span className="text-xs text-[var(--text-3)] shrink-0">원비</span>
                        <input
                          type="number" value={newClassFee} onChange={e => setNewClassFee(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && addClass()}
                          placeholder="원비" className="flex-1 min-w-0 max-w-[140px] px-2 py-1.5 border rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                        />
                        <span className="text-xs text-[var(--text-4)] shrink-0">원</span>
                      </div>
                      <div className="flex items-center gap-2 pl-1 min-w-0 flex-wrap">
                        <span className="text-xs text-[var(--text-3)] shrink-0">요일</span>
                        <DayPicker days={newClassDays} setDays={setNewClassDays} />
                      </div>
                      {teachers.length > 0 && (
                        <div className="flex items-center gap-2 pl-1 min-w-0">
                          <span className="text-xs text-[var(--text-3)] shrink-0">선생님</span>
                          <select value={newClassTeacherId} onChange={e => setNewClassTeacherId(e.target.value)} className="flex-1 min-w-0 px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)] bg-[var(--bg-card)]">
                            <option value="">없음</option>
                            {teachers.map(t => <option key={t.id} value={t.id}>{t.name}{t.subject ? ` (${t.subject})` : ''}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  ) : (
                    <TButton
                      onClick={() => openClassFormForGrade(grade.id)}
                      className="flex items-center gap-1 text-sm text-[var(--blue)] font-medium hover:opacity-70"
                    >
                      <Plus className="w-4 h-4" /> 반 추가
                    </TButton>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <datalist id="subject-list">
        {existingSubjects.map(s => <option key={s} value={s} />)}
      </datalist>

      {/* 선생님 관리 */}
      <div className="mt-8">
        <div className="flex items-center gap-2 text-[15px] font-bold text-[var(--text-2)] mb-3">
          <UserCircle className="w-4.5 h-4.5" />
          선생님 관리
        </div>

        <div className="card overflow-hidden">
            <div className="px-4 py-3">
              {teachers.length > 0 && (
                <div className="space-y-2 mb-3">
                  {teachers.map((teacher, tIdx) => (
                    <div key={teacher.id} className="flex items-center gap-2 bg-[var(--bg-card-hover)] rounded-lg px-3 py-2">
                      {editingTeacherId === teacher.id ? (
                        <div className="flex-1 flex items-center gap-2">
                          <input type="text" value={editTeacherName} onChange={e => setEditTeacherName(e.target.value)} placeholder="이름" className="w-20 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]" autoFocus />
                          <input type="text" value={editTeacherSubject} onChange={e => setEditTeacherSubject(e.target.value)} placeholder="담당 과목" className="w-20 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]" />
                          <input type="tel" value={editTeacherPhone} onChange={e => setEditTeacherPhone(e.target.value)} placeholder="연락처" className="w-28 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]" />
                          <TButton onClick={() => updateTeacher(teacher.id)} className="shrink-0 p-1.5 bg-[var(--blue-bg)] hover:bg-[var(--blue-dim)] text-[var(--blue)] rounded-full transition-colors" aria-label="저장"><Check className="w-3.5 h-3.5" strokeWidth={3} /></TButton>
                          <TButton onClick={() => setEditingTeacherId(null)} className="text-[var(--text-4)] shrink-0" aria-label="취소"><X className="w-4 h-4" /></TButton>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-col shrink-0">
                            <TButton onClick={() => swapTeacherOrder(tIdx, -1)} disabled={tIdx === 0} className="p-0 text-[var(--text-4)] hover:text-[var(--text-3)] disabled:opacity-20" aria-label="위로">
                              <ChevronUp className="w-3.5 h-3.5" />
                            </TButton>
                            <TButton onClick={() => swapTeacherOrder(tIdx, 1)} disabled={tIdx === teachers.length - 1} className="p-0 text-[var(--text-4)] hover:text-[var(--text-3)] disabled:opacity-20" aria-label="아래로">
                              <ChevronDown className="w-3.5 h-3.5" />
                            </TButton>
                          </div>
                          <span className="text-sm font-medium">{teacher.name}</span>
                          {teacher.subject && <span className="text-xs text-[var(--text-4)]">{teacher.subject}</span>}
                          {teacher.phone && <span className="text-xs text-[var(--text-4)]">{teacher.phone}</span>}
                          <span className="flex-1" />
                          <Link href={`/teachers/${teacher.id}`} className="p-1 text-[var(--text-4)] hover:text-[var(--blue)]" aria-label="급여명세서" title="급여명세서">
                            <FileText className="w-3.5 h-3.5" />
                          </Link>
                          <TButton onClick={() => { setEditingTeacherId(teacher.id); setEditTeacherName(teacher.name); setEditTeacherPhone(teacher.phone || ''); setEditTeacherSubject(teacher.subject || '') }} className="p-1 text-[var(--text-4)] hover:text-[var(--text-3)]" aria-label="수정">
                            <Pencil className="w-3.5 h-3.5" />
                          </TButton>
                          <TButton onClick={() => deleteTeacher(teacher.id, teacher.name)} className="p-1 text-[var(--text-4)] hover:text-[var(--unpaid-text)]" aria-label="삭제">
                            <Trash2 className="w-3.5 h-3.5" />
                          </TButton>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {addingTeacher ? (
                <div className="flex items-center gap-2">
                  <input type="text" value={newTeacherName} onChange={e => setNewTeacherName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTeacher()} placeholder="이름" className="w-20 px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]" autoFocus />
                  <input type="text" value={newTeacherSubject} onChange={e => setNewTeacherSubject(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTeacher()} placeholder="담당 과목" className="w-20 px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]" />
                  <input type="tel" value={newTeacherPhone} onChange={e => setNewTeacherPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTeacher()} placeholder="연락처" className="w-28 px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]" />
                  <TButton onClick={addTeacher} className="shrink-0 p-1.5 bg-[var(--blue-bg)] hover:bg-[var(--blue-dim)] text-[var(--blue)] rounded-full transition-colors" aria-label="저장"><Check className="w-3.5 h-3.5" strokeWidth={3} /></TButton>
                  <TButton onClick={() => { setAddingTeacher(false); setNewTeacherName(''); setNewTeacherPhone(''); setNewTeacherSubject('') }} className="text-[var(--text-4)] shrink-0" aria-label="취소"><X className="w-4 h-4" /></TButton>
                </div>
              ) : (
                <TButton
                  onClick={() => setAddingTeacher(true)}
                  className="flex items-center gap-1 text-sm text-[var(--blue)] font-medium hover:opacity-70"
                >
                  <Plus className="w-4 h-4" /> 선생님 추가
                </TButton>
              )}
            </div>
          </div>
      </div>

      {/* 로그 & 로그아웃 */}
      <div className="mt-12 pt-6 border-t border-[var(--border)] space-y-3">
        <TButton
          onClick={() => loadLogs()}
          className="w-full py-3 text-[var(--text-3)] card text-sm font-medium hover:bg-[var(--bg-card-hover)] flex items-center justify-center gap-2 transition-colors"
        >
          <ScrollText className="w-4 h-4" />
          변경 로그
        </TButton>
        <TButton
          onClick={async () => {
            if (!confirm('로그아웃 하시겠습니까?')) return
            await fetch('/api/auth/logout', { method: 'POST' })
            router.push('/login')
            router.refresh()
          }}
          className="w-full py-3 text-[var(--unpaid-text)] card text-sm font-medium hover:bg-[var(--red-dim)] flex items-center justify-center gap-2 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          로그아웃
        </TButton>
      </div>

      {/* 학생 반이동 모달 */}
      {transferClass && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center" onClick={() => setTransferClass(null)}>
          <div className="bg-[var(--bg-card)] w-full sm:max-w-md sm:rounded-xl rounded-t-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-bold text-sm">학생 반이동</h2>
                <p className="text-xs text-[var(--text-4)] mt-0.5">{formatClassName(transferClass)}</p>
              </div>
              <TButton onClick={() => setTransferClass(null)} className="p-1 text-[var(--text-4)] hover:text-[var(--text-3)]" aria-label="닫기">
                <X className="w-5 h-5" />
              </TButton>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {/* 학생 선택 */}
              {(() => {
                const activeStudents = getActiveStudents(transferClass.students ?? [])
                if (activeStudents.length === 0) return (
                  <EmptyState icon={UsersRound} title="이 반에 학생이 없습니다" size="inline" />
                )
                return (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-[var(--text-3)]">{selectedStudents.size}명 선택</span>
                      <TButton onClick={selectAllStudents} className="text-xs text-[var(--blue)] font-medium">
                        {selectedStudents.size === activeStudents.length ? '선택 해제' : '전체 선택'}
                      </TButton>
                    </div>
                    <div className="space-y-1 mb-4">
                      {activeStudents.map(s => (
                        <TButton
                          key={s.id}
                          onClick={() => toggleStudentSelect(s.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-left transition-colors ${
                            selectedStudents.has(s.id) ? 'bg-[var(--blue)]/10 text-[var(--blue)]' : 'hover:bg-[var(--bg-card-hover)]'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            selectedStudents.has(s.id) ? 'bg-[var(--blue)] border-[var(--blue)]' : 'border-[var(--border)]'
                          }`}>
                            {selectedStudents.has(s.id) && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <span className="font-medium">{s.name}</span>
                        </TButton>
                      ))}
                    </div>
                  </>
                )
              })()}

              {/* 이동할 반 선택 */}
              {selectedStudents.size > 0 && (
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1.5 block font-medium">이동할 반</label>
                  <select
                    value={targetClassId}
                    onChange={e => setTargetClassId(e.target.value)}
                    className="w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)] bg-[var(--bg-card)]"
                  >
                    <option value="">반 선택...</option>
                    {allClasses.filter(c => c.id !== transferClass.id).map(c => (
                      <option key={c.id} value={c.id}>{c.gradeName} &gt; {formatClassName(c)} ({formatFee(c.monthly_fee)})</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* 하단 실행 버튼 */}
            {selectedStudents.size > 0 && targetClassId && (
              <div className="px-5 py-4 border-t shrink-0">
                <TButton
                  onClick={executeTransfer}
                  disabled={transferring}
                  className="w-full py-2.5 bg-[var(--blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {transferring ? (
                    <>처리 중...</>
                  ) : (
                    <>
                      <ArrowRightLeft className="w-4 h-4" />
                      {selectedStudents.size}명 반이동
                    </>
                  )}
                </TButton>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 감사 로그 모달 */}
      {showLogs && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center" onClick={() => setShowLogs(false)}>
          <div className="bg-[var(--bg-card)] w-full sm:max-w-lg sm:rounded-xl rounded-t-xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm">변경 로그</h2>
                <TButton
                  onClick={() => loadLogs({ warnOnly: !warnOnly })}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${warnOnly ? 'bg-[var(--red-dim)] text-[var(--unpaid-text)]' : 'bg-[var(--bg-elevated)] text-[var(--text-4)]'}`}
                >
                  ⚠️ 경고만
                </TButton>
              </div>
              <TButton onClick={() => setShowLogs(false)} className="p-1 text-[var(--text-4)] hover:text-[var(--text-3)]" aria-label="닫기">
                <X className="w-5 h-5" />
              </TButton>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {logsLoading ? (
                <div className="text-center py-12 text-[var(--text-4)] text-sm">불러오는 중...</div>
              ) : logs.length === 0 ? (
                <EmptyState icon={FileSearch} title={warnOnly ? '경고 로그가 없습니다' : '로그가 없습니다'} size="page" />
              ) : (
                <div className="space-y-2">
                  {logs.map(log => {
                    const actionColor = log.action === 'create' ? 'text-[#34d399] bg-[#1a3328]' : log.action === 'delete' ? 'text-[var(--unpaid-text)] bg-[var(--red-dim)]' : 'text-[#5b9cf5] bg-[#1c2d45]'
                    const actionLabel = log.action === 'create' ? '생성' : log.action === 'delete' ? '삭제' : '수정'
                    const date = new Date(log.created_at)
                    const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
                    return (
                      <div key={log.id} className={`flex items-start gap-2 py-2 border-b border-[var(--border)] last:border-0 ${log.summary?.startsWith('⚠️') ? 'bg-[var(--red-dim)]/40 -mx-2 px-2 rounded' : ''}`}>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 mt-0.5 ${actionColor}`}>{actionLabel}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[var(--text-1)] break-words">{log.summary}</p>
                          <p className="text-[10px] text-[var(--text-4)] mt-0.5">{timeStr}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
