// 결제선생 발송 응답의 클라이언트 판정 — send API(/api/payssam/send)는 결제선생 실패
// (code≠'0000')도 HTTP 200으로 돌려주므로 r.ok만 보면 안 나간 청구서가 '발송 완료'로 뜬다
// (2026-08-13 라인리뷰 P1-C — 특강 화면 4곳이 이랬다). 납부탭 sendOneBill과 동일 판정.

export const isSendSuccess = (r: { ok: boolean }, res: { code?: string }): boolean =>
  r.ok && (res.code === '0000' || res.code === 'SCHEDULED')

/** 실패 사유 요약 — 일괄 발송의 핵심 정보 = '누가 왜 안 갔는지' */
export const sendFailReason = (r: { status: number }, res: { error?: string; msg?: string }): string =>
  res.error || res.msg || `HTTP ${r.status}`
