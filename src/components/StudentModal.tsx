'use client'

import { toast } from 'sonner'
import { useState, useEffect } from 'react'
import { useAnimatedClose } from '@/lib/useAnimatedClose'
import { X, Split } from 'lucide-react'
import type { Student, Grade, Class } from '@/types'
import { formatWon, formatNumber, formatClassName } from '@/lib/format'
import { getTodayString, formatPhone } from '@/lib/utils'
import { TButton } from '@/components/motion'
import AnimatedModal from '@/components/ui/AnimatedModal'

interface Props {
  student?: Student | null
  grades: (Grade & { classes: Class[] })[]
  defaultClassId?: string | null
  onSave: (data: Partial<Student>) => void | Promise<unknown>
  onClose: () => void
}

export default function StudentModal({ student, grades, defaultClassId, onSave, onClose: onCloseRaw }: Props) {
  // close 애니메이션 트리거 — 240ms exit 후 부모 onClose
  const { closing, onClose } = useAnimatedClose(onCloseRaw)

  const [name, setName] = useState(student?.name ?? '')
  const [school, setSchool] = useState(student?.school ?? '')
  const [classId, setClassId] = useState(student?.class_id ?? defaultClassId ?? '')
  const [phone, setPhone] = useState(formatPhone(student?.phone ?? ''))
  const [parentPhone, setParentPhone] = useState(formatPhone(student?.parent_phone ?? ''))           // 어머니
  const [fatherPhone, setFatherPhone] = useState(formatPhone(student?.parent_father_phone ?? ''))    // 아버지
  const [payssamRecipient, setPayssamRecipient] = useState<'mother' | 'father'>(student?.payssam_recipient === 'father' ? 'father' : 'mother')
  const [attendanceRecipient, setAttendanceRecipient] = useState<'mother' | 'father'>(student?.attendance_recipient === 'father' ? 'father' : 'mother')
  const [attendanceExtraPhone, setAttendanceExtraPhone] = useState(formatPhone(student?.attendance_extra_phone ?? ''))
  const [enrollmentDate, setEnrollmentDate] = useState(student?.enrollment_date ?? getTodayString())
  const [customFee, setCustomFee] = useState(student?.custom_fee != null ? String(student.custom_fee) : '')
  const [paymentDueDay, setPaymentDueDay] = useState(student?.payment_due_day != null ? String(student.payment_due_day) : '')
  const [memo, setMemo] = useState(student?.memo ?? '')
  const [splitParts, setSplitParts] = useState<number | null>(student?.split_billing_parts ?? null)
  const [splitAmounts, setSplitAmounts] = useState<number[] | null>(student?.split_billing_amounts ?? null)
  // 이 폼은 분할 설정을 '해제'만 할 수 있다 — 편집하지 않았는데 열 때 스냅샷을 되돌려 보내면
  // 모달이 열린 사이 서버가 저장한 분할 설정을 덮어쓴다. 해제를 눌렀을 때만 payload에 포함 (2026-08-13 라인리뷰)
  const [splitCleared, setSplitCleared] = useState(false)

  // 출결번호 — 학생번호 뒷4자리 자동, 중복이면 경고+수동 (2026-05-31). 서버 pickAttendanceCode와 동일 규칙(뒷4자리).
  const [attendanceCode, setAttendanceCode] = useState(student?.attendance_code ?? '')
  const [attendanceManual, setAttendanceManual] = useState(!!student?.attendance_code)
  const [takenCodes, setTakenCodes] = useState<Set<string>>(new Set())
  useEffect(() => {
    fetch('/api/students?active=true')
      .then(r => r.json())
      .then((rows: { id: string; attendance_code?: string | null }[]) => {
        const s = new Set<string>()
        for (const r of rows ?? []) {
          if (r.id === student?.id) continue
          if (r.attendance_code) s.add(r.attendance_code)
        }
        setTakenCodes(s)
      })
      // 실패를 삼키면 중복검사가 '중복 없음'으로 둔갑 — 수동 코드 중복은 서버 409가 최종 방어지만 표면화는 해준다 (2026-08-13 라인리뷰)
      .catch(() => toast.error('출결번호 중복검사 목록을 불러오지 못했습니다'))
  }, [student?.id])
  const autoCode = phone.replace(/\D/g, '').slice(-4)
  useEffect(() => {
    if (!attendanceManual) setAttendanceCode(autoCode)
  }, [autoCode, attendanceManual])
  const codeDuplicate = !!attendanceCode && takenCodes.has(attendanceCode)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return // 더블탭 → POST 2회 → 동일 학생 중복 생성 방지 (2026-07-10 전수점검)
    if (!name.trim()) return
    if (!student && !parentPhone.trim()) {
      toast.error('학부모 연락처는 필수입니다. 청구서 발송에 필요합니다.')
      return
    }
    if (codeDuplicate) {
      toast.error('출결번호가 중복됩니다. 다른 번호로 수정하세요.')
      return
    }
    const dueDayNum = paymentDueDay ? parseInt(paymentDueDay) : null
    const dueDay = dueDayNum != null && dueDayNum >= 1 && dueDayNum <= 31 ? dueDayNum : null
    setSaving(true)
    try {
      await onSave({
      name: name.trim(),
      school: school.trim() || null,
      class_id: classId || null,
      phone,
      parent_phone: parentPhone,
      parent_father_phone: fatherPhone,
      payssam_recipient: payssamRecipient,
      attendance_recipient: attendanceRecipient,
      attendance_extra_phone: attendanceExtraPhone || null,
      enrollment_date: enrollmentDate,
      custom_fee: customFee ? parseInt(customFee) : null,
      payment_due_day: dueDay,
      memo,
      attendance_code: attendanceCode || null,
      ...(splitCleared ? { split_billing_parts: null, split_billing_amounts: null } : {}),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatedModal open={!closing} onClose={onClose} variant="sheet" maxWidth="max-w-md">
      <div className="bg-[var(--bg-card)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-card)] z-10">
          <h2 className="text-lg font-bold tracking-tight">{student ? '학생 수정' : '학생 등록'}</h2>
          <TButton onClick={onClose} aria-label="닫기" className="p-1.5 text-[var(--text-4)] hover:text-[var(--text-3)] hover:bg-[var(--bg-elevated)] rounded-lg transition-colors"><X className="w-5 h-5" /></TButton>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-2)] mb-1">이름 *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-1)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-2)] mb-1">학교</label>
            <input
              type="text"
              value={school}
              onChange={e => setSchool(e.target.value)}
              placeholder="예: 한국고"
              className="w-full px-3 py-2 border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-1)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-2)] mb-1">반</label>
            <select
              value={classId}
              onChange={e => setClassId(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-1)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
            >
              <option value="">반 선택</option>
              {grades.map(g => (
                <optgroup key={g.id} label={g.name}>
                  {g.classes?.map(c => (
                    <option key={c.id} value={c.id}>
                      {formatClassName(c)} ({formatWon(c.monthly_fee)})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <label className="block text-sm font-medium text-[var(--text-2)] mb-1">첫 등원일 *</label>
              <input
                type="date"
                value={enrollmentDate}
                onChange={e => setEnrollmentDate(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-1)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                required
              />
            </div>
            <div className="w-[96px]">
              <label className="block text-sm font-medium text-[var(--text-2)] mb-1">결제일</label>
              <input
                type="number"
                min={1}
                max={31}
                value={paymentDueDay}
                onChange={e => setPaymentDueDay(e.target.value)}
                placeholder="등원일"
                className="w-full px-3 py-2 border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-1)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              />
            </div>
          </div>

          {(() => {
            // Streaming inline validation — 입력 즉시 010-XXXX-XXXX 형식 검증
            const phoneRegex = /^01[016789]-?\d{3,4}-?\d{4}$/
            const isInvalid = (v: string) => { const c = v.replace(/-/g, ''); return !!v && c.length >= 10 && !phoneRegex.test(v) }
            const phoneInvalid = isInvalid(phone)
            const parentInvalid = isInvalid(parentPhone)
            const fatherInvalid = isInvalid(fatherPhone)
            const extraInvalid = isInvalid(attendanceExtraPhone)
            const fieldCls = (bad: boolean) => `w-full px-3 py-2 border bg-[var(--bg-card)] text-[var(--text-1)] rounded-lg text-sm focus:outline-none focus:ring-2 transition-colors ${bad ? 'border-[var(--red)] focus:ring-[var(--red)]' : 'border-[var(--border)] focus:ring-[var(--blue)]'}`
            return (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-2)] mb-1">학생 연락처</label>
                  <input
                    type="tel" inputMode="numeric"
                    value={phone}
                    onChange={e => setPhone(formatPhone(e.target.value))}
                    placeholder="010-0000-0000"
                    aria-invalid={phoneInvalid}
                    className={fieldCls(phoneInvalid)}
                  />
                  {phoneInvalid && <p className="text-[10px] text-[var(--unpaid-text)] mt-0.5">올바른 형식이 아닙니다</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-2)] mb-1">
                    출결번호 {!attendanceManual && <span className="text-[10px] font-normal text-[var(--text-4)]">(학생 연락처 뒷4자리 자동)</span>}
                  </label>
                  <input
                    type="text" inputMode="numeric" maxLength={6}
                    value={attendanceCode}
                    onChange={e => { setAttendanceCode(e.target.value.replace(/\D/g, '')); setAttendanceManual(true) }}
                    placeholder="학생 연락처 입력 시 자동 생성"
                    aria-invalid={codeDuplicate}
                    className={fieldCls(codeDuplicate)}
                  />
                  {codeDuplicate && <p className="text-[10px] text-[var(--unpaid-text)] mt-0.5">이미 사용 중인 출결번호입니다. 다른 번호로 수정하세요.</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-2)] mb-1">어머니 번호{!student && ' *'}</label>
                    <input
                      type="tel" inputMode="numeric"
                      value={parentPhone}
                      onChange={e => setParentPhone(formatPhone(e.target.value))}
                      placeholder="010-0000-0000"
                      required={!student}
                      aria-invalid={parentInvalid}
                      className={fieldCls(parentInvalid)}
                    />
                    {parentInvalid && <p className="text-[10px] text-[var(--unpaid-text)] mt-0.5">올바른 형식이 아닙니다</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-2)] mb-1">아버지 번호</label>
                    <input
                      type="tel" inputMode="numeric"
                      value={fatherPhone}
                      onChange={e => setFatherPhone(formatPhone(e.target.value))}
                      placeholder="010-0000-0000"
                      aria-invalid={fatherInvalid}
                      className={fieldCls(fatherInvalid)}
                    />
                    {fatherInvalid && <p className="text-[10px] text-[var(--unpaid-text)] mt-0.5">올바른 형식이 아닙니다</p>}
                  </div>
                </div>
                {/* 결제선생 / 출결 발송 수신자 (어머니/아버지). 기본 어머니 */}
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { label: '결제선생 발송', val: payssamRecipient, set: setPayssamRecipient },
                    { label: '출결 알림 발송', val: attendanceRecipient, set: setAttendanceRecipient },
                  ] as const).map(({ label, val, set }) => (
                    <div key={label}>
                      <label className="block text-sm font-medium text-[var(--text-2)] mb-1">{label}</label>
                      <div className="flex gap-1 p-0.5 bg-[var(--bg-elevated)] rounded-lg">
                        {(['mother', 'father'] as const).map(r => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => set(r)}
                            className={`flex-1 py-1.5 rounded-md text-[12px] font-semibold transition-colors ${val === r ? 'bg-[var(--blue)] text-[var(--on-action)]' : 'text-[var(--text-3)] hover:text-[var(--text-1)]'}`}
                          >
                            {r === 'mother' ? '어머니' : '아버지'}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <label htmlFor="attendance-extra-phone" className="block text-sm font-medium text-[var(--text-2)] mb-1">추가 수신 번호(선택)</label>
                  <input
                    id="attendance-extra-phone"
                    type="tel" inputMode="numeric"
                    value={attendanceExtraPhone}
                    onChange={e => setAttendanceExtraPhone(formatPhone(e.target.value))}
                    placeholder="010-0000-0000"
                    aria-invalid={extraInvalid}
                    aria-describedby="attendance-extra-phone-help"
                    className={fieldCls(extraInvalid)}
                  />
                  {extraInvalid && <p className="text-[10px] text-[var(--unpaid-text)] mt-0.5">올바른 형식이 아닙니다</p>}
                  <p id="attendance-extra-phone-help" className="text-[10px] text-[var(--text-4)] mt-1">등하원 알림을 이 번호에도 함께 보냅니다</p>
                </div>
              </div>
            )
          })()}

          <div>
            <label className="block text-sm font-medium text-[var(--text-2)] mb-1">
              개별 원비 <span className="text-[var(--text-4)] font-normal">(비워두면 반 기본 원비 적용)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={customFee}
                onChange={e => setCustomFee(e.target.value)}
                placeholder="반 기본 원비 사용"
                className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              />
              <span className="text-sm text-[var(--text-4)]">원</span>
            </div>
          </div>

          {splitParts && splitAmounts && splitAmounts.length === splitParts && (
            <div className="flex items-start gap-2 p-3 bg-[var(--blue-dim)] rounded-lg">
              <Split className="w-4 h-4 text-[var(--blue)] shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[var(--blue)]">분할결제 설정됨</p>
                <p className="text-xs text-[var(--text-3)] mt-0.5 break-words">
                  {splitAmounts.map(a => formatNumber(a)).join(' + ')} = {formatWon(splitAmounts.reduce((s, a) => s + a, 0))} ({splitParts}회 분할)
                </p>
              </div>
              <TButton
                type="button"
                onClick={() => { setSplitParts(null); setSplitAmounts(null); setSplitCleared(true) }}
                className="shrink-0 px-2 py-1 rounded-md text-xs font-semibold bg-[var(--red-dim)] text-[var(--red)] hover:opacity-80"
              >
                해제
              </TButton>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-[var(--text-2)] mb-1">메모</label>
            <textarea
              value={memo}
              onChange={e => setMemo(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)] resize-none"
            />
          </div>

          <TButton
            type="submit"
            disabled={codeDuplicate || saving}
            className="w-full py-2.5 bg-[var(--blue)] text-[var(--on-action)] rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {codeDuplicate ? '출결번호 중복 — 수정 필요' : saving ? '저장 중…' : student ? '수정' : '등록'}
          </TButton>
        </form>
      </div>
    </AnimatedModal>
  )
}
