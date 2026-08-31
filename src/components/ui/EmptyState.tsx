'use client'

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  /** 'page' = 화면 전용(py-16), 'inline' = 카드/섹션 안(py-8), 'compact' = 행 안(py-3) */
  size?: 'page' | 'inline' | 'compact'
}

/**
 * 일관된 빈 상태 표시.
 *
 * 사용 예:
 * <EmptyState icon={Inbox} title="미납 학생이 없습니다" description="이번 달은 모두 납부 완료됐어요" />
 * <EmptyState title="반을 추가해주세요" size="page" action={<Button>반 추가</Button>} />
 *
 * 화면별 ad-hoc 텍스트(`<p className="text-[var(--text-4)] text-center py-X">…없습니다</p>`)
 * 대신 이 컴포넌트로 통일 — 패딩/폰트/색 일관.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'inline',
}: EmptyStateProps) {
  const padding = size === 'page' ? 'py-16' : size === 'compact' ? 'py-3' : 'py-8'
  const titleSize = size === 'page' ? 'text-[15px]' : size === 'compact' ? 'text-xs' : 'text-sm'
  const iconSize = size === 'page' ? 'w-10 h-10' : size === 'compact' ? 'w-5 h-5' : 'w-7 h-7'

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={`flex flex-col items-center justify-center text-center ${padding}`}
    >
      {Icon && (
        <Icon className={`${iconSize} text-[var(--text-4)] mb-2 opacity-60`} strokeWidth={1.5} />
      )}
      <p className={`${titleSize} font-medium text-[var(--text-3)]`}>{title}</p>
      {description && (
        <p className="text-xs text-[var(--text-4)] mt-1 max-w-xs">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </motion.div>
  )
}
