import { NextRequest, NextResponse } from 'next/server'
import { processOverdueDestroys } from '@/lib/deferredDestroy'
import { requireCronSecret } from '@/lib/auth'

// CRON_SECRET으로 보호되는 지연 파기 처리 전용 엔드포인트.
// 타 결제수단(계좌이체 등) 납부 등록 시 예약되는 1시간 지연 파기(send_type='destroy')를
// 주기적으로 확실히 처리한다. 시스템 crontab이 10분마다 localhost로 호출.
//
// 배경: 기존엔 /api/billing/queue GET(로그인 세션 필요)이 열릴 때만 lazy 처리됐는데,
// 그 경로가 호출되지 않으면 예약 파기가 무한정 'sent' 상태로 방치되는 문제가 있었다
// (2026-06-06 윈터/닝닝 3건 3시간+ 방치 사건). 영업시간 게이트 없이 상시 처리한다.
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  try {
    const processed = await processOverdueDestroys()
    return NextResponse.json({ ok: true, processed, at: new Date().toISOString() })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[cron/process-destroys] 실패:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
