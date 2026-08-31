'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, CreditCard, Send, Settings, Wallet, Flame } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import useSWR from 'swr'
import { swrFetcher } from '@/lib/utils'
import { useNavDirection } from './PageTransition'

const navItems = [
  { href: '/dashboard', label: '대시보드', icon: LayoutDashboard },
  { href: '/payments', label: '납부', icon: CreditCard },
  { href: '/special', label: '특강', icon: Flame },
  { href: '/billing', label: '결제선생', icon: Send },
  { href: '/settings', label: '설정', icon: Settings },
]

export default function Navbar() {
  const pathname = usePathname()
  const router = useRouter()
  const { setDirection } = useNavDirection()
  const mobileNavRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })
  // optimistic 활성 탭 — 탭 누르는 즉시 표시(라우팅 완료 전). 워라/쌤 nav-perf 표준 (2026-06-04)
  const [optimisticIdx, setOptimisticIdx] = useState<number | null>(null)

  // '지금 발송이 진짜인가'를 알려주는 유일한 화면 표식 — 조회 실패 시 배지가 조용히 사라지면
  // 안 된다(fail-open). swrFetcher(!ok throw)로 실패를 error로 받아 '확인 실패' 표식을 띄운다 (2026-08-13 라인리뷰)
  const { data: testModeData, error: testModeError } = useSWR<{ testMode: boolean }>(
    '/api/billing/test-mode',
    swrFetcher,
  )
  const isTestMode = testModeData?.testMode === true
  const testModeUnknown = !!testModeError

  // 쌤앱 신규생은 DB 트리거로 자동 등록되므로 승인 대기 배지 폐기 (2026-05-30)
  const pendingRequests = 0

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')
  const pathnameIdx = navItems.findIndex(item => isActive(item.href))
  // optimistic 우선 — 탭 즉시 활성, pathname 따라잡으면 리셋
  const activeIdx = optimisticIdx !== null ? optimisticIdx : pathnameIdx

  // 전 탭 프리페치 — 클릭 시 라우트 JS 이미 준비됨
  useEffect(() => {
    navItems.forEach(item => { try { router.prefetch(item.href) } catch {} })
    try { router.prefetch('/finance') } catch {}
  }, [router])

  // 실제 라우팅이 optimistic 따라잡으면 리셋
  useEffect(() => {
    if (optimisticIdx !== null && pathnameIdx === optimisticIdx) setOptimisticIdx(null)
  }, [pathnameIdx, optimisticIdx])

  const handleTap = useCallback((idx: number) => {
    if (idx === activeIdx) return
    setOptimisticIdx(idx)
    setDirection(idx > activeIdx ? 'left' : idx < activeIdx ? 'right' : 'none')
  }, [activeIdx, setDirection])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  // 모바일 하단 인디케이터 위치 계산
  useEffect(() => {
    if (mobileNavRef.current && activeIdx >= 0) {
      const items = mobileNavRef.current.children
      if (items[activeIdx]) {
        const el = items[activeIdx] as HTMLElement
        setIndicatorStyle({
          left: el.offsetLeft + el.offsetWidth / 2 - 12,
          width: 24,
        })
      }
    }
  }, [activeIdx])

  if (pathname === '/login' || pathname === '/kiosk') return null

  return (
    <>
      {/* 데스크톱 상단 */}
      <nav className="fixed top-0 left-0 right-0 z-40" style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-4xl mx-auto px-5">
          <div className="flex items-center justify-between h-14">
            <Link href="/dashboard" className="flex items-center gap-2.5" aria-label="홈으로 이동">
              <Image src="/icons/icon-192x192.png" alt="원비관리" width={28} height={28} className="rounded-lg" />
              <span className="text-[17px] font-bold text-[var(--text-1)] tracking-tight">원비관리</span>
              {testModeUnknown && (
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-4)' }}
                  title="결제선생 모드 확인 실패 — 발송 전 설정을 확인하세요"
                >
                  모드?
                </span>
              )}
              {isTestMode && (
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                  style={{ background: 'var(--orange-dim)', color: 'var(--orange)' }}
                  title="결제선생 테스트 모드 — 실제 발송되지 않습니다"
                >
                  TEST
                </span>
              )}
            </Link>
            <div className="flex items-center gap-1">
              <div className="hidden sm:flex gap-1 relative">
                {navItems.map(({ href, label, icon: Icon }, idx) => {
                  const active = idx === activeIdx
                  const showBadge = href === '/settings' && pendingRequests > 0
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-label={label}
                      onClick={() => handleTap(idx)}
                      className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors
                        ${active
                          ? 'text-white'
                          : 'text-[var(--text-3)] hover:text-[var(--text-1)]'}`}
                    >
                      {active && (
                        <motion.div
                          layoutId="desktop-nav-pill"
                          className="absolute inset-0 bg-[var(--blue)] rounded-xl"
                          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        />
                      )}
                      <span className="relative z-10 flex items-center gap-2">
                        <Icon className="w-4 h-4" />
                        {label}
                        {showBadge && (
                          <span
                            className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white rounded-full"
                            style={{ background: 'var(--red, #e34a3f)' }}
                            aria-label={`쌤 추가요청 ${pendingRequests}건`}
                          >
                            {pendingRequests > 99 ? '99+' : pendingRequests}
                          </span>
                        )}
                      </span>
                    </Link>
                  )
                })}
              </div>
              <Link
                href="/finance"
                data-finance-nav
                aria-label="재정"
                className={`p-2.5 rounded-xl transition-all ${
                  isActive('/finance')
                    ? 'bg-[var(--blue)] text-white'
                    : 'text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--bg-card-hover)]'
                }`}
              >
                <Wallet className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* 모바일 하단 */}
      <div className="fixed bottom-0 left-0 right-0 sm:hidden z-50" style={{ background: 'var(--bg-card)', borderTop: '1px solid var(--border)' }}>
        {/* 슬라이딩 인디케이터 */}
        {activeIdx >= 0 && (
          <motion.div
            className="absolute top-0 h-[2px] bg-[var(--blue)] rounded-full"
            animate={{ left: indicatorStyle.left, width: indicatorStyle.width }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          />
        )}
        <div className="flex" ref={mobileNavRef}>
          {navItems.map(({ href, label, icon: Icon }, idx) => {
            const active = idx === activeIdx
            const showBadge = href === '/settings' && pendingRequests > 0
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                onClick={() => handleTap(idx)}
                className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 relative"
              >
                <motion.div
                  animate={{ scale: active ? 1 : 0.9, y: active ? -2 : 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  className="relative"
                >
                  <Icon className="w-[22px] h-[22px]" style={{ color: active ? 'var(--blue)' : 'var(--text-4)' }} />
                  {showBadge && (
                    <span
                      className="absolute -top-1 -right-2 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[10px] font-bold text-white rounded-full"
                      style={{ background: 'var(--red, #e34a3f)' }}
                    >
                      {pendingRequests > 9 ? '9+' : pendingRequests}
                    </span>
                  )}
                </motion.div>
                <motion.span
                  className="text-[10px] font-bold"
                  animate={{ color: active ? 'var(--blue)' : 'var(--text-4)', scale: active ? 1.05 : 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                >
                  {label}
                </motion.span>
              </Link>
            )
          })}
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    </>
  )
}
