export type PaperPreference = 'auto' | 'light' | 'dark'
export type PaperScheme = 'light' | 'dark'

export const PAPER_COLORS = { light: '#f4f1ea', dark: '#161a20', kiosk: '#17171c' }
export const normalizePaperPreference = (value: unknown): PaperPreference => value === 'light' || value === 'dark' ? value : 'auto'

interface PaperController {
  preference: PaperPreference
  scheme: PaperScheme
  set: (value: PaperPreference) => void
  route: (pathname: string) => void
  subscribe: (listener: () => void) => () => void
}
declare global { interface Window { __paperScheme?: PaperController } }

/** head와 실행 중 상태의 단일 구현. 직렬화되므로 외부 런타임 참조 없이 인자로 받는다.
 * html의 data-paper-* 및 theme-color는 이 컨트롤러만 소유한다(React prop으로 렌더하지 않음). */
export function installPaperScheme(colors: typeof PAPER_COLORS, normalize: typeof normalizePaperPreference) {
  if (window.__paperScheme) return window.__paperScheme
  const root = document.documentElement
  const os = window.matchMedia('(prefers-color-scheme: dark)')
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  let preference = normalize(null)
  try { preference = normalize(localStorage.getItem('paper-scheme')) } catch { /* auto */ }
  let pathname = window.location.pathname
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let transitioning: HTMLElement[] = []
  function clearTransition() {
    clearTimeout(timer)
    root.classList.remove('paper-scheme-changing')
    for (const el of transitioning) {
      el.removeAttribute('data-paper-color-transition')
      el.style.removeProperty('--paper-color-transition')
    }
    transitioning = []
  }
  function prepareTransition() {
    clearTransition()
    // 유한한 표시 대상만. 스와이프 행도 기존 transform transition을 그대로 잇는다.
    const selector = 'html,body,nav,header,.card,.card-elevated,.row,.section-header,[data-paper-card],[data-sonner-toast],button,a,input,textarea,select,[role="button"],[data-student-row],[class*="bg-[var("],[class*="text-[var("]'
    const entries = Array.from(document.querySelectorAll<HTMLElement>(selector), el => {
      const style = getComputedStyle(el)
      const props = style.transitionProperty.split(',').map(s => s.trim())
      const durations = style.transitionDuration.split(',')
      const easings = style.transitionTimingFunction.split(/,(?![^()]*\))/)
      const delays = style.transitionDelay.split(',')
      const keep = props.flatMap((prop, i) => {
        return [prop].filter(p => !['none', 'background', 'background-color', 'color', ''].includes(p))
          .map(p => `${p} ${durations[i % durations.length]} ${easings[i % easings.length]} ${delays[i % delays.length]}`)
      })
      return { el, transition: [...keep, 'background-color 220ms ease', 'color 220ms ease'].join(',') }
    })
    // 읽기와 쓰기를 분리해 요소마다 강제 layout을 만들지 않는다.
    for (const { el, transition } of entries) {
      el.style.setProperty('--paper-color-transition', transition)
      el.setAttribute('data-paper-color-transition', '')
    }
    transitioning = entries.map(entry => entry.el)
    root.classList.add('paper-scheme-changing')
    // 시작 스타일을 확정한 뒤 속성을 바꾼다. 초기 부팅에는 실행하지 않는다.
    void getComputedStyle(root).backgroundColor
    timer = setTimeout(clearTransition, 240)
  }
  function apply(animate = false) {
    const kiosk = pathname === '/kiosk' || !!document.querySelector('[data-ui-theme="kiosk"]')
    const scheme = preference === 'auto' ? os.matches ? 'dark' : 'light' : preference
    if (animate && !kiosk && !reduced.matches && root.dataset.paperScheme !== scheme) prepareTransition()
    else clearTransition()
    root.dataset.paperScheme = scheme
    root.toggleAttribute('data-paper-kiosk', kiosk)
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[data-paper-meta]')) {
      meta.content = kiosk ? '#070b14' : colors[scheme]
      meta.setAttribute('media', meta.dataset.paperMeta === scheme ? 'all' : 'not all')
    }
    controller.preference = preference
    controller.scheme = scheme
    listeners.forEach(listener => listener())
  }
  const controller: PaperController = {
    preference, scheme: 'light',
    set(value) {
      preference = normalize(value)
      try { localStorage.setItem('paper-scheme', preference) } catch { /* 현재 문서 선택은 계속 적용 */ }
      apply(true)
    },
    route(value) { pathname = value; apply() },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  window.__paperScheme = controller
  os.addEventListener('change', () => { if (preference === 'auto') apply(true) })
  reduced.addEventListener('change', () => { if (reduced.matches) clearTransition() })
  apply()
  return controller
}

export const PAPER_SCHEME_SCRIPT = `(${installPaperScheme.toString()})(${JSON.stringify(PAPER_COLORS)},${normalizePaperPreference.toString()});`

// 본문 표식 파싱 전에는 속성이 선도색을 제공하고, kiosk 표식은 언제나 우선한다.
export const PAPER_INITIAL_STYLE = `html,body{background:${PAPER_COLORS.light};color:#241f19;margin:0;font-family:'Pretendard Variable','Pretendard',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif}
@media(prefers-color-scheme:dark){html:not([data-paper-scheme]),html:not([data-paper-scheme]) body{background:${PAPER_COLORS.dark};color:#e7eaef;color-scheme:dark}}
html[data-paper-scheme=light],html[data-paper-scheme=light] body{background:${PAPER_COLORS.light};color:#241f19;color-scheme:light}
html[data-paper-scheme=dark],html[data-paper-scheme=dark] body{background:${PAPER_COLORS.dark};color:#e7eaef;color-scheme:dark}
html[data-paper-kiosk],html[data-paper-kiosk] body,html:has([data-ui-theme=kiosk]),html:has([data-ui-theme=kiosk]) body{background:${PAPER_COLORS.kiosk};color:#ececec;color-scheme:dark}`
