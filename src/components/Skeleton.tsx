'use client'

import { motion } from '@/components/paperMotion'

// ⚠️ 스켈레톤은 initial=false 필수 — motion initial opacity:0은 SSR HTML에 인라인으로 박혀
// 하이드레이션 전까지 다크 빈 화면이 됨 (2026-07-10 전수점검 C11)

function Shimmer({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`skeleton-shimmer rounded-xl ${className ?? ''}`}
      style={style}
    />
  )
}

export function DashboardSkeleton() {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
      className="space-y-5"
    >
      <div>
        <Shimmer className="h-4 w-40 mb-2" />
        <Shimmer className="h-8 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map(i => (
          <motion.div
            key={i}
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.3 }}
            className="card p-5 space-y-3"
          >
            <div className="flex items-center gap-1.5">
              <Shimmer className="w-4 h-4 rounded-full" />
              <Shimmer className="h-3 w-12" />
            </div>
            <Shimmer className="h-8 w-16" />
          </motion.div>
        ))}
      </div>
      <div className="card p-5 space-y-3">
        <Shimmer className="h-5 w-24" />
        {[0, 1, 2].map(i => (
          <div key={i} className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <Shimmer className="h-4 w-14" />
              <Shimmer className="h-3 w-10" />
            </div>
            <Shimmer className="h-4 w-20" />
          </div>
        ))}
      </div>
    </motion.div>
  )
}

export function PaymentsSkeleton({ showMonthNav = true }: { showMonthNav?: boolean } = {}) {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
    >
      {showMonthNav && (
      <div className="flex items-center justify-center gap-3 mb-4">
        <Shimmer className="w-10 h-10 rounded-lg" />
        <Shimmer className="h-10 w-56 sm:w-72" />
        <Shimmer className="w-10 h-10 rounded-lg" />
      </div>
      )}
      {[0, 1].map(gi => (
        <motion.div
          key={gi}
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: gi * 0.1, duration: 0.35 }}
          className="mb-4"
        >
          <Shimmer className="h-4 w-16 mb-2 ml-1" />
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 bg-[var(--border)]/40 border-b border-[var(--border)]">
              <Shimmer className="h-3 w-24" />
            </div>
            {[0, 1, 2, 3].map(si => (
              <div key={si} className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]/30 last:border-0">
                <Shimmer className="h-4 w-14 flex-1" />
                <Shimmer className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </motion.div>
      ))}
    </motion.div>
  )
}

/** 결제선생 로딩 폴백 — 날짜 제목 → 발송 버튼 → 내역 카드 → 결제율 → 2x2 구조 (2026-09-26 C10).
 * 청구서·납부·테스트모드까지 다 올 때까지 이것을 보여 주고, 도착 후 카드가 끼어들며 밀리는 일이 없게 한다. */
export function BillingSkeleton() {
  return (
    <div className="pt-2 pb-1" aria-busy="true">
      <div className="mb-3 px-1">
        <Shimmer className="h-8 w-44" />
        <Shimmer className="h-3 w-28 mt-1.5" />
      </div>
      <Shimmer className="w-full h-11 mt-2 mb-3 rounded-2xl" />
      <div className="card px-3 py-3.5 mb-3 space-y-2">
        <Shimmer className="h-4 w-20 mb-1" />
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex items-center gap-2">
            <Shimmer className="h-3 w-10" />
            <Shimmer className="h-3 flex-1" />
            <Shimmer className="h-4 w-14 rounded-full" />
          </div>
        ))}
      </div>
      <div className="card p-4 mb-3 space-y-2">
        <Shimmer className="h-4 w-16" />
        <Shimmer className="h-9 w-20" />
        <Shimmer className="h-2 w-full rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="card p-3 space-y-1.5">
            <Shimmer className="h-3 w-12" />
            <Shimmer className="h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** 특강탭 로딩 폴백 — 학년그룹 → 반 카드 → 학생줄 구조. 움직이는 shimmer(대시보드/납부탭과 동일). */
export function SpecialSkeleton() {
  return (
    <motion.div initial={false} animate={{ opacity: 1 }}>
      {[0, 1].map(gi => (
        <motion.div
          key={gi}
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: gi * 0.1, duration: 0.35 }}
          className="mb-6"
        >
          <Shimmer className="h-5 w-16 mb-2" />
          <div className="space-y-3">
            {[0, 1].map(ci => (
              <div data-paper-card="" key={ci} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--bg-card-hover)]/50 border-b border-[var(--border)]">
                  <Shimmer className="h-4 w-28" />
                  <Shimmer className="h-4 w-16" />
                </div>
                {[0, 1, 2].map(si => (
                  <div key={si} className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border)]/40 last:border-0">
                    <Shimmer className="h-4 w-20" />
                    <Shimmer className="h-6 w-20 rounded-full" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </motion.div>
      ))}
    </motion.div>
  )
}

/** 학생/납부 모달 안에서 로딩 폴백 — "로딩 중..." 텍스트 대신 구조 보존 스켈레톤 */
export function ModalContentSkeleton() {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
      className="p-4 space-y-4"
    >
      <div data-paper-card="" className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Shimmer className="h-4 w-24" />
          <Shimmer className="h-6 w-16 rounded-full" />
        </div>
        <Shimmer className="h-3 w-32" />
        <Shimmer className="h-3 w-40" />
      </div>
      {[0, 1, 2].map(i => (
        <motion.div data-paper-card=""
          key={i}
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06, duration: 0.25 }}
          className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3 flex items-center gap-3"
        >
          <Shimmer className="w-8 h-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Shimmer className="h-3 w-2/3" />
            <Shimmer className="h-2.5 w-1/3" />
          </div>
          <Shimmer className="h-5 w-14 rounded-full" />
        </motion.div>
      ))}
    </motion.div>
  )
}

/**
 * 학생 상세 시트 로딩 자리 — **최종 화면과 같은 구획·높이**로 자리를 잡는다 (2026-09-27 동작품질 배치2 #4, INVENTORY C11).
 * 예전엔 작은 공용 스켈레톤(약 350px)이라 시트가 짧게 올라오다 데이터가 오면 88vh 로 튀어 커졌다(올라오는 도중 높이 변화).
 * 구획: 정보 카드(머리·정보 4칸·결제일·비고·퇴원) → 학생 360(접힘) → 이번달 납부현황 → 환불 계산기(접힘) → 납부 내역.
 * 휴대폰에선 최종 내용이 사실상 늘 시트 상한(88vh)을 넘으므로 처음부터 그 높이를 채워 둔다(max-sm:min-h).
 * 모양은 기존 스켈레톤과 같은 Shimmer·카드 토큰.
 */
export function StudentDetailSkeleton() {
  const card = 'bg-[var(--bg-card)] rounded-xl border border-[var(--border)]'
  return (
    <div className="p-4 space-y-4 max-sm:min-h-[88vh]" data-student-detail-skeleton="" aria-busy="true">
      <div data-paper-card="" className={`${card} p-4`} data-skeleton-block="info">
        <div className="flex items-start justify-between mb-3">
          <Shimmer className="h-4 w-32 mt-1" />
          <div className="flex gap-1">
            <Shimmer className="w-8 h-8 rounded-lg" />
            <Shimmer className="w-8 h-8 rounded-lg" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="space-y-1.5 py-0.5">
              <Shimmer className="h-3 w-10" />
              <Shimmer className="h-4 w-24" />
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          <Shimmer className="h-3 w-12" />
          <Shimmer className="h-[38px] w-full rounded-lg" />
        </div>
        <div className="mt-4 space-y-2">
          <Shimmer className="h-4 w-full" />
          <Shimmer className="h-[38px] w-full rounded-lg" />
        </div>
        <Shimmer className="mt-4 h-5 w-20" />
      </div>
      <div data-paper-card="" className={`${card} px-4 py-3 flex items-center gap-2`} data-skeleton-block="360">
        <Shimmer className="w-4 h-4 rounded-full" />
        <Shimmer className="h-4 w-40" />
      </div>
      <div data-paper-card="" className={`${card} p-4`} data-skeleton-block="month">
        <div className="flex items-center justify-between mb-3">
          <Shimmer className="h-4 w-24" />
          <Shimmer className="h-5 w-12 rounded-full" />
        </div>
        <div className="flex items-end justify-between">
          <div className="space-y-1.5">
            <Shimmer className="h-7 w-28" />
            <Shimmer className="h-4 w-20" />
          </div>
          <Shimmer className="h-9 w-24 rounded-lg" />
        </div>
      </div>
      <div data-paper-card="" className={`${card} p-4`} data-skeleton-block="refund">
        <Shimmer className="h-5 w-24" />
      </div>
      <div data-paper-card="" className={`${card} p-4`} data-skeleton-block="history">
        <div className="flex items-center justify-between mb-3">
          <Shimmer className="h-4 w-16" />
          <Shimmer className="h-5 w-12" />
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Shimmer className="w-8 h-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Shimmer className="h-3 w-2/3" />
                <Shimmer className="h-2.5 w-1/3" />
              </div>
              <Shimmer className="h-5 w-14 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
