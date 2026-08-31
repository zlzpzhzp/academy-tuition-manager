import type { Metadata, Viewport } from "next";
// 2026-05-24 perf: full variable(2MB woff2) → dynamic-subset (페이지별 사용 글자만, ~100KB).
// LCP 14.5s → 3-4s 예상 (audit perf-2026-05-24-other-apps-lighthouse.md).
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import Navbar from "@/components/Navbar";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import InstallPrompt from "@/components/InstallPrompt";
import SWRProvider from "@/components/SWRProvider";
import PageTransition, { NavDirectionProvider } from "@/components/PageTransition";
import { Toaster } from "sonner";

export const viewport: Viewport = {
  themeColor: '#17171c',
  width: 'device-width',
  initialScale: 1,
  // maximumScale 제거 (WCAG 1.4.4) — 노안/시각장애 사용자 줌 허용. 2026-05-24 a11y audit
}

// force-dynamic 제거 (2026-05-18 perf audit) — SSR fetch 매 navigation마다 실행되던 비용 절감.
// 클라이언트 useSWR이 직접 fetch + dedupingInterval로 중복 차단. 첫 페이지 로드 시
// fallback 없어 200ms 정도 늦지만 navigation 시 매번 DB fetch 안 함 (전체적으로 큰 이득).

export const metadata: Metadata = {
  title: "원비관리",
  description: "학원 원비 관리 시스템",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "원비관리",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <style dangerouslySetInnerHTML={{ __html: `html,body{background:#17171c;color:#ececec;margin:0;font-family:'Pretendard Variable','Pretendard',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif}` }} />
        {/* beforeinstallprompt 선점 (2026-08-01 amnesia 경보 — 홈피 1차 방문 실측으로 잡힌 경합).
            이 이벤트는 리액트 하이드레이션보다 먼저 지나갈 수 있어, 컴포넌트가 나중에 붙인 리스너로는
            **첫 방문에서 못 받는다**(리로드해야 뜨는 증상). 리액트보다 먼저 도는 이 자리에서 미리 잡아둔다.
            원비는 우연히 1차 방문에서도 떴지만 번들·네트워크 타이밍이 바뀌면 언제든 뒤집히는 경합이다. */}
        <script dangerouslySetInnerHTML={{ __html: `window.__bipEvent=null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__bipEvent=e;window.dispatchEvent(new Event('bip-ready'));});` }} />
      </head>
      <body className="min-h-screen">
        <SWRProvider fallback={{}}>
          <NavDirectionProvider>
            <ServiceWorkerRegistration />
            <Navbar />
            <main className="max-w-4xl mx-auto px-4 pt-20 pb-24 sm:pb-8">
              <PageTransition>
                {children}
              </PageTransition>
            </main>
            <InstallPrompt />
            <Toaster position="top-center" theme="dark" richColors closeButton duration={4000} />
          </NavDirectionProvider>
        </SWRProvider>
      </body>
    </html>
  );
}
