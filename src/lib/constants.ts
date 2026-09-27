import type { PaymentMethod } from '@/types'

// 결제선생(payssam)은 자동 callback으로만 등록되며 수동 선택 옵션에서는 제외 
export const METHOD_OPTIONS: [PaymentMethod, string][] = [
  ['card', '카드결제'],
  ['transfer', '계좌이체'],
  ['cash', '현금'],
  ['pay', '간편결제(PAY)'],
  ['other', '기타'],
]

export const METHOD_OPTIONS_SHORT: [PaymentMethod, string][] = [
  ['card', '카드'],
  ['transfer', '이체'],
  ['cash', '현금'],
  ['pay', 'PAY'],
  ['other', '기타'],
]

// 결제 내역 표시용 (기존 비대면 기록 포함)
export const METHOD_LABELS: Record<string, string> = {
  remote: '비대면',
  card: '카드',
  transfer: '이체',
  cash: '현금',
  payssam: '결선',
  pay: 'PAY',
  other: '기타',
}
