'use client'

import { toast } from 'sonner'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Plus, ChevronDown, ChevronRight, UserCircle, BookPlus } from 'lucide-react'
import { TButton } from '@/components/motion'
import EmptyState from '@/components/ui/EmptyState'
import type { Grade, Student, GradeWithClasses } from '@/types'
import { formatWon, formatClassName } from '@/lib/format'
import { getStudentFee } from '@/types'
import StudentModal from '@/components/StudentModal'
import { getActiveStudents, safeFetch, safeMutate } from '@/lib/utils'

export default function StudentsPage() {
  const [grades, setGrades] = useState<GradeWithClasses[]>([])
  const [expandedGrades, setExpandedGrades] = useState<Set<string>>(new Set())
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [preselectedClassId, setPreselectedClassId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const { data, error } = await safeFetch<GradeWithClasses[]>('/api/grades')
    if (error) {
      toast.error(`데이터 로딩 실패: ${error}`)
      setLoading(false)
      return
    }
    const grades = data ?? []
    setGrades(grades)
    if (grades.length > 0 && expandedGrades.size === 0) {
      setExpandedGrades(new Set(grades.map((g: Grade) => g.id)))
    }
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const toggleGrade = (id: string) => {
    setExpandedGrades(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleClass = (id: string) => {
    setExpandedClasses(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleAddStudent = (classId?: string) => {
    setEditingStudent(null)
    setPreselectedClassId(classId ?? null)
    setShowModal(true)
  }

  const handleSave = async (data: Partial<Student>) => {
    const url = editingStudent ? `/api/students/${editingStudent.id}` : '/api/students'
    const method = editingStudent ? 'PUT' : 'POST'
    const { data: saved, error } = await safeMutate<{ _codeConflict?: 'none' | 'middle' | 'both'; _attendanceCode?: string }>(url, method, data)
    if (error) {
      toast.error(`저장 실패: ${error}`)
      return
    }
    if (saved?._codeConflict === 'middle') {
      toast.warning(`출결코드 뒷자리가 중복되어 가운데 번호 ${saved._attendanceCode}로 등록했습니다`)
    } else if (saved?._codeConflict === 'both') {
      toast.error(`출결코드가 뒷자리·가운데 모두 중복됩니다. 수동으로 확인해주세요 (현재 ${saved._attendanceCode})`)
    }
    setShowModal(false)
    fetchData()
  }

  const totalStudents = grades.reduce(
    (sum, g) => sum + g.classes.reduce((s, c) => s + getActiveStudents(c.students ?? []).length, 0),
    0
  )

  if (loading) return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-6 skeleton-shimmer rounded w-24 mb-2"></div>
          <div className="h-4 skeleton-shimmer rounded w-20"></div>
        </div>
        <div className="h-9 skeleton-shimmer rounded-lg w-24"></div>
      </div>
      <div className="space-y-3">
        {[...Array(3)].map((_, gi) => (
          <div data-paper-card="" key={gi} className="bg-[var(--bg-card)] rounded-xl border overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3">
              <div className="w-5 h-5 skeleton-shimmer rounded"></div>
              <div className="h-4 skeleton-shimmer rounded w-24 flex-1"></div>
              <div className="h-3 skeleton-shimmer rounded w-8"></div>
            </div>
            <div className="border-t">
              {[...Array(2)].map((_, ci) => (
                <div key={ci} className="border-b last:border-b-0">
                  <div className="flex items-center gap-2 px-6 py-2.5 bg-[var(--bg-card-hover)]">
                    <div className="w-4 h-4 skeleton-shimmer rounded"></div>
                    <div className="h-3 skeleton-shimmer rounded w-20 flex-1"></div>
                    <div className="h-3 skeleton-shimmer rounded w-16"></div>
                    <div className="h-3 skeleton-shimmer rounded w-8"></div>
                  </div>
                  <div className="px-6 py-2 space-y-1">
                    {[...Array(3)].map((_, si) => (
                      <div key={si} className="flex items-center gap-3 px-3 py-2">
                        <div className="w-8 h-8 skeleton-shimmer rounded-full"></div>
                        <div className="flex-1">
                          <div className="h-4 skeleton-shimmer rounded w-16 mb-1"></div>
                          <div className="h-3 skeleton-shimmer rounded w-32"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">학생 관리</h1>
          <p className="text-sm text-[var(--text-4)] mt-1">재원생 {totalStudents}명</p>
        </div>
        <TButton
          onClick={() => handleAddStudent()}
          className="px-4 py-2 bg-[var(--blue)] text-[var(--on-action)] rounded-lg text-sm font-medium flex items-center gap-1 hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> 학생 등록
        </TButton>
      </div>

      {grades.length === 0 ? (
        <EmptyState icon={BookPlus} title="먼저 설정에서 학년/반을 추가해주세요" size="page" />
      ) : (
        <div className="space-y-3">
          {grades.map(grade => (
            <div data-paper-card="" key={grade.id} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
              <TButton
                onClick={() => toggleGrade(grade.id)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left"
                aria-expanded={expandedGrades.has(grade.id)}
              >
                {expandedGrades.has(grade.id) ? <ChevronDown className="w-5 h-5 text-[var(--text-4)]" /> : <ChevronRight className="w-5 h-5 text-[var(--text-4)]" />}
                <span className="font-semibold text-sm flex-1">{grade.name}</span>
                <span className="text-xs text-[var(--text-4)]">
                  {grade.classes.reduce((s, c) => s + getActiveStudents(c.students ?? []).length, 0)}명
                </span>
              </TButton>

              {expandedGrades.has(grade.id) && (
                <div className="border-t">
                  {grade.classes.map(cls => {
                    const activeStudents = getActiveStudents(cls.students ?? [])
                    return (
                      <div key={cls.id} className="border-b last:border-b-0">
                        <TButton
                          onClick={() => toggleClass(cls.id)}
                          className="w-full flex items-center gap-2 px-6 py-2.5 text-left bg-[var(--bg-card-hover)] hover:bg-[var(--bg-elevated)]"
                          aria-expanded={expandedClasses.has(cls.id)}
                        >
                          {expandedClasses.has(cls.id) ? <ChevronDown className="w-4 h-4 text-[var(--text-4)]" /> : <ChevronRight className="w-4 h-4 text-[var(--text-4)]" />}
                          <span className="text-sm font-medium flex-1">{formatClassName(cls)}</span>
                          <span className="text-xs text-[var(--blue)] font-medium mr-2">{formatWon(cls.monthly_fee)}</span>
                          <span className="text-xs text-[var(--text-4)]">{activeStudents.length}명</span>
                        </TButton>

                        {expandedClasses.has(cls.id) && (
                          <div className="px-6 py-2">
                            {activeStudents.length > 0 ? (
                              <div className="space-y-1">
                                {activeStudents.map(student => (
                                  <Link
                                    key={student.id}
                                    href={`/students/${student.id}`}
                                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-card-hover)] transition-colors"
                                  >
                                    <UserCircle className="w-8 h-8 text-[var(--text-4)]" />
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium">{student.name}</div>
                                      <div className="text-xs text-[var(--text-4)]">
                                        등원 {student.enrollment_date} · {formatWon(getStudentFee(student, cls))}
                                      </div>
                                    </div>
                                  </Link>
                                ))}
                              </div>
                            ) : (
                              <EmptyState title="등록된 학생이 없습니다" size="compact" />
                            )}
                            <TButton
                              onClick={() => handleAddStudent(cls.id)}
                              className="flex items-center gap-1 text-xs text-[var(--blue)] font-medium mt-2 mb-1 hover:opacity-70"
                            >
                              <Plus className="w-3.5 h-3.5" /> 이 반에 학생 추가
                            </TButton>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <StudentModal
          student={editingStudent}
          grades={grades}
          defaultClassId={preselectedClassId}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
