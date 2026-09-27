'use client'

import { usePathname } from 'next/navigation'
import { useLayoutEffect, useRef, useState, createContext, useContext } from 'react'
import { installPaperScheme, normalizePaperPreference, PAPER_COLORS } from '@/lib/paperScheme'
import { usePaperReducedMotion } from '@/components/paperMotion'

type Direction = 'left' | 'right' | 'none'

const NavDirectionContext = createContext<{
  direction: Direction
  setDirection: (d: Direction) => void
}>({ direction: 'none', setDirection: () => {} })

export function useNavDirection() {
  return useContext(NavDirectionContext)
}

export function NavDirectionProvider({ children }: { children: React.ReactNode }) {
  const [direction, setDirection] = useState<Direction>('none')
  return (
    <NavDirectionContext.Provider value={{ direction, setDirection }}>
      {children}
    </NavDirectionContext.Provider>
  )
}

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const reduced = usePaperReducedMotion()
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    installPaperScheme(PAPER_COLORS, normalizePaperPreference).route(pathname)
  }, [pathname])

  useLayoutEffect(() => {
    // 경로별로 같은 DOM의 opacity만 재생한다. key로 자식을 재마운트하지 않는다.
    // 설정 변경·빠른 SPA 재이동은 이전 애니메이션을 취소해 즉시 현재 화면으로 복귀한다.
    if (reduced || pathname === '/login' || pathname === '/kiosk') return
    const animation = ref.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
    return () => animation?.cancel()
  }, [pathname, reduced])

  // 성능 최적화 (2026-05-18 audit): key={pathname} 제거 → 페이지 전환 시 motion.div 재마운트 차단
  // children은 Next.js가 알아서 unmount/mount, 래퍼는 동일 인스턴스 유지
  return <div ref={ref} data-ui-theme={pathname === '/kiosk' ? 'kiosk' : 'paper'}>{children}</div>
}
