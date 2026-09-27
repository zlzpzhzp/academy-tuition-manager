'use client'

// 학생 360 (이 앱 임베드판, 2026-08-20) — 원비 학생 한 명을 축으로 강사 앱(반·담당·진도)·질문·성적·상담을 모아 본다.
// 원본: 강사 앱 src/components/Student360Cards.tsx. 강사 앱은 "자기 반 학생만" 보이지만 이 앱은 전체 명단(퇴원 포함)이라
// 운영자님이 이 앱에서 바로 열 수 있게 해달라고 하신 게 계기(2026-08-19).
// 강사 앱 판과의 차이:
//   ① 스타일 — 강사 앱의 var(--bg-primary)/var(--accent) 토큰 대신 이 앱 토스다크 토큰(--bg-card/--border/--text-n/--blue).
//   ② 접힘 + 지연 로딩 — 모달이 무거워지지 않게 기본 접힘이고, 처음 펼칠 때만 fetch 한다(SWR key=null 로 보류).
//   ③ 신원 카드 축소 — 이름·학교·연락처·등록일은 호스트(모달/상세페이지)에 이미 있어 중복 생략,
//      이 앱에 없는 정보(담당 강사·강사 앱 반·수강 과목 전체)만 보여준다.
// 표시 전용 — 이 컴포넌트는 어떤 write 도 하지 않는다(모든 데이터는 GET /api/students/[id]/360 한 방).
import { useState } from 'react'
import useSWR from 'swr'
import { AnimatePresence } from 'framer-motion'
import { motion } from '@/components/paperMotion'
import {
  ChevronDown,
  ClipboardList,
  GraduationCap,
  MessageCircleQuestion,
  PhoneCall,
  User,
  UserPlus,
} from 'lucide-react'
import { TButton, SPRING_DEFAULT } from '@/components/motion'
import { swrFetcher } from '@/lib/utils'
import { formatKstDate, schoolExamLabel, type Student360Response } from '@/lib/student360'

const DM_STATUS_LABEL: Record<string, string> = { good: '양호', caution: '주의', warning: '경고' }

export default function Student360Section({
  studentId,
  defaultOpen = false,
}: {
  studentId: string
  /** 상세 페이지처럼 공간이 넉넉한 곳은 열어둘 수 있다. 모달은 기본 접힘(지연 로딩). */
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  // 지연 로딩: 펼치기 전엔 key=null 이라 요청 자체가 없다. 한 번 펼치면 SWR 캐시에 남아 재요청 없음.
  const { data, error, isLoading } = useSWR<Student360Response>(
    open ? `/api/students/${studentId}/360` : null,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 },
  )
  // 로딩 가드(전앱 룰): 데이터가 다 오기 전엔 '없음' 판정을 하지 않는다 — 스켈레톤만.
  const loading = open && (isLoading || (!data && !error))
  const s = data?.sections
  // 사람 단위 '반' 표기는 전 수강 반을 과목 접두로 병기한다 — "수학H·영어A" (2026-08-20 운영자님 지시).
  // enrollments = 이 사람의 원비 전 행(과목별 1행)이라 이게 사람 단위 정본. DB 값은 불변, 표시 자리 합성만.
  // 순서는 지시 예시("수학H 영어A")대로 수학 먼저
  const subjectOrder = (label: string) => (label.startsWith('수학') ? 0 : label.startsWith('영어') ? 1 : 2)
  const allClassLabel = s
    ? [...s.identity.enrollments]
        .map(e => `${e.subjectLabel}${e.status === '퇴원' ? '(퇴원)' : ''}`)
        .sort((a, b) => subjectOrder(a) - subjectOrder(b))
        .join('·') || s.identity.dmClassName || '-'
    : '-'
  // 강사 앱 자체 반(dm_classes)이 병기에 없는 별개 정보일 때만 보조로 남긴다
  const dmClassExtra = s?.identity.dmClassName && !allClassLabel.includes(s.identity.dmClassName)
    ? s.identity.dmClassName
    : null

  return (
    <div data-paper-card="" className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
      <TButton
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
        aria-expanded={open}
        aria-label="학생 360 열기"
      >
        <User className="w-4 h-4 text-[var(--blue)] shrink-0" />
        <span className="font-bold text-sm">학생 360</span>
        <span className="text-xs text-[var(--text-4)] truncate">강사 앱 · 질문 · 성적 · 상담 한눈에</span>
        <motion.span
          className="ml-auto shrink-0 text-[var(--text-4)]"
          animate={{ rotate: open ? 180 : 0 }}
          transition={SPRING_DEFAULT}
        >
          <ChevronDown className="w-4 h-4" />
        </motion.span>
      </TButton>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="border-t border-[var(--border)]">
              {loading && <Loading />}

              {!loading && error && (
                <div className="px-4 py-4 text-sm text-[var(--unpaid-text)]">
                  {error instanceof Error ? error.message : '불러오지 못했습니다'}
                </div>
              )}

              {!loading && s && (
                <>
                  {/* 1. 재적·수강 — 이 앱에 없는 정보(담당 강사·강사 앱 반·과목 전체)만 */}
                  <Fold
                    icon={<User className="w-4 h-4 text-[var(--blue)]" />}
                    title="재적·수강"
                    defaultOpen
                    note={s.identity.note}
                  >
                    <Row label="재적" value={`${s.identity.enrollmentStatus}${s.identity.withdrawalDate ? ` (${formatKstDate(s.identity.withdrawalDate)})` : ''}`} />
                    {s.identity.teacherName && <Row label="담당(강사 앱)" value={s.identity.teacherName} />}
                    <Row label="반" value={allClassLabel} />
                    {dmClassExtra && <Row label="반(강사 앱)" value={dmClassExtra} />}
                    {s.identity.dmStatus && (
                      <Row label="상태(강사 앱)" value={DM_STATUS_LABEL[s.identity.dmStatus] ?? s.identity.dmStatus} />
                    )}
                  </Fold>

                  {/* 2. 수업·진도 (강사 앱) */}
                  <Fold
                    icon={<GraduationCap className="w-4 h-4 text-[var(--blue)]" />}
                    title="수업·진도"
                    count={s.classes.progress.length}
                    badge={s.classes.progress.length > 0 ? <NameBadge /> : undefined}
                    defaultOpen
                    note={s.classes.note}
                  >
                    {(allClassLabel !== '-' || s.classes.className) && (
                      <Row
                        label="반"
                        // 병기 라벨이 정본. 요일(schedule)은 강사 앱 단일 반 것이라 1개 반일 때만 붙인다 — 2과목 학생에 오귀속 방지
                        value={`${allClassLabel !== '-' ? allClassLabel : s.classes.className}${
                          s.classes.schedule && s.identity.enrollments.length <= 1 ? ` · ${s.classes.schedule}` : ''
                        }`}
                      />
                    )}
                    {s.classes.progress.length === 0 ? (
                      <Empty>최근 진도 기록이 없습니다.</Empty>
                    ) : (
                      <div className="mt-1 space-y-2">
                        {s.classes.progress.map((p, i) => (
                          <div key={i} className="text-sm">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-[var(--text-1)] min-w-0">{p.items.join(', ') || '-'}</span>
                              <span className="shrink-0 text-xs text-[var(--text-3)] tabular-nums">
                                {formatKstDate(p.submittedAt)}
                              </span>
                            </div>
                            <div className="text-xs text-[var(--text-4)]">
                              {[p.className, p.subject].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Fold>

                  {/* 3. 성적 (학교 내신 + 학원 시험) */}
                  <Fold
                    icon={<ClipboardList className="w-4 h-4 text-[var(--blue)]" />}
                    title="성적"
                    count={s.grades.school.length + s.grades.academy.length}
                    note={s.grades.note}
                  >
                    {s.grades.school.length === 0 && s.grades.academy.length === 0 && (
                      <Empty>성적 기록이 없습니다.</Empty>
                    )}
                    {s.grades.school.length > 0 && (
                      <>
                        <SubLabel>학교 내신</SubLabel>
                        <div className="space-y-1">
                          {s.grades.school.map((g, i) => (
                            <div key={i} className="text-sm">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[var(--text-2)] truncate">
                                  {schoolExamLabel(g.year, g.semester, g.examType)}
                                </span>
                                <span className="shrink-0 font-bold">
                                  {g.score != null && g.score !== '' ? String(g.score) : '-'}
                                </span>
                              </div>
                              {g.notes && <div className="text-xs text-[var(--text-4)]">{g.notes}</div>}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {s.grades.academy.length > 0 && (
                      <>
                        <SubLabel className="mt-3">학원 시험</SubLabel>
                        <div className="space-y-1">
                          {s.grades.academy.map((g, i) => (
                            <div key={i} className="flex items-center justify-between gap-2 text-sm">
                              <span className="text-[var(--text-2)] truncate">
                                {[g.subject, g.examName].filter(Boolean).join(' · ') || '-'}
                              </span>
                              <span className="shrink-0 font-bold tabular-nums">
                                {g.score != null ? `${g.score}${g.total != null ? ` / ${g.total}` : ''}` : '-'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </Fold>

                  {/* 4. 질문 (이름 기반) */}
                  <Fold
                    icon={<MessageCircleQuestion className="w-4 h-4 text-[var(--blue)]" />}
                    title="질문 (최근 5건)"
                    count={s.qa.items.length}
                    badge={<NameBadge />}
                    note={s.qa.note}
                  >
                    {s.qa.items.length === 0 ? (
                      <Empty>질문 제출 기록이 없습니다.</Empty>
                    ) : (
                      <div className="space-y-2">
                        {s.qa.items.map(q => (
                          <div key={q.id} className="text-sm">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-[var(--text-1)] min-w-0 line-clamp-2">{q.content}</span>
                              <span className="shrink-0 text-xs text-[var(--text-3)] tabular-nums">
                                {formatKstDate(q.createdAt)}
                              </span>
                            </div>
                            {q.className && <div className="text-xs text-[var(--text-4)]">{q.className}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </Fold>

                  {/* 5. 신규 상담 (dm_consultations) */}
                  <Fold
                    icon={<UserPlus className="w-4 h-4 text-[var(--blue)]" />}
                    title="신규 상담"
                    count={s.consultations.items.length}
                    note={s.consultations.note}
                  >
                    {s.consultations.items.length === 0 ? (
                      <Empty>신규 상담 기록이 없습니다.</Empty>
                    ) : (
                      <div className="space-y-3">
                        {s.consultations.items.map((c, i) => (
                          <div key={i} className="text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-[var(--text-1)] truncate">
                                {[c.gradeLabel, c.school].filter(Boolean).join(' · ') || '상담'}
                                {c.status && (
                                  <span className="ml-1.5 text-xs font-medium text-[var(--text-4)]">{c.status}</span>
                                )}
                              </span>
                              {c.matchedBy === 'phone' && (
                                <span
                                  className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-[var(--scheduled-bg)] text-[var(--scheduled-text)]"
                                  title="tuition 직결이 아니라 이름+학부모번호 일치로 찾은 기록입니다"
                                >
                                  이름+번호 매칭
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[var(--text-4)]">
                              {[
                                c.firstVisitAt ? `첫방문 ${formatKstDate(c.firstVisitAt)}` : null,
                                c.enrolledAt ? `등원 ${formatKstDate(c.enrolledAt)}` : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                            {c.memo && (
                              <div className="mt-0.5 text-[13px] text-[var(--text-2)] whitespace-pre-wrap">{c.memo}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </Fold>

                  {/* 6. 전화·기타 상담 (student_call_logs + student_notes + memos 이름 기반) */}
                  <Fold
                    icon={<PhoneCall className="w-4 h-4 text-[var(--blue)]" />}
                    title="전화·기타 상담"
                    count={s.callLogs.notes.length + s.callLogs.memos.length}
                    badge={s.callLogs.memos.length > 0 ? <NameBadge /> : undefined}
                    note={s.callLogs.note}
                  >
                    {s.callLogs.notes.length === 0 && s.callLogs.memos.length === 0 && !s.callLogs.memosSkipped && (
                      <Empty>상담 기록이 없습니다.</Empty>
                    )}
                    {s.callLogs.notes.length > 0 && (
                      <div className="space-y-2">
                        {s.callLogs.notes.map((n, i) => (
                          <div key={i} className="text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-[var(--text-1)] truncate">
                                {n.title || n.category || '기록'}
                              </span>
                              <span className="shrink-0 text-xs text-[var(--text-3)] tabular-nums">
                                {formatKstDate(n.noteDate)}
                              </span>
                            </div>
                            {n.content && (
                              <div className="line-clamp-2 text-[13px] text-[var(--text-2)]">{n.content}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {s.callLogs.memos.length > 0 && (
                      <>
                        <SubLabel className="mt-3">통화·메모 기록</SubLabel>
                        <div className="space-y-2">
                          {s.callLogs.memos.map((m, i) => (
                            <div key={i} className="text-[13px]">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[var(--text-1)] truncate">
                                  {m.title || (m.memoType === 'voice' ? '음성 메모' : '메모')}
                                </span>
                                <span className="shrink-0 text-xs text-[var(--text-4)] tabular-nums">
                                  {formatKstDate(m.createdAt)}
                                </span>
                              </div>
                              <div className="line-clamp-2 text-[var(--text-2)]">{m.snippet}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </Fold>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 내부 접이식 섹션 — 헤더 탭으로 펼치고 접는다(펼침 애니메이션 포함). */
function Fold({
  icon,
  title,
  count,
  badge,
  note,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode
  title: string
  count?: number
  badge?: React.ReactNode
  note?: string | null
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <TButton
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="shrink-0">{icon}</span>
        <span className="text-sm font-medium text-[var(--text-1)]">{title}</span>
        {count != null && count > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--bg-elevated)] text-[var(--text-3)] tabular-nums">
            {count}
          </span>
        )}
        {badge}
        <motion.span
          className="ml-auto shrink-0 text-[var(--text-4)]"
          animate={{ rotate: open ? 180 : 0 }}
          transition={SPRING_DEFAULT}
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </motion.span>
      </TButton>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-4 pb-3">
              {note && <div className="mb-2 text-xs text-[var(--scheduled-text)]">{note}</div>}
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 이름 기반 매칭 경고 배지 — 동명이인·오타면 다른 학생 것일 수 있음을 고지 */
function NameBadge() {
  return (
    <span
      className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-[var(--scheduled-bg)] text-[var(--scheduled-text)]"
      title="이 데이터는 학생 이름 텍스트로 매칭됩니다 — 동명이인·오타면 다른 학생 것일 수 있습니다"
    >
      이름 기반
    </span>
  )
}

function Loading() {
  return (
    <div className="px-4 py-4 space-y-2">
      {[0, 1, 2].map(i => (
        <div key={i} className="flex items-center justify-between gap-3">
          <div className="skeleton-shimmer h-3.5 rounded" style={{ width: `${40 - i * 8}%` }} />
          <div className="skeleton-shimmer h-3.5 w-16 rounded" />
        </div>
      ))}
    </div>
  )
}

function SubLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[11px] font-semibold text-[var(--text-4)] mb-1 ${className ?? ''}`}>{children}</div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
      <span className="shrink-0 text-[var(--text-4)]">{label}</span>
      <span className="text-right min-w-0 truncate text-[var(--text-1)]">{value}</span>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-1 text-[13px] text-[var(--text-4)]">{children}</div>
}
