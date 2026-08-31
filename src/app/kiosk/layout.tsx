import type { Metadata, Viewport } from 'next'
import { ACADEMY_SHORT_NAME } from '@/lib/branding'

export const metadata: Metadata = {
  title: `${ACADEMY_SHORT_NAME} 출결`,
  description: `${ACADEMY_SHORT_NAME} 출결 키오스크`,
  manifest: '/manifest-kiosk.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: `${ACADEMY_SHORT_NAME} 출결`,
  },
}

export const viewport: Viewport = {
  themeColor: '#070b14',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

/** 키오스크 풀스크린 — root layout의 Navbar/main 컨테이너 회피 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return children
}
