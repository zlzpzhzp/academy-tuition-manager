'use client'

import { motion } from 'framer-motion'

// ⚠️ 스켈레톤은 initial=false 필수 — motion initial opacity:0은 SSR HTML에 인라인으로 박혀
// 하이드레이션 전까지 다크 빈 화면이 됨 (HANDOFF trap / 2026-07-10 전수점검 C11)

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

export function PaymentsSkeleton() {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
    >
      <div className="flex items-center justify-center gap-3 mb-4">
        <Shimmer className="w-10 h-10 rounded-lg" />
        <Shimmer className="h-10 w-56 sm:w-72" />
        <Shimmer className="w-10 h-10 rounded-lg" />
      </div>
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
            <div className="px-4 py-2.5 bg-[#2c2c33]/40 border-b border-[#2c2c33]">
              <Shimmer className="h-3 w-24" />
            </div>
            {[0, 1, 2, 3].map(si => (
              <div key={si} className="flex items-center gap-2 px-4 py-3 border-b border-[#2c2c33]/30 last:border-0">
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
              <div key={ci} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
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
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Shimmer className="h-4 w-24" />
          <Shimmer className="h-6 w-16 rounded-full" />
        </div>
        <Shimmer className="h-3 w-32" />
        <Shimmer className="h-3 w-40" />
      </div>
      {[0, 1, 2].map(i => (
        <motion.div
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
