import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' *.supabase.co",
  "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
  "img-src 'self' data: blob: *.supabase.co",
  "font-src 'self' fonts.gstatic.com",
  "connect-src 'self' *.supabase.co wss://*.supabase.co *.sentry.io",
  "frame-ancestors 'none'",
  // 2026-07-26 감사 추가: <base> 주입으로 상대경로를 외부로 돌리는 것 차단 + 폼 전송지 고정
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');
// ⚠️ script-src의 'unsafe-inline'은 아직 남아 있다 (Next.js 하이드레이션 인라인 스크립트 때문).
// 제거하려면 미들웨어 nonce 발급 + strict-dynamic 배선이 필요 — 2026-07-26 감사에서 별건으로 분리.

const nextConfig: NextConfig = {
  // 2026-08-01 빌드·릴리스·실행 분리(12-Factor V). 지금까지는 next start 가 떠 있는 채로
  // **같은 .next 를 재빌드**해서, 서비스가 반쯤 만들어진 디렉토리를 읽을 수 있었다.
  // 그게 쌤·홈피가 몇 주씩 죽던 stale chunk 사고의 뿌리다(chunkguard 같은 건 증상 대처였다).
  // 이제 배포는 .next-<sha> 로 빌드하고 심링크만 갈아끼운다 → 빌드 실패해도 기존 서비스는 그대로 산다.
  // 런타임(systemd)에는 이 변수를 주지 마라 — .next 심링크를 따라가면 된다.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  compress: true,
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'Content-Security-Policy', value: CSP },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
      ],
    }];
  },
};

// Sentry(에러 추적)는 선택 기능이다. SENTRY_ORG/SENTRY_PROJECT 가 없으면 래핑을 건너뛴다 —
// Sentry 계정 없이도 빌드·배포가 그대로 되게. 쓰려면 .env.example 의 SENTRY_* 를 채워라.
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;

export default sentryOrg && sentryProject
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: sentryOrg,
      project: sentryProject,
      sourcemaps: { disable: true },
      widenClientFileUpload: false,
    })
  : nextConfig;
