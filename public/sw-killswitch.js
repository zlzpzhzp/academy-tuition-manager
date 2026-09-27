// 🔴 긴급용 킬스위치 서비스워커 — **평소엔 배포되지 않는다.**
//
// 언제 쓰나: 앱이 로고/스플래시에서 안 넘어간다는 신고가 올 때(진입 freeze).
//   SW 는 그 증상의 1순위 용의자다. 2026-08-01 강사 앱이 정확히 이 증상으로 막혔다.
//
// ⚠️ 함정 — **등록 코드만 지우면 이미 설치된 폰은 안 풀린다.**
//   ServiceWorkerRegistration.tsx 에서 register() 를 지워도 그건 '앞으로 등록 안 함'일 뿐이고,
//   그 폰에 이미 활성화된 SW 는 계속 페이지를 제어한다. 즉 롤백했다고 착각하는 동안
//   사고 난 기기는 그대로 갇혀 있다. (질문앱이 찾은 함정, 2026-08-01)
//
// ✅ 진짜 롤백 = **이 파일을 public/sw.js 로 덮어쓰고 배포**하는 것.
//   브라우저가 새 sw.js 를 받아가면서 스스로를 unregister 한다 → 앱 재실행 1회로 자가 해제.
//   강사 앱이 이 방식으로 복구했고, 갇힌 폰이 실제로 풀린 것이 확인됐다.
//
// 실행 절차:
//   cd <프로젝트 디렉터리>
//   cp public/sw-killswitch.js public/sw.js
//   bash scripts/deploy.sh          # 검증 게이트 통과 후 배포
//   # 그 뒤 ServiceWorkerRegistration.tsx 의 register 도 unregister 로 바꿔 재발 방지
//   # (순서 주의: sw.js 교체가 먼저다. 등록 코드부터 지우면 갇힌 폰이 새 sw.js 를 못 받는다)
//
// 대가: 설치 배너가 안 뜬다(크롬 설치 조건이 fetch 핸들러 SW 라서).
//   iOS 는 원래 beforeinstallprompt 가 없어 '공유 → 홈 화면에 추가' 안내는 그대로 뜬다.
//   즉 잃는 것은 안드로이드 원터치 설치뿐이다 — 앱이 안 열리는 것에 비하면 싸다.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
    await self.registration.unregister()
    // 열려 있는 창을 강제로 다시 탐색시켜 SW 제어에서 벗어나게 한다
    const clients = await self.clients.matchAll({ type: 'window' })
    clients.forEach((c) => c.navigate(c.url))
  })())
})
