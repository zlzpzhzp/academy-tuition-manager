'use client'

import { usePathname } from 'next/navigation'
import { Toaster } from 'sonner'
import { usePaperScheme } from '@/components/PaperSchemeControl'

/** 키오스크의 기존 토스트 테마와 일반 화면의 종이 테마를 구분한다. */
export default function PaperToaster() {
  const pathname = usePathname()
  const scheme = usePaperScheme()
  return <Toaster position="top-center" theme={pathname === '/kiosk' ? 'dark' : scheme} richColors closeButton duration={4000} />
}
