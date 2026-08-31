import { useState, useCallback } from 'react'

/**
 * 모달 닫기 애니메이션 트리거.
 * closing=true 로 exit 애니메이션을 켠 뒤 delay(기본 240ms) 후 실제 부모 onClose를 호출한다.
 * `<AnimatedModal open={!closing} onClose={onClose} />` 패턴과 함께 사용.
 * 중복 호출은 무시(idempotent) — 이미 닫히는 중이면 재트리거하지 않는다.
 */
export function useAnimatedClose(onCloseRaw: () => void, delay = 240) {
  const [closing, setClosing] = useState(false)
  const onClose = useCallback(() => {
    setClosing(prev => {
      if (prev) return prev
      setTimeout(() => onCloseRaw(), delay)
      return true
    })
  }, [onCloseRaw, delay])
  return { closing, onClose }
}
