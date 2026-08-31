'use client'

import { useEffect } from 'react'

// 2026-08-01: 앱 설치 배너를 띄우려면 SW가 살아 있어야 한다(크롬 설치 조건 = fetch 핸들러 SW).
// 이전에는 이 컴포넌트가 모든 SW를 unregister 하는 kill-switch 였다 — 예전 SW가 HTML을 캐시해
// iOS Safari에 낡고 스타일 깨진 화면이 뜨던 사고 때문이다. 지금 등록하는 public/sw.js 는
// **캐시를 아예 하지 않는 pass-through** 라 그 사고가 재현될 수 없다.
// ⛔ 여기에 캐싱을 다시 넣지 마라 — 캐싱이 그 사고의 원인이었다.
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // 과거 SW가 남긴 캐시 잔재는 한 번 더 비운다(새 SW는 캐시를 만들지 않는다).
    caches.keys()
      .then((keys) => keys.forEach((k) => caches.delete(k)))
      .catch(() => { /* noop */ })
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      // 등록 실패 = 설치 배너가 영영 안 뜨는 원인. 조용히 삼키지 않고 콘솔에 남긴다.
      console.error('[sw] 등록 실패 — 앱 설치 배너가 뜨지 않습니다:', e)
    })
  }, [])
  return null
}
