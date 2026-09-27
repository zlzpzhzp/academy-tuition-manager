'use client'

import { Children, createContext, useContext, useEffect, useRef } from 'react'
import { useMotionValue, useSpring, type HTMLMotionProps, type Transition } from 'framer-motion'
import { motion, PAPER_ENTER, PAPER_PRESS, usePaperReducedMotion } from '@/components/paperMotion'

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
      whileTap={{ scale: 0.985, transition: { duration: 0.09 } }}
      transition={PAPER_PRESS}
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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...PAPER_ENTER, delay }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  )
}

const StaggerIndex = createContext(0)

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
        visible: {},
      }}
      className={className}
    >
      {Children.map(children, (child, index) => (
        <StaggerIndex.Provider value={index < 8 ? index * staggerDelay : 0}>{child}</StaggerIndex.Provider>
      ))}
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
  const delay = useContext(StaggerIndex)
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { ...PAPER_ENTER, delay },
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
  const reduced = usePaperReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const motionValue = useMotionValue(0)
  const springValue = useSpring(motionValue, {
    stiffness: 100,
    damping: 20,
    duration: duration * 1000,
  })

  useEffect(() => {
    if (reduced) {
      motionValue.jump(value)
      springValue.jump(value)
      if (ref.current) ref.current.textContent = Math.round(value).toLocaleString()
    } else {
      motionValue.set(value)
    }
  }, [value, motionValue, springValue, reduced])

  useEffect(() => {
    if (reduced) return
    const unsubscribe = springValue.on('change', (v) => {
      if (ref.current) {
        ref.current.textContent = Math.round(v).toLocaleString()
      }
    })
    return unsubscribe
  }, [springValue, reduced])

  return (
    <>
      <span ref={ref} className={className}>{Math.round(value).toLocaleString()}</span>
      {suffix && <span className={suffixClassName}>{suffix}</span>}
    </>
  )
}
