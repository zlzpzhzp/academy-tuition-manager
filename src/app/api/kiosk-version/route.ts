import { NextResponse } from 'next/server'

// 키오스크 자동 갱신용 버전 엔드포인트 (2026-07-04).
// 서버(로컬 next-server)는 배포마다 재시작되므로 모듈 로드 시각이 곧 배포 버전.
// 키오스크가 이 값을 주기적으로 폴링해 바뀌면 자동 새로고침 → 태블릿 수동 새로고침 불필요.
export const dynamic = 'force-dynamic'

const BOOT_VERSION = Date.now().toString()

export async function GET() {
  return NextResponse.json({ v: BOOT_VERSION }, { headers: { 'Cache-Control': 'no-store' } })
}
