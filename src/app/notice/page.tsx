'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, Send, Users, MessageSquare, Megaphone, ImagePlus, BookOpen, X } from 'lucide-react'
import { toast } from 'sonner'
import { useGrades, safeMutate, getActiveStudents } from '@/lib/utils'
import { formatClassName } from '@/lib/format'
import { parentPhone } from '@/lib/student-codes'
import type { GradeWithClasses, Student, Class } from '@/types'
import { MESSAGE_PREFIX } from '@/lib/branding'

type ClassWithStudents = Class & { students: Student[] }

interface SendResult {
  ok: boolean
  sent?: number
  failed?: number
  skipped?: { name: string; reason: string }[]
  error?: string
}

interface NoticeLog {
  id: string
  summary: string
  details: {
    isAd?: boolean
    toParent?: boolean
    toStudent?: boolean
    hasImage?: boolean
    content?: string
    sent?: number
    failed?: number
    recipients_count?: number
    skipped_count?: number
    recipients?: { name: string; ch: string }[]
  } | null
  created_at: string
}

const STUDIO_PREFIX = MESSAGE_PREFIX
const AD_PREFIX = '(광고)'
// 발송 대상 과목 카테고리 순서 (영어는 아래로)
const SUBJECT_ORDER = ['수학', '영어'] as const
const subjectDot = (s: string) => (s === '영어' ? 'bg-[var(--green)]' : 'bg-[var(--blue)]')
// 한글 1자=2바이트(EUC-KR 기준). SMS 90바이트 이하, 초과 시 LMS.
const SMS_BYTE_LIMIT = 90
const SMS_UNIT_PRICE = 9     // 솔라피 SMS 단가 (대략)
const LMS_UNIT_PRICE = 33    // 솔라피 LMS 단가 (대략)
const MMS_UNIT_PRICE = 77    // 솔라피 MMS(이미지) 단가 (대략)
const MMS_IMAGE_MAX_BYTES = 200 * 1024 // 솔라피 MMS 이미지 제한: JPG 200KB

interface AttachedImage {
  base64: string   // data URL prefix 없는 순수 base64 JPG
  dataUrl: string  // 미리보기용
  kb: number
  label: string
}

/**
 * 이미지(PNG 포함)를 솔라피 MMS 규격(JPG ≤200KB, 최대 1440px)으로 변환·압축.
 * 서버 의존성(sharp) 없이 브라우저 canvas로 처리 — PNG 투명 배경은 흰색으로 깔림.
 */
async function toMmsJpeg(src: Blob, label: string): Promise<AttachedImage> {
  const url = URL.createObjectURL(src)
  try {
    const img = new window.Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다'))
      img.src = url
    })
    let maxSide = 1440 // 솔라피 최대 1500×1440
    for (; maxSide >= 480; maxSide -= 320) {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.max(1, Math.round(img.naturalWidth * scale))
      const h = Math.max(1, Math.round(img.naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas 사용 불가')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      for (let q = 0.9; q >= 0.4; q -= 0.1) {
        const dataUrl = canvas.toDataURL('image/jpeg', q)
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
        const bytes = Math.floor(base64.length * 3 / 4)
        if (bytes <= MMS_IMAGE_MAX_BYTES) {
          return { base64, dataUrl, kb: Math.round(bytes / 1024), label }
        }
      }
    }
    throw new Error('이미지를 200KB 이하로 압축하지 못했습니다')
  } finally {
    URL.revokeObjectURL(url)
  }
}

function byteLength(s: string): number {
  // EUC-KR 근사: ASCII 1 / 한글 등 2 / BMP 밖(이모지 등) 4바이트.
  // for...of는 코드포인트 순회라 astral 문자가 2로만 세어져 SMS/LMS 판정·예상 비용이 어긋났다 (2026-08-13 라인리뷰)
  let n = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    n += cp > 0xffff ? 4 : cp > 0x7f ? 2 : 1
  }
  return n
}

function isNightHourKst(): boolean {
  const now = new Date()
  const kstHour = (now.getUTCHours() + 9) % 24
  return kstHour >= 21 || kstHour < 8
}

export default function NoticePage() {
  const { data: grades = [] } = useGrades<GradeWithClasses[]>()
  const [content, setContent] = useState('')
  const [isAd, setIsAd] = useState(false)
  // 수신자 기본 미선택 — 학부모/학생을 명시적으로 골라야 전송 버튼 활성화 (2026-07-13 msg 3608)
  const [toParent, setToParent] = useState(false)   // 수신자: 학부모
  const [toStudent, setToStudent] = useState(false) // 수신자: 학생 본인
  const [tab, setTab] = useState<'compose' | 'history'>('compose')
  const [history, setHistory] = useState<NoticeLog[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set(SUBJECT_ORDER))
  const [expandedGrades, setExpandedGrades] = useState<Set<string>>(new Set())
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)
  const [nightBlocked, setNightBlocked] = useState(false)
  // MMS 이미지 첨부 (memo A2A 2026-07-13 — 첫등원 안내 교재표지 전송 용도)
  const [image, setImage] = useState<AttachedImage | null>(null)
  const [imgBusy, setImgBusy] = useState(false)
  const [showCovers, setShowCovers] = useState(false)
  const [covers, setCovers] = useState<{ name: string; title: string }[]>([])
  const [coversLoading, setCoversLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 야간 차단 상태는 광고 토글 + 분 단위 갱신
  useEffect(() => {
    const check = () => setNightBlocked(isAd && isNightHourKst())
    check()
    const t = setInterval(check, 60_000)
    return () => clearInterval(t)
  }, [isAd])

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(false)
    try {
      const r = await fetch('/api/notice/history')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setHistory(Array.isArray(d.logs) ? d.logs : [])
    } catch {
      // 조회 실패가 '발송 내역이 없습니다'로 보이면 이력 0건과 구분 불가 (2026-08-13 라인리뷰)
      setHistoryError(true)
    }
    setHistoryLoading(false)
  }, [])

  useEffect(() => { if (tab === 'history') fetchHistory() }, [tab, fetchHistory])

  // 최종 발송 본문 미리보기
  const finalText = useMemo(() => {
    const trimmed = content.trim()
    if (!trimmed) return ''
    return `${isAd ? AD_PREFIX : ''}${STUDIO_PREFIX}${trimmed}`
  }, [content, isAd])

  // SMS / LMS / MMS 판정 + 단가 (이미지 첨부 시 무조건 MMS)
  const messageType = useMemo<'SMS' | 'LMS' | 'MMS'>(() => {
    if (image) return 'MMS'
    return byteLength(finalText) <= SMS_BYTE_LIMIT ? 'SMS' : 'LMS'
  }, [finalText, image])
  const unitPrice = messageType === 'MMS' ? MMS_UNIT_PRICE : messageType === 'SMS' ? SMS_UNIT_PRICE : LMS_UNIT_PRICE

  // 학생 ID → 학부모 phone 매핑 (중복 가족 phone 1건만 카운트)
  const recipientStats = useMemo(() => {
    const seenPhones = new Set<string>()
    let withPhone = 0
    let withoutPhone = 0
    for (const studentId of selectedIds) {
      let found: Student | null = null
      for (const g of grades) {
        for (const c of g.classes) {
          const s = (c.students ?? []).find(st => st.id === studentId)
          if (s) { found = s; break }
        }
        if (found) break
      }
      if (!found) continue
      const targets: string[] = []
      if (toParent) {
        const pp = parentPhone(found).replace(/-/g, '').trim()
        if (pp) targets.push(pp)
      }
      if (toStudent) {
        const sp = (found.phone || '').replace(/-/g, '').trim()
        if (sp) targets.push(sp)
      }
      if (targets.length === 0) { withoutPhone++; continue }
      for (const t of targets) {
        if (seenPhones.has(t)) continue
        seenPhones.add(t)
        withPhone++
      }
    }
    return { withPhone, withoutPhone, estimatedCost: withPhone * unitPrice }
  }, [selectedIds, grades, unitPrice, toParent, toStudent])

  // 최종 확인용 수신자 명단 (이름 + 학부모/학생)
  const recipientPreview = useMemo(() => {
    const list: { name: string; ch: string }[] = []
    for (const studentId of selectedIds) {
      let found: Student | null = null
      for (const g of grades) {
        for (const c of g.classes) {
          const s = (c.students ?? []).find(st => st.id === studentId)
          if (s) { found = s; break }
        }
        if (found) break
      }
      if (!found) continue
      const chans: string[] = []
      if (toParent && parentPhone(found).replace(/-/g, '').trim()) chans.push('학부모')
      if (toStudent && (found.phone || '').replace(/-/g, '').trim()) chans.push('학생')
      if (chans.length === 0) continue
      list.push({ name: found.name, ch: chans.join('·') })
    }
    return list
  }, [selectedIds, grades, toParent, toStudent])

  // 전체 활성 학생
  const allStudentIds = useMemo(() => {
    const ids = new Set<string>()
    for (const g of grades) {
      for (const c of g.classes) {
        for (const s of getActiveStudents(c.students ?? [])) {
          ids.add(s.id)
        }
      }
    }
    return ids
  }, [grades])

  // 발송 대상을 과목 카테고리(수학→영어)로 분리. 각 과목엔 해당 과목 반만 가진 학년 트리.
  const gradesBySubject = useMemo(() => {
    return SUBJECT_ORDER.map(subject => {
      const subjGrades: GradeWithClasses[] = grades
        .map(g => ({ ...g, classes: g.classes.filter(c => c.subject === subject) as ClassWithStudents[] }))
        .filter(g => g.classes.some(c => getActiveStudents(c.students ?? []).length > 0))
      return { subject: subject as string, grades: subjGrades }
    }).filter(group => group.grades.length > 0)
  }, [grades])

  const toggleStudent = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleClass = (students: Student[]) => {
    const studentIds = students.map(s => s.id)
    const allSelected = studentIds.every(id => selectedIds.has(id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allSelected) studentIds.forEach(id => next.delete(id))
      else studentIds.forEach(id => next.add(id))
      return next
    })
  }

  const toggleGrade = (grade: GradeWithClasses) => {
    const studentIds: string[] = []
    grade.classes.forEach(c => {
      getActiveStudents(c.students ?? []).forEach(s => studentIds.push(s.id))
    })
    const allSelected = studentIds.every(id => selectedIds.has(id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allSelected) studentIds.forEach(id => next.delete(id))
      else studentIds.forEach(id => next.add(id))
      return next
    })
  }

  const toggleAll = () => {
    const allSelected = allStudentIds.size > 0 && Array.from(allStudentIds).every(id => selectedIds.has(id))
    setSelectedIds(allSelected ? new Set() : new Set(allStudentIds))
  }

  const toggleGradeExpand = (gradeId: string) => {
    setExpandedGrades(prev => {
      const next = new Set(prev)
      if (next.has(gradeId)) next.delete(gradeId); else next.add(gradeId)
      return next
    })
  }
  const toggleClassExpand = (classId: string) => {
    setExpandedClasses(prev => {
      const next = new Set(prev)
      if (next.has(classId)) next.delete(classId); else next.add(classId)
      return next
    })
  }
  const toggleSubjectExpand = (subject: string) => {
    setExpandedSubjects(prev => {
      const next = new Set(prev)
      if (next.has(subject)) next.delete(subject); else next.add(subject)
      return next
    })
  }
  const toggleSubject = (subjGrades: GradeWithClasses[]) => {
    const studentIds: string[] = []
    subjGrades.forEach(g => g.classes.forEach(c => {
      getActiveStudents(c.students ?? []).forEach(s => studentIds.push(s.id))
    }))
    const allSel = studentIds.length > 0 && studentIds.every(id => selectedIds.has(id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allSel) studentIds.forEach(id => next.delete(id))
      else studentIds.forEach(id => next.add(id))
      return next
    })
  }

  // 파일 선택 → MMS 규격 변환
  const handleFilePick = useCallback(async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('이미지 파일만 첨부할 수 있습니다'); return }
    setImgBusy(true)
    try {
      const converted = await toMmsJpeg(file, file.name)
      setImage(converted)
      toast.success(`이미지 첨부 (${converted.kb}KB, JPG 변환됨)`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '이미지 변환 실패')
    } finally {
      setImgBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [])

  // 교재 표지 선택 → 서버 PNG 받아 변환
  const handleCoverPick = useCallback(async (cover: { name: string; title: string }) => {
    setImgBusy(true)
    setShowCovers(false)
    try {
      const r = await fetch(`/api/notice/covers?file=${encodeURIComponent(cover.name)}`)
      if (!r.ok) throw new Error('표지 파일을 불러오지 못했습니다')
      const blob = await r.blob()
      const converted = await toMmsJpeg(blob, cover.title)
      setImage(converted)
      toast.success(`「${cover.title}」 표지 첨부 (${converted.kb}KB)`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '표지 첨부 실패')
    } finally {
      setImgBusy(false)
    }
  }, [])

  const openCovers = useCallback(async () => {
    setShowCovers(true)
    if (covers.length > 0) return
    setCoversLoading(true)
    try {
      const r = await fetch('/api/notice/covers')
      const d = await r.json()
      setCovers(Array.isArray(d.covers) ? d.covers : [])
      if (!r.ok) toast.error(d.error || '표지 목록을 불러오지 못했습니다')
    } catch {
      toast.error('표지 목록을 불러오지 못했습니다')
    } finally {
      setCoversLoading(false)
    }
  }, [covers.length])

  const handleSend = useCallback(async () => {
    if (submitting) return
    if (!content.trim()) { toast.error('본문을 입력해주세요'); return }
    if (selectedIds.size === 0) { toast.error('발송 대상을 선택해주세요'); return }
    if (!toParent && !toStudent) { toast.error('수신자(학부모/학생)를 하나 이상 선택해주세요'); return }
    if (isAd && isNightHourKst()) {
      toast.error('광고 문자는 21시~익일 08시에 발송할 수 없습니다')
      return
    }
    setSubmitting(true)
    const { data, error } = await safeMutate<SendResult>('/api/notice/send', 'POST', {
      studentIds: Array.from(selectedIds),
      content: content.trim(),
      isAd,
      toParent,
      toStudent,
      ...(image ? { image: image.base64 } : {}),
    })
    setSubmitting(false)
    setShowConfirm(false)
    if (error || !data?.ok) {
      const msg = error || data?.error || '발송 실패'
      toast.error(`발송 실패: ${msg}`)
      setResult({ ok: false, error: msg })
      return
    }
    setResult(data)
    toast.success(`문자 ${data.sent}건 발송 완료${data.failed ? ` (실패 ${data.failed})` : ''}`)
    setSelectedIds(new Set())
    setContent('')
    setIsAd(false)
    setImage(null)
  }, [content, selectedIds, submitting, isAd, toParent, toStudent, image])

  const allSelected = allStudentIds.size > 0 && Array.from(allStudentIds).every(id => selectedIds.has(id))

  // 학년 트리 1개 렌더 (과목별로 호출 — expand 키는 subject로 네임스페이스)
  const renderGrade = (g: GradeWithClasses, subject: string) => {
    const gradeKey = `${subject}:${g.id}`
    const gradeStudents: Student[] = g.classes.flatMap(c => getActiveStudents(c.students ?? []))
    const gradeSelectedCount = gradeStudents.filter(s => selectedIds.has(s.id)).length
    const gradeAllSelected = gradeStudents.length > 0 && gradeSelectedCount === gradeStudents.length
    const gradePartial = gradeSelectedCount > 0 && !gradeAllSelected
    const gradeExpanded = expandedGrades.has(gradeKey)

    return (
      <div key={gradeKey}>
        <div className="flex items-center gap-1 py-1.5">
          <button
            type="button"
            onClick={() => toggleGradeExpand(gradeKey)}
            className="p-1.5 rounded-md hover:bg-[var(--bg-card-hover)]"
            aria-label={gradeExpanded ? '접기' : '펼치기'}
          >
            <ChevronRight className={`w-3.5 h-3.5 text-[var(--text-3)] transition-transform ${gradeExpanded ? 'rotate-90' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => toggleGrade(g)}
            className="flex-1 flex items-center gap-2 text-left py-1"
          >
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              gradeAllSelected ? 'bg-[var(--blue)] border-[var(--blue)]' : gradePartial ? 'bg-[var(--blue-dim)] border-[var(--blue)]' : 'border-[var(--border)]'
            }`}>
              {gradeAllSelected && <span className="text-white text-xs leading-none">✓</span>}
              {gradePartial && <span className="text-[var(--blue)] text-xs leading-none">−</span>}
            </div>
            <span className="text-[14px] font-bold text-[var(--text-1)]">{g.name}</span>
            <span className="text-[12px] text-[var(--text-4)] tabular-nums">{gradeSelectedCount}/{gradeStudents.length}</span>
          </button>
        </div>

        <AnimatePresence initial={false}>
          {gradeExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: 'hidden' }}
              className="ml-7 border-l border-[var(--border)] pl-2"
            >
              {g.classes.map(c => {
                const classStudents = getActiveStudents(c.students ?? [])
                if (classStudents.length === 0) return null
                const classSelectedCount = classStudents.filter(s => selectedIds.has(s.id)).length
                const classAllSelected = classSelectedCount === classStudents.length
                const classPartial = classSelectedCount > 0 && !classAllSelected
                const classExpanded = expandedClasses.has(c.id)

                return (
                  <div key={c.id}>
                    <div className="flex items-center gap-1 py-1">
                      <button
                        type="button"
                        onClick={() => toggleClassExpand(c.id)}
                        className="p-1 rounded-md hover:bg-[var(--bg-card-hover)]"
                        aria-label={classExpanded ? '접기' : '펼치기'}
                      >
                        <ChevronRight className={`w-3 h-3 text-[var(--text-3)] transition-transform ${classExpanded ? 'rotate-90' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleClass(classStudents)}
                        className="flex-1 flex items-center gap-2 text-left py-0.5"
                      >
                        <div className={`w-4 h-4 rounded border-[1.5px] flex items-center justify-center transition-colors ${
                          classAllSelected ? 'bg-[var(--blue)] border-[var(--blue)]' : classPartial ? 'bg-[var(--blue-dim)] border-[var(--blue)]' : 'border-[var(--border)]'
                        }`}>
                          {classAllSelected && <span className="text-white text-[10px] leading-none">✓</span>}
                          {classPartial && <span className="text-[var(--blue)] text-[10px] leading-none">−</span>}
                        </div>
                        <span className="text-[13px] text-[var(--text-2)]">{formatClassName(c)}</span>
                        <span className="text-[11px] text-[var(--text-4)] tabular-nums">{classSelectedCount}/{classStudents.length}</span>
                      </button>
                    </div>

                    <AnimatePresence initial={false}>
                      {classExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          style={{ overflow: 'hidden' }}
                          className="ml-6 border-l border-[var(--border)] pl-2"
                        >
                          {classStudents.map(s => {
                            const selected = selectedIds.has(s.id)
                            const hasPhone = !!parentPhone(s)
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => toggleStudent(s.id)}
                                className="w-full flex items-center gap-2 py-1 text-left hover:bg-[var(--bg-card-hover)] rounded px-1"
                              >
                                <div className={`w-3.5 h-3.5 rounded border-[1.5px] flex items-center justify-center transition-colors ${
                                  selected ? 'bg-[var(--blue)] border-[var(--blue)]' : 'border-[var(--border)]'
                                }`}>
                                  {selected && <span className="text-white text-[9px] leading-none">✓</span>}
                                </div>
                                <span className="text-[12px] text-[var(--text-2)]">{s.name}</span>
                                {!hasPhone && (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--orange-dim)] text-[var(--orange)]">학부모 폰 X</span>
                                )}
                              </button>
                            )
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className="pb-20">
      {/* 헤더 */}
      <div className="mb-6 flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-[var(--blue-bg)] flex items-center justify-center">
          <MessageSquare className="w-5 h-5 text-[var(--blue)]" />
        </div>
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-[var(--text-1)]">공지 발송</h1>
          <p className="text-[12px] text-[var(--text-4)] -mt-0.5">학부모·학생에게 문자(SMS/LMS)로 일괄 안내</p>
        </div>
      </div>

      {/* 탭: 작성 / 발송 내역 */}
      <div className="flex gap-1 p-1 mb-4 bg-[var(--bg-elevated)] rounded-xl">
        {([['compose', '작성'], ['history', '발송 내역']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 py-2 rounded-lg text-[13px] font-bold transition-colors ${tab === k ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-3)] hover:text-[var(--text-1)]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'compose' && (
      <>
      {/* 수신자 선택 — 학부모/학생 (중복 선택 가능). 공지 내용보다 위에 배치(사용자 지시) */}
      <div className="card p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Send className="w-4 h-4 text-[var(--text-3)]" />
          <h2 className="text-[14px] font-bold text-[var(--text-1)]">수신자</h2>
          <span className="text-[11px] text-[var(--text-4)]">중복 선택 가능</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setToParent(v => !v)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold border transition-all active:scale-[0.97] ${
              toParent ? 'bg-[var(--blue-dim)] border-[var(--blue)] text-[var(--blue)]' : 'bg-[var(--bg-elevated)] border-transparent text-[var(--text-3)]'
            }`}
          >
            <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${toParent ? 'bg-[var(--blue)] border-[var(--blue)]' : 'border-[var(--border)]'}`}>
              {toParent && <span className="text-white text-[10px] leading-none">✓</span>}
            </span>
            학부모
          </button>
          <button
            type="button"
            onClick={() => setToStudent(v => !v)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold border transition-all active:scale-[0.97] ${
              toStudent ? 'bg-[var(--blue-dim)] border-[var(--blue)] text-[var(--blue)]' : 'bg-[var(--bg-elevated)] border-transparent text-[var(--text-3)]'
            }`}
          >
            <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${toStudent ? 'bg-[var(--blue)] border-[var(--blue)]' : 'border-[var(--border)]'}`}>
              {toStudent && <span className="text-white text-[10px] leading-none">✓</span>}
            </span>
            학생
          </button>
        </div>
        {!toParent && !toStudent && (
          <p className="text-[11px] text-[var(--red)] mt-2">수신자를 하나 이상 선택해주세요</p>
        )}
      </div>

      {/* 본문 입력 */}
      <div className="card p-4 mb-4">
        <label className="block text-[12px] font-bold text-[var(--text-3)] mb-2">공지 내용</label>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="학부모님께 전달할 공지 내용을 입력하세요&#10;&#10;예시:&#10;- 5/27(화) 정기시험 안내&#10;- 호우주의보로 5/22 오후 수업 휴강&#10;- 학원 운영시간 변경 안내"
          rows={8}
          maxLength={1500}
          className="w-full px-4 py-3 bg-[var(--bg-elevated)] rounded-xl text-[14px] text-[var(--text-1)] placeholder-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] resize-none"
        />
        <div className="flex justify-between items-center mt-1">
          <p className="text-[11px] text-[var(--text-4)]">
            맨앞에 <span className="font-semibold text-[var(--text-3)]">{STUDIO_PREFIX.trim()}</span> 자동 부착 · {messageType}({byteLength(finalText)}바이트)
          </p>
          <p className="text-[11px] text-[var(--text-4)] tabular-nums">{content.length} / 1500</p>
        </div>
      </div>

      {/* 이미지 첨부 (MMS) */}
      <div className="card p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <ImagePlus className="w-4 h-4 text-[var(--text-3)]" />
          <h2 className="text-[14px] font-bold text-[var(--text-1)]">이미지 첨부</h2>
          <span className="text-[11px] text-[var(--text-4)]">첨부 시 MMS 발송 · JPG 200KB로 자동 변환</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => handleFilePick(e.target.files?.[0] ?? null)}
        />
        <AnimatePresence mode="wait" initial={false}>
          {image ? (
            <motion.div
              key="preview"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-3 p-2 rounded-xl bg-[var(--bg-elevated)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.dataUrl} alt={image.label} className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[var(--text-1)] truncate">{image.label}</p>
                <p className="text-[11px] text-[var(--text-4)]">JPG · {image.kb}KB · MMS로 발송됩니다</p>
              </div>
              <button
                type="button"
                onClick={() => setImage(null)}
                className="p-2 rounded-lg hover:bg-[var(--bg-card-hover)] active:scale-90 transition-all"
                aria-label="이미지 제거"
              >
                <X className="w-4 h-4 text-[var(--text-3)]" />
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="buttons"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex gap-2"
            >
              <button
                type="button"
                disabled={imgBusy}
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold bg-[var(--bg-elevated)] text-[var(--text-2)] hover:text-[var(--text-1)] active:scale-[0.97] transition-all disabled:opacity-40"
              >
                <ImagePlus className="w-4 h-4" />
                {imgBusy ? '변환 중...' : '사진 선택'}
              </button>
              <button
                type="button"
                disabled={imgBusy}
                onClick={openCovers}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold bg-[var(--bg-elevated)] text-[var(--text-2)] hover:text-[var(--text-1)] active:scale-[0.97] transition-all disabled:opacity-40"
              >
                <BookOpen className="w-4 h-4" />
                교재 표지
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 광고 체크박스 */}
      <div className={`card p-3 mb-4 ${isAd ? 'border border-[var(--orange)]/40 bg-[var(--orange-dim)]/30' : ''}`}>
        <button
          type="button"
          onClick={() => setIsAd(v => !v)}
          className="w-full flex items-start gap-3 text-left"
        >
          <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
            isAd ? 'bg-[var(--orange)] border-[var(--orange)]' : 'border-[var(--border)]'
          }`}>
            {isAd && <span className="text-white text-xs leading-none">✓</span>}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-1)]">
              <Megaphone className="w-3.5 h-3.5" />
              광고성 문자로 발송
            </div>
            <p className="text-[11px] text-[var(--text-3)] mt-0.5 leading-relaxed">
              체크 시 본문 맨앞에 <span className="font-semibold">(광고)</span> 표시 추가. 정보통신망법에 따라 사전 수신동의자에게만 발송할 수 있으며, 21시~익일 08시는 발송 차단됩니다.
            </p>
            {nightBlocked && (
              <p className="text-[11px] text-[var(--red)] mt-1 font-semibold">
                지금은 야간 시간대라 광고 발송이 차단됩니다 (해제 후 발송하세요)
              </p>
            )}
          </div>
        </button>
      </div>

      {/* 발송 대상 선택 */}
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--text-3)]" />
            <h2 className="text-[14px] font-bold text-[var(--text-1)]">발송 대상</h2>
          </div>
          <button
            type="button"
            onClick={toggleAll}
            className={`text-[12px] px-3 py-1 rounded-full font-semibold transition-colors ${
              allSelected
                ? 'bg-[var(--blue)] text-white'
                : 'bg-[var(--bg-elevated)] text-[var(--text-3)] hover:text-[var(--text-1)]'
            }`}
          >
            {allSelected ? '전체 해제' : '전체 선택'}
          </button>
        </div>

        <div className="space-y-2">
          {gradesBySubject.map(({ subject, grades: subjGrades }) => {
            const subjStudents: Student[] = subjGrades.flatMap(g => g.classes.flatMap(c => getActiveStudents(c.students ?? [])))
            const subjSelectedCount = subjStudents.filter(s => selectedIds.has(s.id)).length
            const subjAllSelected = subjStudents.length > 0 && subjSelectedCount === subjStudents.length
            const subjPartial = subjSelectedCount > 0 && !subjAllSelected
            const subjExpanded = expandedSubjects.has(subject)

            return (
              <div key={subject} className="rounded-xl bg-[var(--bg-elevated)]/40 border border-[var(--border)] overflow-hidden">
                <div className="flex items-center gap-1 px-2 py-2">
                  <button
                    type="button"
                    onClick={() => toggleSubjectExpand(subject)}
                    className="p-1.5 rounded-md hover:bg-[var(--bg-card-hover)]"
                    aria-label={subjExpanded ? '접기' : '펼치기'}
                  >
                    <ChevronRight className={`w-4 h-4 text-[var(--text-3)] transition-transform ${subjExpanded ? 'rotate-90' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSubject(subjGrades)}
                    className="flex-1 flex items-center gap-2 text-left py-0.5"
                  >
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                      subjAllSelected ? 'bg-[var(--blue)] border-[var(--blue)]' : subjPartial ? 'bg-[var(--blue-dim)] border-[var(--blue)]' : 'border-[var(--border)]'
                    }`}>
                      {subjAllSelected && <span className="text-white text-xs leading-none">✓</span>}
                      {subjPartial && <span className="text-[var(--blue)] text-xs leading-none">−</span>}
                    </div>
                    <span className={`w-2 h-2 rounded-full ${subjectDot(subject)}`} />
                    <span className="text-[15px] font-extrabold text-[var(--text-1)]">{subject}</span>
                    <span className="text-[12px] text-[var(--text-4)] tabular-nums">{subjSelectedCount}/{subjStudents.length}</span>
                  </button>
                </div>

                <AnimatePresence initial={false}>
                  {subjExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      style={{ overflow: 'hidden' }}
                      className="px-2 pb-2"
                    >
                      <div className="space-y-1">
                        {subjGrades.map(g => renderGrade(g, subject))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      </div>

      {/* 발송 미리보기 + 버튼 */}
      <div className="card p-4 mb-4 sticky bottom-4 z-10 backdrop-blur-md bg-[var(--bg-card)]/90 border border-[var(--border)]">
        <div className="flex items-center justify-between mb-3 text-[13px]">
          <div className="flex gap-3">
            <span className="text-[var(--text-3)]">대상: <strong className="text-[var(--text-1)] tabular-nums">{recipientStats.withPhone}</strong>명</span>
            {recipientStats.withoutPhone > 0 && (
              <span className="text-[var(--orange)]">미발송: <strong className="tabular-nums">{recipientStats.withoutPhone}</strong></span>
            )}
          </div>
          <span className="text-[var(--text-4)] tabular-nums">
            {messageType} · 예상 ~{recipientStats.estimatedCost.toLocaleString()}원
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          disabled={submitting || (!toParent && !toStudent) || recipientStats.withPhone === 0 || !content.trim() || nightBlocked || imgBusy}
          className="w-full py-3.5 rounded-2xl bg-[var(--blue)] text-white text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99] transition-all shadow-lg"
        >
          <Send className="w-4 h-4" />
          {submitting ? '발송 중...'
            : (!toParent && !toStudent) ? '수신자를 먼저 선택하세요'
            : `${recipientStats.withPhone}명에게 ${isAd ? '광고 ' : ''}${image ? '이미지 ' : ''}문자 발송`}
        </button>
      </div>

      {/* 결과 표시 */}
      {result && (
        <div className={`card p-4 mb-4 ${result.ok ? 'border border-[var(--paid-text)]/30' : 'border border-[var(--red)]/30'}`}>
          {result.ok ? (
            <div>
              <p className="font-bold text-[var(--paid-text)] mb-1">✓ 발송 완료</p>
              <p className="text-[13px] text-[var(--text-2)]">총 {result.sent}건 발송{result.failed ? ` · 실패 ${result.failed}` : ''}</p>
              {result.skipped && result.skipped.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[12px] text-[var(--text-4)] cursor-pointer">미발송 {result.skipped.length}명</summary>
                  <ul className="mt-1 text-[12px] text-[var(--text-3)] space-y-0.5">
                    {result.skipped.map((s, i) => <li key={i}>· {s.name} — {s.reason}</li>)}
                  </ul>
                </details>
              )}
            </div>
          ) : (
            <p className="text-[var(--red)]">발송 실패: {result.error}</p>
          )}
        </div>
      )}
      </>
      )}

      {tab === 'history' && (
        <div className="space-y-3">
          {historyLoading ? (
            <p className="text-center text-[13px] text-[var(--text-4)] py-8">불러오는 중...</p>
          ) : history.length === 0 ? (
            historyError ? (
              <button onClick={fetchHistory} className="w-full text-center text-[13px] text-[var(--red)] py-8">
                발송 내역을 불러오지 못했습니다 — 눌러서 재시도
              </button>
            ) : (
            <p className="text-center text-[13px] text-[var(--text-4)] py-8">발송 내역이 없습니다</p>
            )
          ) : (
            history.map(log => {
              const d = log.details ?? {}
              const aud = [d.toParent && '학부모', d.toStudent && '학생'].filter(Boolean).join('·') || '학부모'
              const date = new Date(log.created_at)
              const dateStr = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
              return (
                <div key={log.id} className="card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-bold text-[var(--blue)] bg-[var(--blue-dim)] px-2 py-0.5 rounded-full">{aud}</span>
                      {d.isAd && <span className="text-[11px] font-bold text-[var(--orange)] bg-[var(--orange-dim)] px-2 py-0.5 rounded-full">광고</span>}
                      {d.hasImage && <span className="text-[11px] font-bold text-[var(--blue)] bg-[var(--blue-dim)] px-2 py-0.5 rounded-full">📷 이미지</span>}
                    </div>
                    <span className="text-[11px] text-[var(--text-4)] tabular-nums">{dateStr}</span>
                  </div>
                  {d.content && (
                    <p className="text-[13px] text-[var(--text-2)] whitespace-pre-wrap break-words mb-2 line-clamp-3">{d.content}</p>
                  )}
                  <div className="flex items-center gap-3 text-[12px]">
                    <span className="text-[var(--paid-text)] font-semibold">발송 {d.sent ?? d.recipients_count ?? 0}건</span>
                    {(d.failed ?? 0) > 0 && <span className="text-[var(--red)]">실패 {d.failed}</span>}
                    {(d.skipped_count ?? 0) > 0 && <span className="text-[var(--text-4)]">미발송 {d.skipped_count}</span>}
                  </div>
                  {d.recipients && d.recipients.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-[12px] text-[var(--text-3)] cursor-pointer select-none">받는 사람 {d.recipients.length}명</summary>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {d.recipients.map((r, i) => (
                          <span key={i} className="text-[11px] text-[var(--text-2)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded-full">
                            {r.name}<span className="text-[var(--text-4)] ml-1">{r.ch}</span>
                          </span>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* 교재 표지 선택 시트 */}
      <AnimatePresence>
        {showCovers && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
            onClick={() => setShowCovers(false)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="bg-[var(--bg-card)] w-full max-w-md rounded-2xl p-5 shadow-2xl max-h-[80vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[16px] font-bold text-[var(--text-1)] flex items-center gap-2">
                  <BookOpen className="w-4 h-4" /> 교재 표지 선택
                </h3>
                <button
                  type="button"
                  onClick={() => setShowCovers(false)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] active:scale-90 transition-all"
                  aria-label="닫기"
                >
                  <X className="w-4 h-4 text-[var(--text-3)]" />
                </button>
              </div>
              <div className="overflow-y-auto -mx-1 px-1">
                {coversLoading ? (
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="aspect-[3/4] rounded-xl bg-[var(--bg-elevated)] animate-pulse" />
                    ))}
                  </div>
                ) : covers.length === 0 ? (
                  <p className="text-[13px] text-[var(--text-4)] py-8 text-center">표지 목록이 비어 있습니다</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {covers.map(c => (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => handleCoverPick(c)}
                        className="group rounded-xl overflow-hidden bg-[var(--bg-elevated)] text-left active:scale-[0.96] transition-all"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/notice/covers?file=${encodeURIComponent(c.name)}`}
                          alt={c.title}
                          loading="lazy"
                          className="w-full aspect-[3/4] object-cover group-hover:opacity-90 transition-opacity"
                        />
                        <p className="text-[10px] text-[var(--text-3)] px-1.5 py-1 truncate">{c.title}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm 모달 */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
            onClick={() => setShowConfirm(false)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="bg-[var(--bg-card)] w-full max-w-sm rounded-2xl p-5 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-[18px] font-bold text-[var(--text-1)] mb-2">
                {isAd ? '광고 문자 — 최종 확인' : '발송 전 최종 확인'}
              </h3>
              <p className="text-[13px] text-[var(--text-3)] mb-4">
                대상 <strong className="text-[var(--text-1)]">{recipientStats.withPhone}건</strong> · {messageType} · 비용 약 <strong className="text-[var(--text-1)]">{recipientStats.estimatedCost.toLocaleString()}원</strong>
              </p>
              <div className="bg-[var(--bg-elevated)] rounded-xl p-3 mb-3 max-h-40 overflow-y-auto">
                <p className="text-[10px] text-[var(--text-4)] mb-1.5">받는 사람 {recipientPreview.length}명</p>
                <div className="flex flex-wrap gap-1.5">
                  {recipientPreview.map((r, i) => (
                    <span key={i} className="text-[11px] text-[var(--text-2)] bg-[var(--bg-card)] px-2 py-0.5 rounded-full">
                      {r.name}<span className="text-[var(--text-4)] ml-1">{r.ch}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="bg-[var(--bg-elevated)] rounded-xl p-3 mb-4 max-h-40 overflow-y-auto">
                <p className="text-[10px] text-[var(--text-4)] mb-1">실제 발송될 본문</p>
                {image && (
                  <div className="flex items-center gap-2 mb-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.dataUrl} alt={image.label} className="w-10 h-10 rounded-md object-cover" />
                    <span className="text-[11px] text-[var(--text-3)]">📷 {image.label} ({image.kb}KB) 이미지 첨부</span>
                  </div>
                )}
                <p className="text-[13px] text-[var(--text-2)] whitespace-pre-wrap break-words">{finalText}</p>
              </div>
              {isAd && (
                <p className="text-[11px] text-[var(--orange)] mb-3 leading-relaxed">
                  ⚠️ 광고 발송: 사전 수신동의를 받은 학부모에게만 보내야 합니다. 위반 시 정보통신망법 과태료(최대 3천만원)
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 py-3 rounded-xl bg-[var(--bg-elevated)] text-[var(--text-2)] font-semibold"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={submitting}
                  className={`flex-1 py-3 rounded-xl text-white font-bold disabled:opacity-50 ${isAd ? 'bg-[var(--orange)]' : 'bg-[var(--blue)]'}`}
                >
                  {submitting ? '발송 중...' : '발송'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
