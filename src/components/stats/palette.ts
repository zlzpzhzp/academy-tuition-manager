/**
 * 분해 차트용 색 팔레트 — globals.css 에 **실재하는** CSS 변수만 쓴다.
 * (--purple 같은 토큰은 이 앱에 없다. 없는 변수를 쓰면 SVG fill 이 조용히 검게 나온다)
 */
export const STAT_PALETTE = [
  'var(--blue)',
  'var(--green)',
  'var(--orange)',
  'var(--red)',
  'var(--paid-text)',
  'var(--scheduled-text)',
  'var(--color-accent)',
  'var(--text-3)',
] as const

export const colorAt = (i: number): string => STAT_PALETTE[i % STAT_PALETTE.length]
