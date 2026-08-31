'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ACADEMY_NAME, ACADEMY_SHORT_NAME, ACADEMY_TAGLINE } from '@/lib/branding'

type Mode = 'input' | 'success' | 'error'
type Action = 'check_in' | 'check_out'

// 여름방학 특강 기간 — 이 기간부터 방학/여름 문구를 합류시킨다 (2026-07-03 사용자 지시).
// DB tuition_special_class period_start/end 기준. 시즌 바뀌면 이 상수만 갱신.
const SPECIAL_START = '2026-07-23'
const SPECIAL_END = '2026-08-13'

// 등원 응원 문구 (상시) — 방학/여름 언급 없는 범용. 언제나 노출.
const CHEER_IN_BASE = [
  '기말고사 수고했어요! 이제 진짜 실력 쌓을 시간 📚🔥',
  '노잼기말 끝! 꿀잼 성장 시작 😎✨',
  '오늘 등원한 것만으로 이미 반은 성공 👏',
  '놀 땐 놀고 할 땐 하는 게 진짜 고수 🎯',
  '오늘의 1시간이 미래의 1등급 ⏰🥇',
  '기말은 잊어! 우린 앞만 본다 🏃‍♂️💨',
  '한 문제만 더, 그 한 문제가 등수를 바꾼다 ✨',
  '지금 흘린 땀방울, 나중에 웃음꽃 🌻😄',
  '오늘도 왔네? 역시 될 놈은 다르다 👑',
  '수학이 어렵다고? 어제의 너도 그랬어, 근데 왔잖아 💪',
  '아이스크림보다 달콤한 게 성취감이래 🍦🏅',
  '오늘의 등원 도장 쾅! 미래에 이자 붙어 돌아옴 🏦',
  '집중 30분이면 유튜브 3시간 이겨 📵📚',
  '오늘 안 온 애들은 모를 거야, 네가 앞서간 걸 🤫',
  '우리는 신나게 공부한다! 🎉📚',
  '할 때는 제대로 하는 게 우리 DNA 🧬🔥',
  '우리는 이 시간의 주인이다! ⏳🔥',
  '안 되면 될 때까지, 파이팅! 🫡🔥',
  '집중 모드 ON, 잡생각 OFF ⚡🎯',
  '한번 앉으면 끝을 본다 💪🔥',
  '핑계는 집에 두고 왔다, 오직 공부뿐 🎯',
  '못 푸는 문제는 없다, 안 푼 문제만 있다 ⚔️📖',
  '오늘의 나, 어제의 나를 이긴다 ⚡',
  '지금 이 순간 최선을 다한다, 그게 우리 정신 🔥🫡',
  '오늘도 출석 완료, 성공 예약 완료 ✅🔥',
  '공부는 배신 안 한다, 딱 한 만큼 돌려준다 💯',
  '책상 앞이 곧 나의 전쟁터 ⚔️📖',
  '지금의 집중이 미래의 여유 😎',
  '어제보다 한 뼘, 그게 쌓이면 하늘까지 🌤️📈',
  '될 때까지 하면 결국 된다, 그게 진리 🔁🔥',
  '나의 무기는 연필 한 자루 ✏️⚔️',
  '오늘 배운 거 하나, 평생 내 것 하나 💎',
  '공부 특전사, 입실 신고합니다 🫡',
  '어려울수록 재밌어지는 게 진짜 공부 🧩😏',
  '집중력은 근육이다, 오늘도 단련 💪🧠',
  '포기는 배추 셀 때나 쓰는 말 🥬🙅',
  '오늘의 문제가 내일의 기본기 🏗️',
  '남들 쉴 때 한 발, 결승선에선 열 발 🏁',
  '실력은 조용히 쌓인다, 결과는 크게 터진다 💥',
  '머리가 아니라 엉덩이로 하는 게 공부 🪑🔥',
  '오늘도 나를 이기러 왔다 🥊',
  '작은 성실이 큰 기적을 만든다 ✨',
  '여기선 조는 사람이 없다, 다 불탄다 🔥😤',
  '지금 이 순간에 집중, 나머진 나중에 🎯',
  '한 계단씩, 근데 매일 🪜',
  '오답은 창피한 게 아니라 성장의 증거 📝✅',
  '나의 페이스로, 그러나 멈추지 않고 🏃',
  '실수는 선생님, 복습은 친구 🤝',
  '오늘의 각오: 딴짓 제로, 집중 백 퍼 💯',
  '공부의 신은 성실을 좋아한다 🙏📚',
  '될 놈은 오늘도 책을 편다 📖👑',
  '뇌에 땀 나게, 오늘도 풀가동 🧠💦',
  '목표를 향해 한 문제씩 전진 ➡️🎯',
  '조용한 노력이 가장 시끄러운 결과를 낸다 🔊',
  '우리 정신: 대충은 없다 🚫😎',
  '오늘 못한 건 내일 두 배로 🔋',
  '집중하는 네 모습이 제일 멋있어 😎✨',
  '성적은 거짓말 안 한다, 노력한 만큼 나온다 📊',
  '지금 졸리면 미래가 졸린다, 정신 차려! ☕⚡',
  '한 문제 붙잡고 늘어지는 그 근성 👏🔥',
  '오늘의 목표는 딱 하나, 어제보다 잘하기 🎯',
  '공부도 운동처럼, 매일 하면 습관 🏋️📚',
  '나는 오늘도 성장 중, 로딩 99% ⏳📈',
  '어려운 문제일수록 크게 웃어주자 😆🧩',
  '지금 이 자리가 미래를 바꾸는 자리 🪑✨',
  '여기 온 이상, 대충은 용납 안 됨 🔥',
  '오늘도 스스로와의 약속을 지켰다 🤝⭐',
  '노력에 재능이 붙으면 못 이길 게 없다 💪',
  '집중 스위치 딸깍, 이제 몰입 시간 🔛🎯',
  '하기 싫을 때 하는 게 진짜 실력 😤',
  '한 장 넘길 때마다 레벨업 📖⬆️',
  '오늘의 나를 응원해, 넌 잘하고 있어 👏💖',
  '미래의 내가 지금의 나에게 고마워할 거야 🙏',
  '공부는 나를 위한 투자, 이자율 최고 💰📚',
  '딴생각 오면 문제로 쫓아낸다 🏃💭',
  '반복이 실력을 만든다, 오늘도 한 바퀴 🔁',
  '안 풀리면 될 때까지, 그게 우리 스타일 🔥',
  '오늘의 집중이 내일의 자신감 😎',
  '목표 앞에 핑계는 사치다 🚫🎯',
  '될 때까지 두드리면 문은 열린다 🚪🔨',
  '오늘도 뇌 풀가동, 엔진 시동 🔥🧠',
  '나의 성장은 아무도 못 막는다 🚀',
  '한 문제의 성취가 하루를 바꾼다 ✨',
  '공부 앞에서 우린 다 전사다 ⚔️🫡',
  '오늘 흘린 땀이 합격의 밑거름 🌱🏆',
  '집중할 땐 세상에 나와 문제뿐 🎯',
  '매일의 작은 승리가 큰 성공으로 🏅',
  '우린 여기서 함께 성장한다 🤝📈',
  '오늘도 자리에 앉은 네가 챔피언 🏆',
  '포기하지 않는 한 실패는 없다 💪',
  '지금의 노력은 배신하지 않는다 🔒✨',
  '한 걸음씩, 정상은 결국 내 발밑에 🏔️',
  '오늘의 최선이 내일의 최고를 만든다 ⭐',
  '공부는 나를 이기는 게임, 오늘도 승리 🎮🏆',
  '집중 앞에 불가능은 없다 🔥',
  '우리는 멈추지 않는다, 우리니까 🏃🔥',
  '오늘도 성실하게, 그게 최고의 재능 💎',
  '될 사람은 결국 된다, 그게 너다 👑',
  '지금 이 순간이 너의 전성기의 시작 🌟',
  '오늘도 한 뼘 자란 너, 내일이 기대돼 🌱⭐',
] as const

// 등원 응원 문구 (여름방학 특강 시즌) — SPECIAL_START(7/23)부터 CHEER_IN_BASE에 합류.
const CHEER_IN_SUMMER = [
  '다시 한번 불태워보자, 여름방학! 🔥☀️',
  '여름방학은 역전의 계절! 지금이 기회야 🚀',
  '방학 때 벌린 애가 개학 때 웃는다 😏📈',
  '에어컨 밑에서 수학 한 문제, 시원하게 뿌셔 ❄️✏️',
  '여름의 땀은 9월의 성적표로 돌아온다 💦🏆',
  '방학 = 무한 리필 성장 찬스 🍹📖',
  '더위야 덤벼라, 우린 공부로 이긴다 🥵🔥',
  '여름방학 룰: 어제의 나보다 1%만 더 🔋',
  '슬리퍼 신고 와도 좋아, 뇌만 챙겨오면 돼 🩴🧠',
  '방학 때 자는 애 옆에서 넌 달린다 🏃‍♀️💨',
  '여름방학 한 달, 인생 반 학기 뒤집기 🔄',
  '땡볕 뚫고 온 너, 이미 근성 만렙 🔥🎮',
  '방학의 밀도가 2학기를 결정한다 🧪',
  '더운 날 온 만큼 시원하게 성적 뽑자 🧊📊',
  '여름아 고마워, 덕분에 공부할 시간 많아 😆☀️',
  '지금 이 순간이 방학 최고의 선택 ⭐',
] as const

// 하원 인사 문구 — 랜덤 노출
const CHEER_OUT = [
  '오늘도 수고했어요! 조심히 가요 👏😊',
  '집 가서 푹 쉬어, 내일 또 보자 🌙',
  '오늘 한 만큼 넌 성장했어 📈 잘 가요!',
  '더운데 다니느라 고생했어 🥤 살펴 가요',
  '오늘의 미션 클리어! 🎮 내일도 화이팅',
  '수고 많았어요, 시원한 거 하나 사 먹어 🍧',
  '집까지 안전 귀가! 오늘도 최고였어 ⭐',
  '내일의 너를 위해 오늘 푹 자기 😴',
] as const

// 오늘(KST 벽시계) 날짜 문자열. 태블릿 로컬 TZ = KST 전제 (키오스크는 클라이언트 전용).
function todayKst(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function pickCheer(action: Action): string {
  if (action === 'check_out') return CHEER_OUT[Math.floor(Math.random() * CHEER_OUT.length)]
  // 여름방학 특강 기간(7/23~8/13)에만 방학 문구 합류, 그 외엔 상시 문구만
  const today = todayKst()
  const inSummer = today >= SPECIAL_START && today <= SPECIAL_END
  const pool = inSummer ? [...CHEER_IN_BASE, ...CHEER_IN_SUMMER] : CHEER_IN_BASE
  return pool[Math.floor(Math.random() * pool.length)]
}

// 키오스크 디자인 토큰 — 안드로이드 색공간 호환성 강화 (채도 + 명도 contrast 키움)
const C = {
  bg: '#070b14',           // 더 어둡게
  bgGradTop: '#0b1220',
  bgGradBottom: '#0e1730',
  surface: '#1c2940',      // 더 채도 있는 navy
  surfaceHi: '#2a3a55',
  border: '#2a3a55',
  borderSoft: 'rgba(42,58,85,0.6)',
  gold: '#e8b85c',         // 더 밝은 골드 (안드로이드에서 명확)
  goldDeep: '#c79640',
  goldDim: 'rgba(232,184,92,0.15)',
  goldBorder: 'rgba(232,184,92,0.45)',
  goldStrong: '#f5c869',   // 강조용
  emerald: '#34d399',
  emeraldDim: 'rgba(52,211,153,0.12)',
  text1: '#ffffff',
  text2: '#dfe6f0',        // 더 밝게
  text3: '#9aa9bd',
  text4: '#6b7a91',
}

export default function KioskPage() {
  const [code, setCode] = useState('')
  const [mode, setMode] = useState<Mode>('input')
  const [message, setMessage] = useState('')
  const [studentName, setStudentName] = useState('')
  const [actionType, setActionType] = useState<Action | null>(null)
  const [cheerText, setCheerText] = useState('')
  const [clockText, setClockText] = useState('')
  const resetRef = useRef<NodeJS.Timeout | null>(null)

  // 화면 절전 방지
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null
    const acquire = async () => {
      try {
        const navAny = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> } }
        if (navAny.wakeLock) wakeLock = await navAny.wakeLock.request('screen')
      } catch {}
    }
    acquire()
    const onVis = () => { if (document.visibilityState === 'visible') acquire() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      wakeLock?.release().catch(() => {})
    }
  }, [])

  // 시계
  useEffect(() => {
    const tick = () => {
      const d = new Date()
      const days = ['일','월','화','수','목','금','토']
      const h = String(d.getHours()).padStart(2, '0')
      const m = String(d.getMinutes()).padStart(2, '0')
      setClockText(`${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일 · ${h}:${m}`)
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  // 자동 버전 갱신 (2026-07-04): 배포하면 서버 버전이 바뀜 → 태블릿이 유휴(입력 대기, 코드 미입력)일 때만
  // 자동 새로고침. 상시 켜둔 키오스크에 옛 화면이 물려 새 문구가 안 뜨던 문제 해결.
  const bootVerRef = useRef<string | null>(null)
  const idleRef = useRef(false)
  useEffect(() => { idleRef.current = mode === 'input' && code === '' }, [mode, code])
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch('/api/kiosk-version', { cache: 'no-store' })
        if (!r.ok) return
        const { v } = await r.json()
        if (bootVerRef.current === null) {
          // 최초 1회만 기준 버전 기록 — 이후엔 절대 덮지 않는다.
          // (매 폴마다 덮으면 "학생 입력중이라 리로드 스킵"된 새 버전이 기준값이 돼버려
          //  이후 폴에서 v === bootVerRef로 영원히 리로드 안 되는 버그, 2026-07-10 전수점검)
          bootVerRef.current = v
        } else if (v !== bootVerRef.current && idleRef.current) {
          window.location.reload()
        }
      } catch { /* 네트워크 순단은 무시 */ }
    }
    check()
    const id = setInterval(check, 3 * 60 * 1000) // 3분마다
    return () => clearInterval(id)
  }, [])

  // 진행중 요청 무효화 토큰 — 학생 A의 느린 응답이 다음 학생 B의 화면(이름/에러)을
  // 덮어쓰는 것 방지 (2026-07-10 전수점검 M2)
  const submitSeqRef = useRef(0)
  const lastSubmitAtRef = useRef(0)

  const reset = useCallback(() => {
    submitSeqRef.current++ // 남아있는 응답 무효화
    setCode(''); setMode('input'); setMessage(''); setStudentName(''); setActionType(null)
  }, [])

  // 성공/에러 후 자동 리셋. 학생 이름 응답이 오기 전엔 리셋 타이머 시작 안 함(이름 보여줄 시간 확보).
  useEffect(() => {
    if (resetRef.current) clearTimeout(resetRef.current)
    if (mode === 'success' && studentName) resetRef.current = setTimeout(reset, 1100)
    // 이름이 안 오는 경우(응답 지연·유실)에도 상한을 걸어 무조건 입력 화면 복귀 —
    // 안 걸면 키오스크가 성공 화면에 고착돼 다음 학생이 못 찍는다 (2026-08-13 라인리뷰)
    else if (mode === 'success') resetRef.current = setTimeout(reset, 6000)
    else if (mode === 'error') resetRef.current = setTimeout(reset, 2500)
    return () => { if (resetRef.current) clearTimeout(resetRef.current) }
  }, [mode, studentName, reset])

  const onPad = useCallback((digit: string) => {
    // 결과 화면(success/error)에서 키패드 누르면 즉시 리셋 + 다음 학생 입력 시작
    if (mode === 'success' || mode === 'error') {
      if (resetRef.current) { clearTimeout(resetRef.current); resetRef.current = null }
      submitSeqRef.current++ // 이전 학생의 느린 응답이 새 입력 화면을 덮지 않게 무효화 (M2)
      setMode('input'); setMessage(''); setStudentName(''); setActionType(null)
      if (digit === '←' || digit === '_') { setCode(''); return }
      setCode(digit)
      return
    }
    if (mode !== 'input') return
    // 길이 체크를 functional updater 안에서 — 빠른 연타 시 stale closure로 4자리 초과 입력되는 것 방지
    if (digit === '←') setCode(c => c.slice(0, -1))
    else setCode(c => (c.length < 4 ? c + digit : c))
  }, [mode])

  const submit = useCallback(async (action: Action) => {
    if (code.length !== 4 || mode !== 'input') return
    // 더블탭 가드 — mode state는 같은 프레임 내 재탭에서 stale이라 시간 기반으로 차단 (M2)
    const now = Date.now()
    if (now - lastSubmitAtRef.current < 600) return
    lastSubmitAtRef.current = now
    const seq = ++submitSeqRef.current
    // Optimistic UI: 즉시 success 화면(체크표시) → API는 백그라운드. 학생 이름은 응답 오면 채움.
    setActionType(action)
    setCheerText(pickCheer(action)) // 등/하원 문구 랜덤 선택 (2026-07-03)
    setStudentName('')
    setMessage('')
    setMode('success')
    try {
      // 8초 타임아웃 — 응답이 영영 안 오면 성공 화면이 고착된다 (위 상한 타이머와 이중 방어)
      const res = await fetch('/api/attendance/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, action }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (seq !== submitSeqRef.current) return // 이미 다음 학생 입력으로 넘어감 — 화면 덮지 않기 (M2)
      if (!res.ok) {
        setMode('error'); setMessage(data.error || '처리 실패')
      } else if (!data.ok) {
        setMode('error'); setStudentName(data.student?.name ?? ''); setMessage(data.message || '이미 처리됨')
      } else {
        setStudentName(data.student.name)
      }
    } catch (e) {
      if (seq !== submitSeqRef.current) return
      setMode('error'); setMessage(e instanceof Error ? e.message : '네트워크 오류')
    }
  }, [code, mode])

  // 외부 키보드 지원
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== 'input') return
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); onPad(e.key) }
      else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); onPad('←') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, onPad])

  // 빈칸='_', 지움='←' (왼쪽 빈칸, 가운데 0, 오른쪽 지움)
  const padDigits = ['1','2','3','4','5','6','7','8','9','_','0','←']

  return (
    <div
      className="fixed inset-0 select-none touch-manipulation overflow-hidden"
      style={{
        fontFamily: '"Pretendard Variable","Pretendard",-apple-system,system-ui,sans-serif',
        background: `radial-gradient(ellipse at top, ${C.bgGradTop} 0%, ${C.bg} 50%, ${C.bgGradBottom} 100%)`,
        color: C.text1,
      }}
    >
      {/* 미세한 도트 패턴 배경 */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(${C.gold} 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }}
      />

      {/* 헤더 */}
      <header className="relative flex items-center justify-between px-12 pt-3 pb-4">
        <div className="flex items-center gap-4">
          {/* 학원 로고 — 원형 크롭.
              자기 학원 로고를 쓰려면 `public/logo.png` 를 올리고 아래 src 를 그걸로 바꾼다.
              기본값은 브랜드 없는 범용 아이콘이라 그대로 둬도 화면은 깨지지 않는다. */}
          <div
            className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center shrink-0"
            style={{ boxShadow: `0 8px 20px ${C.goldDim}`, background: '#ffffff' }}
          >
            <img
              src="/icons/icon.svg"
              alt={ACADEMY_NAME}
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <p
              className="text-[18px] font-black tracking-[0.2em]"
              style={{ color: C.gold }}
            >{ACADEMY_SHORT_NAME}</p>
            <p
              className="text-[11px] tracking-[0.3em] uppercase -mt-0.5"
              style={{ color: C.text4 }}
            >ATTENDANCE KIOSK</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[13px] tabular-nums tracking-wide" style={{ color: C.text3 }}>{clockText}</p>
        </div>
      </header>

      {/* 메인 — 가로 분할 (좌: 패드, 우: 액션) */}
      <main className="relative h-[calc(100%-128px)] grid grid-cols-[1fr_1fr] gap-12 px-12">
        <AnimatePresence mode="wait">
          {mode === 'input' && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22 }}
              className="contents"
            >
              {/* 좌: 코드 디스플레이 + 키패드 */}
              <section className="flex flex-col items-center justify-center gap-8">
                <div className="text-center">
                  <p className="text-[12px] tracking-[0.35em] uppercase mb-2" style={{ color: C.gold }}>
                    Student ID
                  </p>
                  <p className="text-[15px]" style={{ color: C.text3 }}>출결번호 4자리를 입력하세요</p>
                </div>

                {/* 4슬롯 디스플레이 */}
                <div className="flex gap-4">
                  {[0,1,2,3].map(i => {
                    const filled = !!code[i]
                    const active = !filled && i === code.length
                    return (
                      <motion.div
                        key={i}
                        animate={{ scale: active ? [1, 1.04, 1] : 1 }}
                        transition={{ duration: 1.4, repeat: active ? Infinity : 0 }}
                        className="w-[78px] h-[100px] rounded-2xl flex items-center justify-center text-[40px] font-black tabular-nums transition-all"
                        style={{
                          background: filled ? C.surface : 'transparent',
                          border: `2px solid ${filled ? C.goldBorder : active ? C.gold : C.borderSoft}`,
                          color: C.text1,
                          boxShadow: filled ? `inset 0 1px 0 ${C.borderSoft}` : 'none',
                        }}
                      >
                        {code[i] || (active ? <span className="w-1 h-8 rounded-full" style={{ background: C.gold }} /> : '')}
                      </motion.div>
                    )
                  })}
                </div>

                {/* 키패드 — 큰 버튼 */}
                <div className="grid grid-cols-3 gap-3 w-full max-w-[380px]">
                  {padDigits.map((d, i) => {
                    if (d === '_') return <div key={i} aria-hidden />
                    const isBack = d === '←'
                    return (
                      <motion.button
                        key={i}
                        type="button"
                        whileTap={{ scale: 0.92 }}
                        // 터치 즉시 반응 — onClick은 태블릿에서 살짝 움직이거나 빠른 연타 시 씹힘.
                        // onPointerDown으로 손가락 닿는 순간 입력. 이후 click 중복 방지(preventDefault).
                        onPointerDown={(e) => { e.preventDefault(); onPad(d) }}
                        className="h-[78px] rounded-2xl text-[26px] font-bold transition-colors touch-manipulation"
                        style={{
                          background: isBack ? 'transparent' : C.surface,
                          color: isBack ? C.text3 : C.text1,
                          border: `1px solid ${isBack ? C.borderSoft : C.border}`,
                          boxShadow: isBack ? 'none' : `0 4px 12px rgba(0,0,0,0.25)`,
                          touchAction: 'manipulation',
                          WebkitTapHighlightColor: 'transparent',
                          userSelect: 'none',
                        }}
                        aria-label={isBack ? '지우기' : `${d} 입력`}
                      >
                        {isBack ? (
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto">
                            <path d="M21 5H8L3 12l5 7h13a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/>
                            <path d="m18 9-6 6"/><path d="m12 9 6 6"/>
                          </svg>
                        ) : d}
                      </motion.button>
                    )
                  })}
                </div>
              </section>

              {/* 우: 학원 비주얼 + 등원/하원 액션 */}
              <section className="flex flex-col justify-center gap-6">
                {/* 브랜드 디스플레이 */}
                <div
                  className="rounded-3xl p-8 text-center relative overflow-hidden"
                  style={{
                    background: `linear-gradient(135deg, ${C.surface} 0%, ${C.bg} 100%)`,
                    border: `1px solid ${C.borderSoft}`,
                  }}
                >
                  {/* 골드 광선 */}
                  <div
                    className="absolute -top-20 -right-20 w-60 h-60 rounded-full pointer-events-none"
                    style={{ background: `radial-gradient(circle, ${C.goldDim} 0%, transparent 70%)` }}
                  />
                  <p className="text-[11px] tracking-[0.3em]" style={{ color: C.gold }}>WELCOME TO</p>
                  <h1 className="text-[38px] font-black leading-tight tracking-tight mt-2" style={{ color: C.text1 }}>
                    {ACADEMY_NAME}
                  </h1>
                  <div className="mt-3 mx-auto w-12 h-[2px]" style={{ background: C.gold }} />
                  <p className="text-[13px] mt-3" style={{ color: C.text3 }}>오늘도 화이팅 하세요!</p>
                </div>

                {/* 액션 버튼 */}
                <div className="grid grid-cols-2 gap-3">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => submit('check_in')}
                    disabled={code.length !== 4}
                    className="h-[110px] rounded-2xl font-black flex flex-col items-center justify-center gap-1 transition-all disabled:cursor-not-allowed"
                    style={{
                      background: code.length === 4 ? C.gold : C.surface,
                      color: code.length === 4 ? C.bgGradTop : C.text4,
                      border: `1px solid ${code.length === 4 ? C.gold : C.borderSoft}`,
                      boxShadow: code.length === 4 ? `0 12px 28px ${C.goldDim}, 0 0 0 4px ${C.goldDim}` : 'none',
                    }}
                  >
                    <span className="text-[10px] tracking-[0.3em] opacity-70">ARRIVED</span>
                    <span className="text-[28px]">등원</span>
                  </motion.button>

                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => submit('check_out')}
                    disabled={code.length !== 4}
                    className="h-[110px] rounded-2xl font-black flex flex-col items-center justify-center gap-1 transition-all disabled:cursor-not-allowed"
                    style={{
                      background: code.length === 4 ? C.surface : C.surface,
                      color: code.length === 4 ? C.gold : C.text4,
                      border: `1px solid ${code.length === 4 ? C.goldBorder : C.borderSoft}`,
                      boxShadow: code.length === 4 ? `inset 0 0 0 1px ${C.goldBorder}` : 'none',
                    }}
                  >
                    <span className="text-[10px] tracking-[0.3em] opacity-70">GOING HOME</span>
                    <span className="text-[28px]">하원</span>
                  </motion.button>
                </div>

                <p className="text-center text-[12px]" style={{ color: C.text4 }}>
                  처리 시 학부모님께 카카오 알림톡이 발송됩니다
                </p>
              </section>
            </motion.div>
          )}

          {/* 'submitting' 분기는 optimistic UI(즉시 success) 전환으로 도달 불가가 되어 제거 (2026-08-13 라인리뷰) */}
          {mode === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="col-span-2 relative flex flex-col items-center justify-center gap-6 text-center"
            >
              {/* 골드 빛 배경 — 펄스 */}
              <motion.div
                className="absolute inset-0 pointer-events-none"
                animate={{ scale: [1, 1.08, 1], opacity: [0.55, 0.95, 0.55] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                style={{ background: `radial-gradient(circle at center, ${C.goldDim} 0%, transparent 55%)` }}
              />

              {/* 떠오르는 스파클 */}
              {Array.from({ length: 14 }).map((_, i) => {
                const left = (i * 7.3 + 8) % 92
                const top = 30 + ((i * 11) % 45)
                const delay = (i * 0.13) % 1.5
                const dur = 1.6 + (i % 5) * 0.18
                const size = 4 + (i % 3) * 2
                return (
                  <motion.div
                    key={i}
                    className="absolute rounded-full pointer-events-none"
                    style={{ width: size, height: size, top: `${top}%`, left: `${left}%`, background: i % 2 === 0 ? C.gold : C.goldStrong, boxShadow: `0 0 8px ${C.gold}` }}
                    animate={{ y: [0, -60, -90], opacity: [0, 1, 0], scale: [0.4, 1, 0.3] }}
                    transition={{ duration: dur, delay, repeat: Infinity, ease: 'easeOut' }}
                  />
                )
              })}

              {/* 체크/손 아이콘 — 부드러운 회전 + spring */}
              <motion.div
                initial={{ scale: 0.4, opacity: 0, rotate: -25 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 180, damping: 14 }}
                className="w-32 h-32 rounded-full flex items-center justify-center relative"
                style={{
                  background: C.gold,
                  boxShadow: `0 20px 60px ${C.goldDim}, 0 0 0 16px ${C.goldDim}`,
                }}
              >
                {actionType === 'check_in' ? (
                  <motion.svg
                    width="56" height="56" viewBox="0 0 24 24" fill="none" stroke={C.bgGradTop} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ delay: 0.18, duration: 0.5, ease: 'easeOut' }}
                  >
                    <motion.polyline points="20 6 9 17 4 12" />
                  </motion.svg>
                ) : (
                  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke={C.bgGradTop} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 11V6a3 3 0 0 1 6 0v5"/>
                    <path d="M5 11h14l-1 9H6l-1-9Z"/>
                    <path d="M12 15v2"/>
                  </svg>
                )}
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18, duration: 0.3 }}
                className="relative"
              >
                <p
                  className="text-[12px] tracking-[0.35em] mb-3"
                  style={{ color: C.gold }}
                >
                  {actionType === 'check_in' ? 'WELCOME' : 'SEE YOU TOMORROW'}
                </p>
                {studentName ? (
                  <>
                    <motion.h1
                      key={studentName}
                      initial={{ opacity: 0, y: 16, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 240, damping: 22 }}
                      className="text-[68px] font-black leading-tight tracking-tight"
                      style={{ color: C.text1 }}
                    >
                      {studentName}
                    </motion.h1>
                    <motion.p
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.18, duration: 0.35 }}
                      className="text-[30px] font-black mt-4"
                      style={{
                        background: `linear-gradient(120deg, ${C.gold} 0%, ${C.goldStrong} 50%, ${C.gold} 100%)`,
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                      }}
                    >
                      {cheerText || (actionType === 'check_in' ? '오늘도 화이팅입니다! 💪✨' : '오늘도 수고하셨습니다! 👏😊')}
                    </motion.p>
                  </>
                ) : (
                  <p className="text-[24px] font-bold mt-2" style={{ color: C.text3 }}>
                    확인 중...
                  </p>
                )}
              </motion.div>

              {studentName && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5, duration: 0.4 }}
                  className="text-[12px] mt-2 relative"
                  style={{ color: C.text4 }}
                >
                  학부모님께 알림톡을 발송했습니다
                </motion.p>
              )}
            </motion.div>
          )}

          {mode === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="col-span-2 flex flex-col items-center justify-center gap-5 text-center px-12"
            >
              <div
                className="w-24 h-24 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(239,68,68,0.12)', border: '2px solid rgba(239,68,68,0.5)' }}
              >
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="8" x2="12" y2="13"/>
                  <line x1="12" y1="16.5" x2="12" y2="16.6"/>
                  <circle cx="12" cy="12" r="10"/>
                </svg>
              </div>
              {studentName && (
                <h2 className="text-[28px] font-bold" style={{ color: C.text1 }}>{studentName}</h2>
              )}
              <p className="text-[18px] max-w-md" style={{ color: C.text2 }}>{message}</p>
              <p className="text-[11px] tracking-widest" style={{ color: C.text4 }}>잠시 후 자동으로 다시 입력할 수 있습니다</p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 푸터 — 학원 이름과 한 줄 슬로건. 슬로건은 NEXT_PUBLIC_ACADEMY_TAGLINE 로 바꾼다. */}
      <footer className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-3">
        <span className="text-[10px] tracking-[0.3em]" style={{ color: C.text4 }}>{ACADEMY_NAME}</span>
        {ACADEMY_TAGLINE && (
          <>
            <span className="w-[3px] h-[3px] rounded-full" style={{ background: C.text4 }} />
            <span className="text-[10px] tracking-widest" style={{ color: C.text4 }}>{ACADEMY_TAGLINE}</span>
          </>
        )}
      </footer>
    </div>
  )
}

type WakeLockSentinel = { release(): Promise<void> }
