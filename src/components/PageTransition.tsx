'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState, createContext, useContext } from 'react'
import { useReducedMotion } from 'framer-motion'

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
  const prefersReducedMotion = useReducedMotion()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // /login, /kiosk: fixed inset-0 전체 화면 디자인 → containing block 갈등 방지 위해 PageTransition 우회
  if (!mounted || prefersReducedMotion || pathname === '/login' || pathname === '/kiosk') {
    return <div>{children}</div>
  }

  // 성능 최적화 (2026-05-18 audit): key={pathname} 제거 → 페이지 전환 시 motion.div 재마운트 차단
  // children은 Next.js가 알아서 unmount/mount, motion.div는 동일 인스턴스 유지
  // fade transition은 CSS로 처리 (framer-motion 비용 절감)
  return <div className="page-fade">{children}</div>
}
