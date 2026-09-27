// 원비 서비스워커 — **캐시를 절대 하지 않는 최소 SW**.
//
// 목적은 딱 하나: 크롬의 앱 설치 조건("fetch 핸들러를 가진 서비스워커")을 만족시키는 것.
// (2026-08-01 운영자님 지시 "브라우저에서 열면 설치할까요 뜨게")
//
// ⚠️ 배경 — 이 파일은 원래 kill-switch 였다.
//   예전 SW가 HTML을 캐시해서 iOS Safari에 **낡고 스타일 깨진 화면**이 계속 뜨는 사고가 났고,
//   그래서 자기 자신을 unregister 하고 모든 캐시를 지우는 코드로 바꿔놨었다.
//   설치 배너를 붙이려면 SW가 살아 있어야 해서 되살리되, **사고 원인(캐싱)은 되살리지 않는다.**
//
// 그래서 규칙:
//   · 어떤 응답도 캐시에 넣지 않는다(캐시 쓰기 코드가 아예 없다).
//   · fetch 는 네트워크로 그대로 통과시킨다 — 오프라인 지원 없음. 낡은 자산이 남을 수 없다.
//   · 활성화 시 과거 SW가 남긴 캐시를 한 번 더 정리한다.
//   이 구조에서는 stale chunk / 낡은 HTML 사고가 원천적으로 불가능하다.
//   (참고: 강사 앱 2026-07-16~18 사흘 사고 — 같은 뿌리)

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 과거 버전이 남긴 캐시 잔재 제거 (이 SW는 새로 만들지 않는다)
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

// 설치 조건 충족용 pass-through. 네트워크 응답을 그대로 돌려주고 캐시는 건드리지 않는다.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request))
})
