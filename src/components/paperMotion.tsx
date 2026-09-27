'use client'

import { forwardRef, useSyncExternalStore } from 'react'
import { motion as framerMotion, type HTMLMotionProps, type Transition } from 'framer-motion'

// globals.css --motion-enter / --motion-press와 대응. spring 값은 CSS 변수가 아니다.
export const PAPER_ENTER: Transition = { duration: .22, ease: [.22, 1, .36, 1] }
export const PAPER_PRESS: Transition = { duration: .09, ease: [.22, 1, .36, 1] }
/** 작은 아이콘 버튼(보이는 크기 ~22px)의 누름 — 같은 PAPER_PRESS 타이밍, 이동량만 키운다.
 * 기본 .985 는 22px 에서 0.3px 라 눈에 안 보였다(2026-09-27 배치2 #1). pointerdown 즉시 시작, 90ms 에 도달.
 * 동작 줄이기에선 paperElement 가 whileTap 을 끈다(눌림 그림자 CSS 는 남는다). */
export const ICON_PRESS = { scale: .9, transition: PAPER_PRESS } as const
// 렌더마다 새 객체를 만들지 않도록 고정 참조 (C03).
const NO_OVERRIDE = {} as const
const NO_TAP = { whileTap: undefined } as const
const DEFAULT_TAP = { whileTap: { scale: .985, transition: PAPER_PRESS } } as const
const INSTANT = { type: 'tween', duration: 0, delay: 0, repeat: 0, staggerChildren: 0, delayChildren: 0 } as const
const query = '(prefers-reduced-motion: reduce)'

// 화면 전체가 공유하는 단일 MediaQueryList + 구독 팬아웃 (2026-09-26 동작품질 C03).
// 전에는 모션 요소마다 subscribe 때 matchMedia 를 새로 만들어 리스너를 달고, getSnapshot 도
// 호출마다 새 MediaQueryList 를 만들었다 — 납부 화면 약 1,500요소 × 렌더마다.
// 지금은 matchMedia 를 모듈에서 한 번 만들고 'change' 리스너도 하나만 단다.
// window.matchMedia 함수가 바뀌면(테스트 스텁 교체) 그때만 다시 만든다 — 실제 브라우저에선 고정이다.
type ReducedMotionStore = { source: typeof window.matchMedia | undefined; media: MediaQueryList | null }
const store: ReducedMotionStore = { source: undefined, media: null }
const listeners = new Set<() => void>()
const notify = () => { for (const listener of [...listeners]) listener() }
function currentMedia(): MediaQueryList | null {
  const source = typeof window === 'undefined' ? undefined : window.matchMedia
  if (source !== store.source) {
    if (listeners.size > 0) store.media?.removeEventListener?.('change', notify)
    store.source = source
    store.media = source ? source.call(window, query) : null
    if (listeners.size > 0) store.media?.addEventListener?.('change', notify)
  }
  return store.media
}
const subscribe = (listener: () => void) => {
  const media = currentMedia()
  if (listeners.size === 0) media?.addEventListener?.('change', notify)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) store.media?.removeEventListener?.('change', notify)
  }
}
const snapshot = () => currentMedia()?.matches ?? true
const serverSnapshot = () => true

/** 이 모듈은 일반 화면에서만 import한다. 키오스크의 Framer 정책은 확장하지 않는다.
 * SSR에서는 최종 표시를 우선해 hydration 전 숫자·스켈레톤이 숨지 않게 한다. */
export function usePaperReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}

/** per-property / variant 내부 transition도 제거해야 delay·repeat가 남지 않는다. */
function instant<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, key === 'transition' ? INSTANT : typeof item === 'function'
      ? (...args: unknown[]) => instant(item(...args)) : instant(item),
  ])) as T
}

function paperElement<Tag extends 'div' | 'span' | 'button' | 'textarea'>(tag: Tag) {
  // DOM 노드를 추가하지 않고 원래 motion 요소·ref·이벤트·drag 설정을 그대로 전달한다.
  const Component = framerMotion[tag] as React.ComponentType<HTMLMotionProps<Tag> & React.RefAttributes<HTMLElementTagNameMap[Tag]>>
  const PaperElement = forwardRef<HTMLElementTagNameMap[Tag], HTMLMotionProps<Tag>>((rawProps, ref) => {
    const props = rawProps as HTMLMotionProps<Tag>
    const reduced = usePaperReducedMotion()
    const disabled = 'disabled' in props && props.disabled
    const presentation = reduced ? {
      initial: false as const,
      animate: instant(props.animate),
      exit: instant(props.exit),
      variants: instant(props.variants),
      transition: INSTANT,
      layout: false as const,
      layoutId: undefined,
      whileHover: undefined,
      whileTap: undefined,
    } : disabled ? NO_TAP : tag === 'button' && props.whileTap === undefined
      ? DEFAULT_TAP : NO_OVERRIDE
    return <Component {...props as HTMLMotionProps<Tag>} {...presentation} ref={ref} data-paper-motion="" />
  })
  PaperElement.displayName = `PaperMotion.${tag}`
  return PaperElement
}

export const motion = {
  div: paperElement('div'),
  span: paperElement('span'),
  button: paperElement('button'),
  textarea: paperElement('textarea'),
}
