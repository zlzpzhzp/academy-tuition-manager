import { NextResponse } from 'next/server'
import { formatKst } from './schedule'

/**
 * 영업시간 외 예약 SCHEDULED 응답 — send/split-send(발송)·reissue/resend(재발송) 공통.
 * 코드/타임스탬프 완전동일, 동사(발송|재발송)만 다름. resettle 은 취소동반 변형이라 별도 유지.
 * 2026-07-03 C단계3 추출.
 */
export function scheduledResponse(scheduledAt: Date, verb: '발송' | '재발송' = '발송') {
  return NextResponse.json({
    code: 'SCHEDULED',
    msg: `영업시간 외 요청 → ${formatKst(scheduledAt)} KST 에 자동 ${verb}됩니다`,
    scheduled_at: scheduledAt.toISOString(),
    scheduled_at_kst: formatKst(scheduledAt),
  })
}
