'use client'

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import { useAnimatedClose } from '@/lib/useAnimatedClose'
import { createPortal } from 'react-dom'
import { AnimatePresence } from 'framer-motion'
import { motion } from '@/components/paperMotion'
import { X, Send, AlertTriangle, Check, Loader2, Search, PhoneOff, ChevronDown } from 'lucide-react'
import { TButton } from '@/components/motion'
import EmptyState from '@/components/ui/EmptyState'
import AnimatedModal from '@/components/ui/AnimatedModal'
import type { Student, GradeWithClasses } from '@/types'
import { formatWon, formatNumber, formatClassName } from '@/lib/format'
import { formatMonth } from '@/lib/utils'
import { defaultBillProductName, defaultBillMessage } from '@/lib/billing-title'
import { getStudentFee } from '@/types'
import { getRegularTuitionTitle, REGULAR_TUITION_MESSAGE } from '@/lib/billing-title'
import { billingPhone } from '@/lib/student-codes'
import { ACADEMY_NAME } from '@/lib/branding'

type ClassWithStudents = GradeWithClasses['classes'][number]
type StudentWithClass = Student & { class: ClassWithStudents }

interface Props {
  students: StudentWithClass[]
  grades: GradeWithClasses[]
  billingMonth: string
  onClose: () => void
  onSuccess?: () => void
}

type SendState = 'form' | 'confirming' | 'sending' | 'success' | 'scheduled' | 'error'

export default function QuickBillSendModal({ students, grades, billingMonth, onClose: onCloseRaw, onSuccess }: Props) {
  const { closing, onClose } = useAnimatedClose(onCloseRaw)
  const [mounted, setMounted] = useState(false)
  const [state, setState] = useState<SendState>('form')
  const [errorMsg, setErrorMsg] = useState('')
  const [scheduledKst, setScheduledKst] = useState('')

  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [amountStr, setAmountStr] = useState('')
  const [billNote, setBillNote] = useState('')
  const [isRegular, setIsRegular] = useState(true)
  const [title, setTitle] = useState('')
  const [messageContent, setMessageContent] = useState('')
  const [browseSubject, setBrowseSubject] = useState<string | null>(null)
  const [browseGradeName, setBrowseGradeName] = useState<string | null>(null)
  const [browseClassName, setBrowseClassName] = useState<string | null>(null)
  const [openPicker, setOpenPicker] = useState<'subject' | 'grade' | 'class' | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const subjectRef = useRef<HTMLButtonElement>(null)
  const gradeRef = useRef<HTMLButtonElement>(null)
  const classRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { if (mounted) setTimeout(() => searchRef.current?.focus(), 150) }, [mounted])

  const selected = useMemo(() => students.find(s => s.id === selectedId) ?? null, [students, selectedId])

  // 학생 선택이 "바뀔 때만" 기본 금액 세팅 — amountStr을 deps에 두면 사용자가 금액을
  // 지울 때마다 즉시 기본값으로 되채워져 금액 수정이 불가능했음 (2026-07-10 전수점검 C10)
  const prevSelectedIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (selected && prevSelectedIdRef.current !== selected.id) {
      prevSelectedIdRef.current = selected.id
      setAmountStr(String(getStudentFee(selected, selected.class)))
    }
    if (!selected) prevSelectedIdRef.current = null
  }, [selected])

  // 정규/비정규 · 학생 변경 시 제목/내용 기본값 자동 세팅 (사용자 편집 전까지)
  const autoTitle = useMemo(() => {
    if (!selected) return ''
    if (isRegular) return getRegularTuitionTitle(selected.class?.subject ?? null, billingMonth, selected.class?.name ?? null, selected.electives)
    return ''
  }, [selected, isRegular, billingMonth])
  const autoMessage = isRegular ? REGULAR_TUITION_MESSAGE : ''

  // 어머니 번호만 보면 '아버님 수신' 학생의 청구서가 어머니(또는 학생 본인)에게 간다.
  // billingPhone 이 payssam_recipient 를 존중하는 단일 판정 (2026-08-11 백종원 실측).
  const phone = selected ? billingPhone(selected) : ''
  const cleanPhone = phone.replace(/-/g, '')
  const isPhoneValid = /^01[016789]\d{7,8}$/.test(cleanPhone)
  const amount = parseInt(amountStr.replace(/[^\d]/g, '') || '0', 10)
  const isAmountValid = amount > 0

  const filtered = useMemo(() => {
    if (!query.trim()) return students.slice(0, 30)
    const q = query.trim().toLowerCase()
    return students
      // formatClassName('수학H')은 반 이름·과목명을 모두 포함하므로 '수학'/'H'/'수학H' 어느 쪽으로도 검색됨
      .filter(s => s.name.toLowerCase().includes(q) || formatClassName(s.class).toLowerCase().includes(q))
      .slice(0, 30)
  }, [students, query])

  // 계층 네비게이션: 과목 → 학년 → 반 → 학생
  const activeIds = useMemo(() => new Set(students.map(s => s.id)), [students])

  const subjectList = useMemo(() => {
    const set = new Set<string>()
    for (const g of grades) {
      for (const c of g.classes) {
        if (c.subject && c.students?.some(s => activeIds.has(s.id))) set.add(c.subject)
      }
    }
    return Array.from(set).sort((a, b) => (a === '수학' ? -1 : b === '수학' ? 1 : a.localeCompare(b)))
  }, [grades, activeIds])

  const gradeList = useMemo(() => {
    if (!browseSubject) return []
    return grades.filter(g =>
      g.classes.some(c => c.subject === browseSubject && c.students?.some(s => activeIds.has(s.id)))
    )
  }, [grades, browseSubject, activeIds])

  const classList = useMemo(() => {
    if (!browseSubject || !browseGradeName) return []
    const g = grades.find(x => x.name === browseGradeName)
    if (!g) return []
    return g.classes
      .filter(c => c.subject === browseSubject && c.students?.some(s => activeIds.has(s.id)))
  }, [grades, browseSubject, browseGradeName, activeIds])

  const classStudents = useMemo<StudentWithClass[]>(() => {
    if (!browseClassName) return []
    // 이름 매칭이지만 classList가 이미 browseSubject+browseGradeName으로 좁혀져 있어 유일
    // (같은 과목·학년 내 반 이름 중복은 DB 유니크 인덱스로 금지 — 과목 없는 이름 단독 매칭 아님)
    const cls = classList.find(c => c.name === browseClassName)
    if (!cls) return []
    return (cls.students ?? [])
      .filter(s => activeIds.has(s.id))
      .map(s => students.find(x => x.id === s.id))
      .filter((s): s is StudentWithClass => !!s)
  }, [classList, browseClassName, activeIds, students])

  // ESC 닫기는 AnimatedModal(모달 스택 top 판정 + onClose의 sending 가드)이 담당 (2026-07-10 C4)

  const handleSend = useCallback(async () => {
    if (state === 'sending' || state === 'success' || !selected) return

    if (state !== 'confirming') {
      setState('confirming')
      return
    }

    setState('sending')
    setErrorMsg('')

    try {
      const finalTitle = title.trim() || autoTitle || defaultBillProductName(billingMonth)
      const finalMessage = messageContent.trim() || autoMessage || defaultBillMessage(selected.name, billingMonth)
      const res = await fetch('/api/payssam/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: selected.id,
          studentName: selected.name,
          phone: cleanPhone,
          amount,
          productName: finalTitle,
          message: finalMessage,
          billingMonth,
          isRegularTuition: isRegular,
          billNote: billNote || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok && data.code === 'SCHEDULED') {
        setScheduledKst(data.scheduled_at_kst || '')
        setState('scheduled')
        setTimeout(() => {
          onSuccess?.()
          onClose()
        }, 3500)
        return
      }
      if (!res.ok || data.code !== '0000') {
        setErrorMsg(data.msg || data.error || '청구서 발송에 실패했습니다')
        setState('error')
        return
      }
      setState('success')
      setTimeout(() => {
        onSuccess?.()
        onClose()
      }, 1800)
    } catch {
      setErrorMsg('네트워크 오류가 발생했습니다')
      setState('error')
    }
  }, [state, selected, cleanPhone, amount, billingMonth, isRegular, billNote, title, messageContent, autoTitle, autoMessage, onClose, onSuccess])


  const readyToSend = selected && isPhoneValid && isAmountValid

  return (
    <AnimatedModal
      open={!closing}
      onClose={() => { if (state !== 'sending') onClose() }}
      closeOnBackdrop={state !== 'sending'}
      maxWidth="max-w-md"
    >
      <div data-paper-card="" className="bg-[var(--bg-card)] rounded-2xl max-h-[88vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-card)] z-10 rounded-t-[inherit]">
          <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
            <Send className="w-4 h-4 text-[var(--blue)]" />
            청구서 발송
            <span className="text-xs font-normal text-[var(--text-4)]">{formatMonth(billingMonth)}</span>
          </h2>
          <TButton
            onClick={() => { if (state !== 'sending') onClose() }}
            className="p-1.5 text-[var(--text-4)] hover:text-[var(--text-3)] hover:bg-[var(--bg-elevated)] rounded-lg transition-colors"
            disabled={state === 'sending'}
          >
            <X className="w-4 h-4" />
          </TButton>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {state === 'success' ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <motion.div
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="w-16 h-16 rounded-full bg-[var(--green-dim)] flex items-center justify-center"
              >
                <Check className="w-8 h-8 text-[var(--paid-text)]" />
              </motion.div>
              <p className="text-base font-bold text-[var(--paid-text)]">청구서가 발송되었습니다</p>
              <p className="text-xs text-[var(--text-4)]">{selected?.name} · {formatWon(amount)}</p>
            </div>
          ) : state === 'scheduled' ? (
            <div className="flex flex-col items-center gap-3 py-10 px-4 text-center">
              <motion.div
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="w-16 h-16 rounded-full bg-[var(--orange-dim)] flex items-center justify-center"
              >
                <Check className="w-8 h-8 text-[var(--scheduled-text)]" />
              </motion.div>
              <p className="text-base font-bold text-[var(--scheduled-text)]">예약 발송 등록됨</p>
              <p className="text-xs text-[var(--text-3)]">
                영업시간 외 요청이라<br/>
                <strong>{scheduledKst} KST</strong>에 자동 발송됩니다.
              </p>
              <p className="text-[11px] text-[var(--text-4)]">업무시간: 평일 11:00~22:00 · 토 11:00~20:00</p>
            </div>
          ) : (
            <>
              {/* 1. 학생 선택 */}
              {!selected ? (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">학생 선택</label>

                  {/* 검색 */}
                  <div className="relative">
                    <Search className="w-4 h-4 text-[var(--text-4)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      ref={searchRef}
                      type="text"
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="이름 또는 반으로 검색..."
                      className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg-elevated)] rounded-xl text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-1 focus:ring-[var(--blue)]"
                    />
                  </div>
                  <AnimatePresence initial={false}>
                    {query.trim() && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="max-h-48 overflow-y-auto rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
                          {filtered.length === 0 ? (
                            <EmptyState title="일치하는 학생이 없습니다" size="compact" />
                          ) : filtered.map(s => {
                            const p = billingPhone(s)
                            const fee = getStudentFee(s, s.class)
                            return (
                              <TButton
                                key={s.id}
                                onClick={() => setSelectedId(s.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-card-hover)] text-left transition-colors"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-sm font-semibold truncate">{s.name}</span>
                                    {!p && <PhoneOff className="w-3 h-3 text-[var(--red)]" />}
                                  </div>
                                  <div className="text-[10px] text-[var(--text-4)] truncate">{formatClassName(s.class)}</div>
                                </div>
                                <span className="text-[11px] tabular-nums text-[var(--text-3)]">{formatWon(fee)}</span>
                              </TButton>
                            )
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* 한 행에 과목/학년/반 선택 */}
                  <div className="flex items-center gap-2">
                    <PillPicker
                      ref={subjectRef}
                      placeholder="과목"
                      value={browseSubject}
                      open={openPicker === 'subject'}
                      onToggle={() => setOpenPicker(openPicker === 'subject' ? null : 'subject')}
                    />
                    <PillPicker
                      ref={gradeRef}
                      placeholder="학년"
                      value={browseGradeName}
                      disabled={!browseSubject}
                      open={openPicker === 'grade'}
                      onToggle={() => setOpenPicker(openPicker === 'grade' ? null : 'grade')}
                    />
                    <PillPicker
                      ref={classRef}
                      placeholder="반"
                      value={browseClassName}
                      disabled={!browseGradeName}
                      open={openPicker === 'class'}
                      onToggle={() => setOpenPicker(openPicker === 'class' ? null : 'class')}
                    />
                  </div>

                  {/* 포탈 팝오버 (납부탭 날짜 필터 스타일) */}
                  <AnimatePresence>
                  {openPicker === 'subject' && (
                    <PickerPopover key="picker-subject" anchorRef={subjectRef} onClose={() => setOpenPicker(null)}>
                      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                        {subjectList.length === 0 ? (
                          <EmptyState title="학생이 없습니다" size="compact" />
                        ) : subjectList.map(s => (
                          <TButton
                            key={s}
                            onClick={() => {
                              if (browseSubject !== s) { setBrowseGradeName(null); setBrowseClassName(null) }
                              setBrowseSubject(s)
                              setOpenPicker('grade')
                            }}
                            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                              browseSubject === s
                                ? 'bg-[var(--blue)]/15 text-[var(--blue)]'
                                : 'text-[var(--text-1)] hover:bg-[var(--bg-elevated)]'
                            }`}
                          >{s}</TButton>
                        ))}
                      </div>
                    </PickerPopover>
                  )}
                  </AnimatePresence>
                  <AnimatePresence>
                  {openPicker === 'grade' && (
                    <PickerPopover key="picker-grade" anchorRef={gradeRef} onClose={() => setOpenPicker(null)}>
                      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                        {gradeList.length === 0 ? (
                          <div className="p-3 text-center text-xs text-[var(--text-4)]">학년 없음</div>
                        ) : gradeList.map(g => (
                          <TButton
                            key={g.id}
                            onClick={() => {
                              if (browseGradeName !== g.name) setBrowseClassName(null)
                              setBrowseGradeName(g.name)
                              setOpenPicker('class')
                            }}
                            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                              browseGradeName === g.name
                                ? 'bg-[var(--blue)]/15 text-[var(--blue)]'
                                : 'text-[var(--text-1)] hover:bg-[var(--bg-elevated)]'
                            }`}
                          >{g.name}</TButton>
                        ))}
                      </div>
                    </PickerPopover>
                  )}
                  </AnimatePresence>
                  <AnimatePresence>
                  {openPicker === 'class' && (
                    <PickerPopover key="picker-class" anchorRef={classRef} onClose={() => setOpenPicker(null)}>
                      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                        {classList.length === 0 ? (
                          <div className="p-3 text-center text-xs text-[var(--text-4)]">반 없음</div>
                        ) : classList.map(c => (
                          <TButton
                            key={c.id}
                            onClick={() => {
                              setBrowseClassName(c.name)
                              setOpenPicker(null)
                            }}
                            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                              browseClassName === c.name
                                ? 'bg-[var(--blue)]/15 text-[var(--blue)]'
                                : 'text-[var(--text-1)] hover:bg-[var(--bg-elevated)]'
                            }`}
                          >{c.name}</TButton>
                        ))}
                      </div>
                    </PickerPopover>
                  )}
                  </AnimatePresence>

                  {/* 반 선택 완료 → 학생 리스트 드롭다운 */}
                  <AnimatePresence initial={false}>
                    {browseClassName && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="max-h-60 overflow-y-auto rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
                          {classStudents.length === 0 ? (
                            <EmptyState title="학생이 없습니다" size="compact" />
                          ) : classStudents.map(s => {
                            const p = billingPhone(s)
                            const fee = getStudentFee(s, s.class)
                            return (
                              <TButton
                                key={s.id}
                                onClick={() => setSelectedId(s.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-card-hover)] text-left transition-colors"
                              >
                                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                                  <span className="text-sm font-semibold truncate">{s.name}</span>
                                  {!p && <PhoneOff className="w-3 h-3 text-[var(--red)]" />}
                                </div>
                                <span className="text-[11px] tabular-nums text-[var(--text-3)]">{formatWon(fee)}</span>
                              </TButton>
                            )
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                <>
                  {/* 선택된 학생 배너 */}
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[var(--bg-elevated)]">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-[var(--blue)]/20 text-[var(--blue)] flex items-center justify-center text-xs font-bold">
                        {selected.name[0]}
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{selected.name}</div>
                        <div className="text-[10px] text-[var(--text-4)]">{formatClassName(selected.class)}</div>
                      </div>
                    </div>
                    <TButton
                      onClick={() => { setSelectedId(null); setAmountStr(''); setBillNote(''); setIsRegular(true); setTitle(''); setMessageContent('') }}
                      disabled={state !== 'form'}
                      className="text-xs text-[var(--text-4)] hover:text-[var(--text-3)] px-2 py-1 rounded-lg hover:bg-[var(--bg-card-hover)] disabled:opacity-40"
                    >
                      변경
                    </TButton>
                  </div>

                  {/* 전화번호 경고 */}
                  {!isPhoneValid && (
                    <div className="flex items-start gap-2 p-3 bg-[var(--red-dim)] rounded-xl">
                      <AlertTriangle className="w-4 h-4 text-[var(--red)] shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-[var(--red)]">전화번호 오류</p>
                        <p className="text-xs text-[var(--text-3)] mt-0.5">
                          {phone ? `"${phone}"은 유효한 전화번호가 아닙니다` : '학부모 전화번호가 등록되어 있지 않습니다'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 금액 */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">청구 금액</label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={amount > 0 ? formatNumber(amount) : amountStr}
                        onChange={e => setAmountStr(e.target.value.replace(/[^\d]/g, ''))}
                        disabled={state !== 'form'}
                        className="w-full pl-3 pr-10 py-2.5 bg-[var(--bg-elevated)] rounded-xl text-base font-bold tabular-nums text-[var(--text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--blue)] disabled:opacity-60"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-4)]">원</span>
                    </div>
                  </div>

                  {/* 정규/비정규 토글 */}
                  <div className="flex items-center gap-2">
                    <TButton
                      onClick={() => setIsRegular(true)}
                      disabled={state !== 'form'}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors disabled:opacity-60 ${
                        isRegular
                          ? 'bg-[var(--blue)]/15 text-[var(--blue)] ring-1 ring-[var(--blue)]/40'
                          : 'bg-[var(--bg-elevated)] text-[var(--text-4)]'
                      }`}
                    >
                      정규 수업료
                    </TButton>
                    <TButton
                      onClick={() => setIsRegular(false)}
                      disabled={state !== 'form'}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors disabled:opacity-60 ${
                        !isRegular
                          ? 'bg-[var(--orange)]/15 text-[var(--scheduled-text)] ring-1 ring-[var(--orange)]/40'
                          : 'bg-[var(--bg-elevated)] text-[var(--text-4)]'
                      }`}
                    >
                      비정규 (보충/분할)
                    </TButton>
                  </div>

                  {/* 제목 (카톡 알림톡 상품명) */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">
                      제목
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={e => setTitle(e.target.value.slice(0, 60))}
                      disabled={state !== 'form'}
                      placeholder={autoTitle || (isRegular ? `예: ${ACADEMY_NAME} 수학 4월 정규원비` : '예: 4월 보충비')}
                      className="w-full px-3 py-2 bg-[var(--bg-elevated)] rounded-xl text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-1 focus:ring-[var(--blue)] disabled:opacity-60"
                    />
                  </div>

                  {/* 내용 (카톡 알림톡 메시지) */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">
                      내용
                    </label>
                    <textarea
                      value={messageContent}
                      onChange={e => setMessageContent(e.target.value.slice(0, 200))}
                      disabled={state !== 'form'}
                      rows={2}
                      placeholder={autoMessage || `예: 안녕하세요. ${ACADEMY_NAME} 결제링크입니다. 감사합니다😁`}
                      className="w-full px-3 py-2 bg-[var(--bg-elevated)] rounded-xl text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-1 focus:ring-[var(--blue)] disabled:opacity-60 resize-none"
                    />
                  </div>

                  {/* 비고 */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">
                      비고 <span className="text-[var(--text-4)] font-normal">(선택)</span>
                    </label>
                    <input
                      type="text"
                      value={billNote}
                      onChange={e => setBillNote(e.target.value.slice(0, 40))}
                      disabled={state !== 'form'}
                      placeholder={isRegular ? '예: 특강비 포함' : '예: 3월 분할결제 2/3회차'}
                      className="w-full px-3 py-2 bg-[var(--bg-elevated)] rounded-xl text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-1 focus:ring-[var(--blue)] disabled:opacity-60"
                    />
                  </div>

                  {/* 확인 경고 */}
                  <AnimatePresence>
                    {state === 'confirming' && (
                      <motion.div
                        initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
                        className="flex items-start gap-2 p-3 bg-[var(--orange-dim)] rounded-xl"
                      >
                        <AlertTriangle className="w-4 h-4 text-[var(--scheduled-text)] shrink-0 mt-0.5" />
                        <p className="text-sm text-[var(--scheduled-text)]">
                          <strong>{selected.name}</strong>님에게 <strong>{formatWon(amount)}</strong> 청구서를 발송합니다. 확인하시겠습니까?
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* 에러 */}
                  {state === 'error' && (
                    <div className="flex items-start gap-2 p-3 bg-[var(--red-dim)] rounded-xl">
                      <AlertTriangle className="w-4 h-4 text-[var(--red)] shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-[var(--red)]">발송 실패</p>
                        <p className="text-xs text-[var(--text-3)] mt-0.5">{errorMsg}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* 하단 액션 */}
        {state !== 'success' && state !== 'scheduled' && selected && (
          <div className="px-5 py-4 border-t border-[var(--border)] flex gap-2">
            {state === 'confirming' && (
              <TButton
                onClick={() => setState('form')}
                className="flex-1 py-3 rounded-xl text-sm font-semibold bg-[var(--bg-elevated)] text-[var(--text-3)] hover:bg-[var(--border-light)] transition-colors"
              >
                취소
              </TButton>
            )}
            <TButton
              onClick={handleSend}
              disabled={!readyToSend || state === 'sending'}
              className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                state === 'confirming'
                  ? 'bg-[var(--orange)] text-[var(--on-action)] hover:opacity-90'
                  : state === 'sending'
                    ? 'bg-[var(--blue)] text-[var(--on-action)] opacity-70 cursor-not-allowed'
                    : state === 'error'
                      ? 'bg-[var(--blue)] text-[var(--on-action)] hover:opacity-90'
                      : 'bg-[var(--blue)] text-[var(--on-action)] hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed'
              }`}
            >
              {state === 'sending' ? (
                <><Loader2 className="w-4 h-4 animate-spin" />발송 중...</>
              ) : state === 'confirming' ? (
                '확인, 발송합니다'
              ) : state === 'error' ? (
                '다시 시도'
              ) : (
                <><Send className="w-4 h-4" />청구서 발송</>
              )}
            </TButton>
          </div>
        )}
      </div>
    </AnimatedModal>
  )
}

interface PillPickerProps {
  placeholder: string
  value: string | null
  disabled?: boolean
  open: boolean
  onToggle: () => void
  ref?: React.Ref<HTMLButtonElement>
}

function PillPicker({ placeholder, value, disabled, open, onToggle, ref }: PillPickerProps) {
  return (
    <TButton
      ref={ref}
      type="button"
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      className={`flex-1 flex items-center justify-between gap-1 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
        disabled
          ? 'bg-[var(--bg-elevated)] text-[var(--text-4)] opacity-50 cursor-not-allowed'
          : value
            ? 'bg-[var(--blue)]/15 text-[var(--blue)] ring-1 ring-[var(--blue)]/40'
            : open
              ? 'bg-[var(--bg-card)] text-[var(--text-1)] ring-1 ring-[var(--border)]'
              : 'bg-[var(--bg-elevated)] text-[var(--text-3)] hover:bg-[var(--bg-card-hover)]'
      }`}
    >
      <span className="truncate">{value || placeholder}</span>
      <ChevronDown
        className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${open && !disabled ? 'rotate-180' : ''}`}
      />
    </TButton>
  )
}

interface PickerPopoverProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
  children: React.ReactNode
}

function PickerPopover({ anchorRef, onClose, children }: PickerPopoverProps) {
  const positionRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    let frame: number | null = null
    let disposed = false
    const update = () => {
      frame = null
      const el = anchorRef.current
      const position = positionRef.current
      if (!el || !position) return
      const rect = el.getBoundingClientRect()
      // 진입 모션의 transform과 위치 추적의 transform은 서로 다른 요소가 소유한다.
      position.style.transform = `translate3d(${rect.left}px, ${rect.bottom + 6}px, 0)`
      position.style.width = `${rect.width}px`
      position.style.visibility = 'visible'
    }
    const schedule = () => {
      if (!disposed && frame === null) frame = requestAnimationFrame(update)
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    if (anchorRef.current) observer?.observe(anchorRef.current)
    document.fonts?.ready.then(schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    return () => {
      disposed = true
      if (frame !== null) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [anchorRef])

  return createPortal(
    <div data-picker-portal>
      <div className="fixed inset-0 z-[70]" onClick={onClose} />
      <div ref={positionRef} className="fixed top-0 left-0 z-[71]" style={{ visibility: 'hidden' }}>
      <motion.div data-paper-card=""
        initial={{ opacity: 0, y: -4, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.98 }}
        transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xl p-2"
      >
        {children}
      </motion.div>
      </div>
    </div>,
    document.body
  )
}
