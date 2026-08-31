export async function register() {
  // 서버 타임존 고정 (KST). 2026-07-26 감사: src/instrumentation.ts 에 따로 있던 이 설정이
  // 루트 instrumentation.ts 에 밀려 빌드 산출물에 아예 포함되지 않았다(Next.js는 둘 중 하나만 로드).
  // 로컬은 systemd drop-in(10-tz.conf)이, 날짜 로직은 명시적 +9h shift가 커버해 실피해는 없었으나
  // bulletin [rule.timezone] 이 요구하는 안전망이 조용히 꺼져 있던 상태라 여기로 병합.
  process.env.TZ = 'Asia/Seoul'
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}
export { captureRequestError as onRequestError } from '@sentry/nextjs'
