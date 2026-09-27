# 스크롤 연동 모션 지침

납부 화면 헤더(월 이동·제목·상태줄)가 스크롤에 따라 줄어드는 모션을 다듬으면서 정리한 원칙이다.
스크롤에 따라 줄어들거나 접히는 UI 를 새로 만들거나 고칠 때 이 순서를 따른다.

기준 구현 = `src/components/payments/PaymentsHeader.tsx` + `PaymentsHeader.module.css`,
검증 테스트 = `src/__tests__/paymentsHeaderMotion.test.ts`, 브라우저 실측 하네스 = `tests/e2e/payments-header.mjs`.

## 증상 → 원인
- 스크롤에 따라 헤더/메모/필터가 줄어드는 UI가 **뚝뚝 끊기고, 살짝 올리면 되튕김**.
- 원인 ① 접힘/펼침 **상태기계**(threshold 넘으면 setState → 리렌더 → 레이아웃 높이 변경 → 문서 높이가 바뀌며 scrollY 가 다시 임계 아래로 → 재펼침 = 튕김).
- 원인 ② 스크롤 이벤트마다 **레이아웃 속성**(height·font-size·padding·left/right·top) 을 바꿔 매 프레임 reflow.
- 원인 ③ 요소마다 다른 타이밍/곡선으로 따로 움직여 어색함.
- 원인 ④ scrollTo 로 위치를 '보정'하는 코드(클램프 0 이 되면 메모가 다시 튀어나옴).

## 처방 (이 순서로)
1. **상태기계 제거, 자연 스크롤.** sticky 는 정말 남아야 하는 줄(월 네비·상태줄)만. 접히는 부분은 문서 흐름에 두고 그냥 스크롤로 지나가게. 문서 공간은 고정값(예: 84px)으로 예약해 높이 변화가 scrollY 를 되먹임하지 않게 한다. scrollTo 보정 금지.
2. **진행도 하나로 통일.** u = clamp(scrollY / D, 0, 1), p = u²(3−2u)(smoothstep; CSS 는 cubic-bezier(1/3,0,2/3,1) 동일). 제목·배경·화살표·상태줄 전부 이 p 하나로 보간. 구간 D 는 80~160px.
3. **transform/opacity 만 움직인다.** 글자 축소 = `scale`(transform-origin 지정), 배경 높이 = `scaleY`, 화살표 안쪽 모임 = 폭이 이동거리인 wrapper 에 `translateX(±100%·p)`, 상태줄 = `translateY`. left/right/height/font-size/padding 을 스크롤로 바꾸지 마라. 필요하면 `will-change: transform` 은 움직이는 요소에만.
4. **구동은 3단.** ① `CSS.supports('animation-timeline: scroll()')` 이면 keyframes + `animation-timeline: scroll(root block)` + `animation-range: 0 Dpx` 로 브라우저가 직접 구동(JS 0) → `data-*-motion="css"`. ② 미지원이면 **rAF 1개**가 CSS 변수(--p) 만 갱신하고 CSS 가 `calc()` 로 transform 계산 → `"fallback"`. ③ `prefers-reduced-motion` 이면 애니메이션 off + 최종 상태 고정 → `"reduced"`. 상태값을 data 속성에 박아 검증 스크립트가 어느 경로인지 읽을 수 있게.
5. **이벤트 위생.** scroll 리스너 passive, 프레임당 1회(rAF 코얼레싱), 리사이즈/폰트 변경은 ResizeObserver 로 치수 재측정(스크롤바 등장 같은 폭 변화는 resize 이벤트가 안 뜬다).
6. **그레인·블러·blend 같은 전면 오버레이는 스크롤 비용을 먼저 잰다.** 이 앱의 종이 그레인: `mix-blend-mode: multiply` → 스크롤 rAF p50 2배(33 vs 16.7ms). normal + opacity 로 교체.

## 검증 (보고 전 필수 — 캡처 한 장은 검증이 아니다)
- 실제 브라우저(시스템 크롬 headless=new + CDP)에서 **스크롤 위치별 값표**: y=0/¼D/½D/¾D/D 에서 scale·높이·translate 를 읽어 공식값과 대조(납부 헤더 표, D=120: 0/30/60/90/120 → scale 1/.9406/.81/.6794/.62).
- **튕김 재현 시퀀스**: +120,+60,−30,−30,+200,−40 스크롤 후 각 단계 scrollY 가 요청값과 같은지(보정으로 움직였는지) — 차이 0 이어야 함.
- 구동 경로 확인(data-*-motion 값), reduced-motion 컨텍스트에서 p=1 고정 확인.
- 스크롤 중 프레임 시간 p50/p95(퍼포먼스 트레이스 또는 rAF 간격) — 16.7ms 근처.
- 탭가림 5점(elementFromPoint) 회귀 0, 대비 회귀 0(디자인 하네스 있으면 같이).

## 새 화면에 적용할 때
1. 스크롤 연동 축소/접힘/패럴랙스/sticky 전환이 있는 화면을 먼저 **전부 찾는다**(grep: `onScroll`·`scrollY`·`IntersectionObserver`·`collapsed`·`sticky`·`animation-timeline`).
2. 화면별로 위 증상이 있는지 실측한다(튕김 시퀀스·프레임 시간). 문제가 없으면 기록만 남긴다.
3. 문제가 있으면 위 처방대로 고치고, 값표·튕김·구동 경로를 검증한 뒤에 병합한다.
