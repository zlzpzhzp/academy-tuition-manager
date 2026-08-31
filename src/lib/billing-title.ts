import { ACADEMY_NAME, ACADEMY_PHONE, ACADEMY_HOMEPAGE } from './branding'

/**
 * 정규 원비 청구서에 붙는 기본 안내 메시지.
 * 학원 이름·문의처는 `NEXT_PUBLIC_ACADEMY_*` 환경변수에서 온다 (src/lib/branding.ts 참조).
 * 값이 비어 있으면 그 줄은 통째로 빠진다 — "☀️문의 : " 같은 빈 껍데기가 학부모에게 가지 않게.
 */
export const REGULAR_TUITION_MESSAGE = [
  `안녕하세요. ${ACADEMY_NAME} 결제링크입니다. 감사합니다😁`,
  '',
  ACADEMY_PHONE ? `☀️문의 : ${ACADEMY_PHONE}` : null,
  ACADEMY_HOMEPAGE ? `☀️홈페이지 : ${ACADEMY_HOMEPAGE}` : null,
].filter(Boolean).join('\n')

export function getRegularTuitionTitle(
  subject: string | null | undefined,
  billingMonth: string,
  className?: string | null,
  electives?: string[] | null,
): string {
  const label = subject === '영어' ? '영어' : subject === '수학' ? '수학' : '학원'
  const m = parseInt(billingMonth.split('-')[1] ?? '0', 10)
  const cls = className?.trim()
  const base = cls
    ? `${ACADEMY_NAME} ${label} ${cls} ${m}월 정규원비`
    : `${ACADEMY_NAME} ${label} ${m}월 정규원비`
  const els = (electives ?? []).filter(e => e && e.trim())
  return els.length > 0 ? `${base} + ${els.join('/')}` : base
}

/** 청구서 기본 상품명 — "2026년 07월 수업료" (월 zero-pad 유지, 기존 동작 그대로) */
export function defaultBillProductName(billingMonth: string): string {
  return `${billingMonth.replace('-', '년 ')}월 수업료`
}

/** 청구서 기본 메시지 — "홍길동 2026년 07월 수업료" */
export function defaultBillMessage(studentName: string, billingMonth: string): string {
  return `${studentName} ${billingMonth.replace('-', '년 ')}월 수업료`
}

export function getElectivesTuitionTitle(billingMonth: string, electives?: string[] | null): string {
  const m = parseInt(billingMonth.split('-')[1] ?? '0', 10)
  const els = (electives ?? []).filter(e => e && e.trim())
  return els.length > 0
    ? `${ACADEMY_NAME} ${m}월 선택과목 (${els.join('/')})`
    : `${ACADEMY_NAME} ${m}월 선택과목`
}
