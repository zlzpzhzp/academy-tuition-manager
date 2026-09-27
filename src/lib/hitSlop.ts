import type { CSSProperties } from 'react'

/**
 * 작은 아이콘 버튼의 터치 영역 확장(hit-slop) — 2026-09-27 동작품질 배치2 #1.
 * 운영자님: "청구 버튼이 누르기 불편하다" — 납부 명단의 청구·결제수단 아이콘은 보이는 크기가 22×22 px.
 *
 * 방법: 버튼 **안의** 투명 `::before`(globals.css `.hit-slop`)를 네 방향으로 늘린다.
 *  - 보이는 크기·위치·행 레이아웃은 그대로다(절대 위치 가상 요소라 흐름에 영향 없음).
 *  - 늘어난 곳을 눌러도 이벤트 대상은 **그 버튼**이라 onClick·stopPropagation·행 스와이프(포인터 이벤트 버블) 의미가 같다.
 *  - touch-action 은 건드리지 않는다(행이 소유).
 *
 * 규칙: 이웃 컨트롤과의 **간격을 반씩 나눈다** — 확장 영역끼리 절대 겹치지 않는다(탭이 이웃에 떨어지면 안 된다).
 * 이웃이 없는 쪽(행 오른쪽 끝)은 행 안쪽 여백 끝까지. 위아래는 그 줄의 세로 여백 끝까지(행 경계는 행 컨테이너
 * overflow-hidden 이 어차피 자른다 — 윗줄·아랫줄로 넘치지 않는다).
 *
 * ⚠️ 아래 수치는 납부 행의 Tailwind 클래스에서 나온 값이다. 클래스를 바꾸면 여기와
 * `src/__tests__/hitSlop.test.ts` 의 기하 검사를 같이 고쳐라(검사가 page.tsx 의 클래스 문자열을 대조한다).
 */
export interface HitSlop { t: number; r: number; b: number; l: number }

/** 납부 명단 이름 줄: `flex items-center gap-2 px-4 py-0` — 아이콘 22px 이 줄 콘텐츠 높이(22px)를 채운다.
 *  2026-09-27 운영자님 '명단 한 줄 여백 없애' → 세로 여백 0. 그래서 세로 확장도 0(윗·아랫줄 침범 금지). */
export const PAY_ROW = { gap: 8, padX: 16, padY: 0, icon: 22 } as const
/** 분할(정규·선택과목) 아이콘 두 개 묶음: `flex items-center gap-1`. */
export const PAY_SPLIT_GAP = 4
/** 인라인 납부 폼(팬): `flex items-center gap-1.5 px-4 pb-2`, 줄 높이 = 비고 입력칸 26px. */
export const PAY_FAN = { gap: 6, padX: 16, padBottom: 8, content: 26, icon: 22, pill: 24 } as const

const half = (gap: number) => gap / 2

/** 이름 줄 맨 끝 아이콘(청구·결제수단·퇴원 처리 상태·분할). 왼쪽 이웃 = 상태 배지. */
export const SLOP_ROW_TRAILING: HitSlop = { t: PAY_ROW.padY, b: PAY_ROW.padY, l: half(PAY_ROW.gap), r: PAY_ROW.padX }
/** 분할 묶음의 앞(정규) 아이콘: 왼쪽 = 상태 배지, 오른쪽 = 선택과목 아이콘. */
export const SLOP_ROW_SPLIT_FIRST: HitSlop = { t: PAY_ROW.padY, b: PAY_ROW.padY, l: half(PAY_ROW.gap), r: half(PAY_SPLIT_GAP) }
/** 분할 묶음의 뒤(선택과목) 아이콘: 왼쪽 = 정규 아이콘, 오른쪽 = 행 끝. */
export const SLOP_ROW_SPLIT_LAST: HitSlop = { t: PAY_ROW.padY, b: PAY_ROW.padY, l: half(PAY_SPLIT_GAP), r: PAY_ROW.padX }

const fanIconAbove = (PAY_FAN.content - PAY_FAN.icon) / 2
const fanPillAbove = (PAY_FAN.content - PAY_FAN.pill) / 2
/** 팬 가운데 컨트롤(납부 알약·청구서 발송 아이콘): 양옆 이웃과 간격 반씩. 위 = 이름 줄 경계, 아래 = 팬 하단 여백 끝. */
export const SLOP_FAN_PILL: HitSlop = { t: fanPillAbove, b: fanPillAbove + PAY_FAN.padBottom, l: half(PAY_FAN.gap), r: half(PAY_FAN.gap) }
export const SLOP_FAN_MIDDLE: HitSlop = { t: fanIconAbove, b: fanIconAbove + PAY_FAN.padBottom, l: half(PAY_FAN.gap), r: half(PAY_FAN.gap) }
/** 팬 맨 끝(상세 납부 기록) 아이콘: 오른쪽 = 행 끝. */
export const SLOP_FAN_LAST: HitSlop = { t: fanIconAbove, b: fanIconAbove + PAY_FAN.padBottom, l: half(PAY_FAN.gap), r: PAY_FAN.padX }

/** `.hit-slop` 과 함께 쓰는 CSS 변수 묶음. 기존 style 객체에 펼쳐 넣는다. */
export function hitSlopVars(s: HitSlop): CSSProperties {
  return { '--hit-t': `${s.t}px`, '--hit-r': `${s.r}px`, '--hit-b': `${s.b}px`, '--hit-l': `${s.l}px` } as CSSProperties
}

/** 보이는 크기 + 확장 = 실제로 눌리는 크기. */
export function hitSize(visual: { w: number; h: number }, s: HitSlop) {
  return { w: visual.w + s.l + s.r, h: visual.h + s.t + s.b }
}
