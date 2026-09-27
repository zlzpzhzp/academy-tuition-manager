'use client'

// 앱 설치 권유 배너 (2026-08-01 운영자님 지시 "브라우저에서 열면 설치할까요 뜨게").
// 자매 앱의 InstallPrompt 구현을 기준으로 이 앱 디자인 토큰에 맞춰 옮긴 것.
//
// 브라우저는 설치 조건을 다 만족해도 **사이트가 직접 prompt()를 부르지 않으면** 설치를 권하지 않는다.
// 그래서 beforeinstallprompt를 잡아 두고(preventDefault) 우리 배너 버튼으로 실제 설치창을 연다.
// ⚠️ iOS Safari는 beforeinstallprompt 자체가 없다 → "공유 → 홈 화면에 추가" 안내로 대체한다.

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'pwa-install-dismissed-at'
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000 // 한 번 닫으면 일주일 조용히

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+는 Mac으로 위장하므로 터치 지원 여부로 구분
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return at > 0 && Date.now() - at < DISMISS_COOLDOWN_MS
  } catch {
    return false
  }
}

// 이 경로들에는 배너를 띄우지 않는다.
// /kiosk = 학원 태블릿 전용 출결 화면. 학생이 코드를 찍고 등원/하원을 누르는 자리를
// 배너가 덮어 **출결이 아예 안 되는 사고**가 났다(2026-07-31 운영자님 신고).
// 공용 기기라 설치를 권할 대상도 아니다.
// /login = 화면 전체가 `fixed inset-0` 컨테이너다 → **아래 body 여백이 안 먹는다**(2026-08-02 5점 실측:
// 로그인 버튼이 배너 카드에 2/5 부분가림). 여백으로는 못 푸는 구조라 배너를 안 띄운다.
// 잃는 것 없다 — 로그인 직후 /dashboard 에서 바로 뜬다.
// 실측(2026-08-02, Chromium 헤드리스 · 375/820px · 5점): 이 둘을 뺀 나머지 화면은
// 완전가로챔 0 · 부분가림 0. 탭바가 sm:hidden 이라 820px 에선 하단에 조작요소가 아예 없다.
const HIDDEN_PATHS = ['/kiosk', '/login']

export default function InstallPrompt() {
  const pathname = usePathname()
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosGuide, setShowIosGuide] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    // 음성 대조 지점: 이미 설치(standalone)했거나 최근에 닫았으면 아무것도 하지 않는다.
    if (isStandalone() || dismissedRecently()) return

    // 2026-08-01 경합 수정(운영 경보): beforeinstallprompt 는 리액트 하이드레이션보다 먼저
    // 지나갈 수 있다. layout 의 인라인 스크립트가 미리 잡아 window.__bipEvent 에 넣어두므로
    // ①이미 잡혀 있으면 바로 줍고 ②늦게 오면 bip-ready 로 받는다.
    // ③아래 직접 리스너는 인라인이 실패했을 때의 안전망으로 그대로 둔다.
    const w = window as unknown as { __bipEvent?: BeforeInstallPromptEvent | null }
    if (w.__bipEvent) setDeferred(w.__bipEvent)
    const onBipReady = () => { if (w.__bipEvent) setDeferred(w.__bipEvent) }
    window.addEventListener('bip-ready', onBipReady)

    const onBeforeInstall = (e: Event) => {
      e.preventDefault() // 브라우저 기본 미니바 억제 → 우리 배너로 유도
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    const onInstalled = () => setHidden(true)
    window.addEventListener('appinstalled', onInstalled)

    // iOS는 이벤트가 없으므로 조금 기다렸다가 안내를 띄운다
    // (안드로이드에서 beforeinstallprompt가 늦게 오는 경우와 겹치지 않게 지연)
    let t: ReturnType<typeof setTimeout> | null = null
    if (isIOS()) t = setTimeout(() => setShowIosGuide(true), 2500)

    return () => {
      window.removeEventListener('bip-ready', onBipReady)
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      if (t) clearTimeout(t)
    }
  }, [])

  // 배너가 떠 있는 동안 본문 하단에 여백을 준다.
  // ⚠️ 여백 = '배너 카드 윗변 ~ 화면 아래끝' 전체다(배너 높이만 주면 하단 탭바 높이만큼 모자란다 — 자매 앱 실측).
  //    높이를 하드코딩하지 않고 실측해서, 폭·safe-area·탭바 유무가 달라져도 따라가게 한다.
  useEffect(() => {
    if (hidden || (!deferred && !showIosGuide)) return
    const el = document.querySelector('[aria-label="앱 설치 안내"] > div') as HTMLElement | null
    const wrap = el?.parentElement
    if (!el || !wrap) return
    // 🔴 getBoundingClientRect().top 으로 재지 마라. 카드는 translateY(12px) 에서 올라오는 중이라
    //    마운트 직후 재면 최종 위치보다 12px 아래다 = 여백이 12px 모자란 채 굳는다(조용히 틀린다).
    //    offsetHeight + 래퍼의 padding-bottom 은 transform 과 무관해서 첫 프레임부터 정확하다.
    //    래퍼 padding-bottom 에 safe-area 가 들어 있으므로 아이폰 값도 그 기기에서 그대로 반영된다.
    const apply = () => {
      const wrapPad = parseFloat(getComputedStyle(wrap).paddingBottom) || 0
      const pad = Math.max(0, Math.round(wrapPad + el.offsetHeight)) + 12
      document.body.style.paddingBottom = `${pad}px`
    }
    apply()
    // 카드 높이는 줄바꿈·폰트로도 바뀐다(resize 안 뜬다) → ResizeObserver 필요
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    window.addEventListener('resize', apply)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', apply)
      document.body.style.paddingBottom = ''
    }
  }, [hidden, deferred, showIosGuide])

  const dismiss = () => {
    setHidden(true)
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* noop */ }
  }

  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') setHidden(true)
    else dismiss()
    setDeferred(null)
  }

  if (hidden) return null
  if (HIDDEN_PATHS.some(p => pathname?.startsWith(p))) return null
  if (!deferred && !showIosGuide) return null

  return (
    <div
      // z-[45]: Navbar(z-40)보다 위, 모달(z-50)보다 아래 — 모달 열렸을 때 가리지 않게.
      // 하단 네비 위로 띄우되 safe-area를 피한다(네비 높이 약 64px + 여백).
      // 🔴 pointer-events-none 필수: 이 래퍼는 y513~667 을 덮는 큰 박스인데 아래 76px 은 투명 패딩이다.
      //    그런데 투명해도 **탭은 삼킨다** — 2026-08-01 실측에서 /attendance 의 출·지·조·결 버튼 5개,
      //    /settings 로그아웃, /payments 버튼 1개가 이 보이지 않는 영역에 가로채이고 있었다.
      //    카드에만 pointer-events-auto 를 돌려준다.
      className="fixed inset-x-0 bottom-0 z-[45] px-3 pb-[calc(env(safe-area-inset-bottom)+76px)] pointer-events-none animate-[fade-in-up_260ms_cubic-bezier(0.22,1,0.36,1)]"
      role="dialog"
      aria-label="앱 설치 안내"
    >
      <div data-paper-card="" className="pointer-events-auto mx-auto max-w-md rounded-2xl px-4 py-3 flex items-center gap-3 shadow-lg bg-[var(--bg-card)] border border-[var(--border)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192x192.png" alt="" width={40} height={40} className="rounded-xl shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[var(--text-1)] leading-tight">앱으로 설치하기</p>
          <p className="text-[12px] text-[var(--text-4)] leading-snug mt-0.5">
            {deferred
              ? '홈 화면에서 바로 열 수 있고 더 빠릅니다.'
              : '공유 버튼 → “홈 화면에 추가”를 누르세요.'}
          </p>
        </div>
        {deferred && (
          <button
            type="button"
            onClick={install}
            className="shrink-0 px-3.5 py-2 rounded-xl text-[13px] font-bold text-[var(--on-action)] bg-[var(--blue)] active:scale-95 transition-transform"
          >
            설치
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="나중에"
          className="shrink-0 px-2 py-2 text-[13px] text-[var(--text-4)] active:scale-95 transition-transform"
        >
          닫기
        </button>
      </div>
    </div>
  )
}
