import { supabase } from './supabase'

/**
 * '발송됨' 청구이력(tuition_bill_history) 1건 기록 — 7개 발송경로 공통
 * (send·split-send·reissue·resettle·cron single/reissue/split).
 *
 * status는 항상 'sent'. bill_type 는 생략 가능 — DB 컬럼이 `text NOT NULL DEFAULT 'regular'` 라
 * 생략하면 'regular' 로 저장(= 기존 4개 경로가 bill_type 을 안 넣던 동작과 byte-identical).
 * 반환값 = insert 결과(builder) → 호출측이 `const { error } = await recordSentBill(...)` 로 처리 가능.
 *
 * 2026-07-03 C단계2 추출. 기존 7곳 인라인 insert 와 필드 완전동일(라이브 bill_type 기본값 확인 후).
 */
export type SentBillFields = {
  student_id: string
  bill_id: string
  amount: number
  billing_month: string
  phone: string
  short_url: string | null
  sent_at: string
  is_regular_tuition: boolean
  bill_note: string | null
  bill_type?: string
  /** 이 청구서가 대체하는 기존 청구서 bill_id. 이 청구서가 '결제완료'되면 콜백이 기존 bill을 취소(환불).
   *  퇴원 정산(resettle)에서 사용: 정산분 청구서 결제완료 시 기존 완납분을 환불하는 링크. */
  supersedes_bill_id?: string | null
}

/**
 * 재발송 카운트 +1 + 타임스탬프 갱신 — resend·cron/resend·cron send-queued(resend) 공통.
 * bill_id 그대로라 이중청구 위험 없음(카톡 재알림만). cron/resend는 bill_note(회차) 추가.
 * 2026-07-03 C단계3 추출.
 */
export function bumpResendCount(
  billId: string,
  currentCount: number | null | undefined,
  nowIso: string,
  billNote?: string,
) {
  return supabase
    .from('tuition_bill_history')
    .update({
      resend_count: (currentCount ?? 0) + 1,
      last_resend_at: nowIso,
      ...(billNote !== undefined ? { bill_note: billNote } : {}),
      updated_at: nowIso,
    })
    .eq('bill_id', billId)
}

export function recordSentBill(f: SentBillFields) {
  return supabase.from('tuition_bill_history').insert({
    student_id: f.student_id,
    bill_id: f.bill_id,
    amount: f.amount,
    billing_month: f.billing_month,
    phone: f.phone,
    status: 'sent' as const,
    short_url: f.short_url,
    sent_at: f.sent_at,
    is_regular_tuition: f.is_regular_tuition,
    bill_note: f.bill_note,
    ...(f.bill_type !== undefined ? { bill_type: f.bill_type } : {}),
    ...(f.supersedes_bill_id !== undefined ? { supersedes_bill_id: f.supersedes_bill_id } : {}),
  })
}
