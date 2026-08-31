'use client'

import { useEffect, useRef } from 'react'
import { motion, useMotionValue, useSpring, type HTMLMotionProps, type Transition } from 'framer-motion'

/**
 * Spring 프리셋 — 사용처별 일관된 물리값.
 *
 * - SPRING_SNAPPY: tap/toggle 빠른 반응 (stiffness 500, damping 25). iOS 표준.
 * - SPRING_DEFAULT: 일반 진입/이동 (280/28). 토스의 기본값 근사.
 * - SPRING_GENTLE: 페이지·카드 진입 (260/24). 부드럽게 떠오르는 느낌.
 */
export const SPRING_SNAPPY: Transition = { type: 'spring', stiffness: 500, damping: 25 }
export const SPRING_DEFAULT: Transition = { type: 'spring', stiffness: 280, damping: 28 }
export const SPRING_GENTLE: Transition = { type: 'spring', stiffness: 260, damping: 24 }

/** 모든 버튼에 기본 탭 피드백을 주기 위한 공용 래퍼. whileTap/transition은 props로 덮어쓸 수 있음. */
export function TButton(props: HTMLMotionProps<'button'>) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      transition={SPRING_SNAPPY}
      {...props}
    />
  )
}

export function FadeInUp({
  children,
  delay = 0,
  className,
  style,
}: {
  children: React.ReactNode
  delay?: number
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_GENTLE, delay }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  )
}

export function StaggerContainer({
  children,
  className,
  staggerDelay = 0.05,
}: {
  children: React.ReactNode
  className?: string
  /** 항목 간 간격(초). 기본 50ms — 토스/Apple Mail 리스트 표준 */
  staggerDelay?: number
}) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: staggerDelay } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        visible: {
          opacity: 1,
          y: 0,
          transition: SPRING_DEFAULT,
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// 숫자 카운터 애니메이션 (토스 스타일)
export function AnimatedNumber({
  value,
  className,
  suffix,
  suffixClassName,
  duration = 0.8,
}: {
  value: number
  className?: string
  suffix?: string
  suffixClassName?: string
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const motionValue = useMotionValue(0)
  const springValue = useSpring(motionValue, {
    stiffness: 100,
    damping: 20,
    duration: duration * 1000,
  })

  useEffect(() => {
    motionValue.set(value)
  }, [value, motionValue])

  useEffect(() => {
    const unsubscribe = springValue.on('change', (v) => {
      if (ref.current) {
        ref.current.textContent = Math.round(v).toLocaleString()
      }
    })
    return unsubscribe
  }, [springValue])

  return (
    <>
      <span ref={ref} className={className}>0</span>
      {suffix && <span className={suffixClassName}>{suffix}</span>}
    </>
  )
}
