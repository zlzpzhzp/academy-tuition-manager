# 원비관리 (Tuition Manager)

학원 하나를 실제로 굴리면서 만든 **원비·청구·출결 관리 시스템**입니다.
학생 명단과 반 편성, 매달 나가는 원비 청구서, 납부 확인, 출결, 강사 급여 정산까지
한 사람이 관리자 계정 하나로 처리하는 걸 전제로 설계했습니다.

Next.js(App Router) + Supabase 위에 올라가 있고, **Supabase 프로젝트만 있으면 바로 뜹니다.**
결제 대행사·문자·AI 연동은 전부 선택이라, 키가 없으면 그 기능만 빠지고 나머지는 그대로 돕니다.

> ⚠️ **원래 특정 학원 내부용으로 만든 코드를 공개용으로 정리한 것입니다.**
> 학생 실명·연락처·실제 사건 기록은 전부 제거하거나 예시로 바꿨습니다.
> 코드 주석에 남아 있는 "왜 이렇게 했는가"는 대부분 **실제로 사고가 났던 자리**라
> 일부러 남겨뒀습니다 — 지우기 전에 한 번 읽어보시길 권합니다.

---

## 스크린샷

> 아래 화면의 이름·연락처·금액은 전부 가상의 데모 데이터입니다. 실제 학생 정보가 아닙니다.
> (DB 없이 격리 빌드를 띄우고 모든 API 응답을 데모 JSON 으로 가로채서 찍었습니다.)

### 납부 관리 — 이 앱의 중심 화면

학년 → 반 → 학생 트리. 학생마다 이번 달 상태(완납·미납·부분납)와 결제 수단이 한 줄에 붙습니다.
완납된 반은 접히고, 미납이 남은 반은 펼쳐진 채로 눈에 띕니다. 상단 헤더는 스크롤하면
제목·배경·화살표가 한 진행도에 맞춰 부드럽게 줄어듭니다(아래 [디자인과 동작](#디자인과-동작) 참조).

![납부 관리](docs/screenshots/payments.png)

### 어두운 화면 톤

설정에서 **자동(OS 따라가기) / 밝게 / 어둡게** 를 고릅니다. 밝은 쪽은 아이보리 종이 질감,
어두운 쪽은 남색 잉크 톤입니다. 첫 화면이 그려지기 전에 톤이 정해져서 깜빡임이 없습니다.

| 납부 (어둡게) | 대시보드 (어둡게) |
|---|---|
| ![납부 어둡게](docs/screenshots/payments-dark.png) | ![대시보드 어둡게](docs/screenshots/dashboard-dark.png) |

### 대시보드

재원생 수, 납부율, 수납액(지난달 대비), 미납 인원. 이번 달 신규·퇴원과 월별 매출 미니 카드도 함께 봅니다.

![대시보드](docs/screenshots/dashboard.png)

### 월별 매출 추이

수납·예정 원비·특강 매출을 월별 선으로, 선생님·과목·결제수단별 구성을 누적 막대로 봅니다.
차트는 외부 라이브러리 없이 SVG 로 직접 그립니다.

![월별 매출](docs/screenshots/stats.png)

### 청구서 (결제 대행사 연동)

발송·수납 현황을 최신순으로. "3일 이상 미결제"처럼 사람이 손을 대야 하는 건을 위로 올립니다.

![청구서](docs/screenshots/billing.png)

### 출결

날짜별 출·지·조·결·보 기록. 반 칩으로 필터링하고, 저장은 자동입니다.

![출결](docs/screenshots/attendance.png)

### 출결 키오스크

학원 입구 태블릿에 띄워두는 전체화면 모드. 학생이 자기 코드 4자리를 누르면
등·하원이 기록되고 학부모에게 알림톡이 나갑니다. 오늘이 그 학생의 수업일이 아니면
기록하기 **전에** 한 번 더 확인합니다(번호 한 자리 오입력으로 엉뚱한 학부모에게 알림이 가는 걸 막기 위해).

![키오스크](docs/screenshots/kiosk.png)

<details>
<summary><b>그 밖의 화면</b> — 재무 · 학생 관리 · 설정 · 특강 · AI 에이전트 · 로그인</summary>

| | |
|---|---|
| **재무 (PIN 게이트 뒤)** ![재무](docs/screenshots/finance.png) | **학생 관리** ![학생](docs/screenshots/students.png) |
| **설정 (학년·반 편성·화면 톤)** ![설정](docs/screenshots/settings.png) | **특강** ![특강](docs/screenshots/special.png) |
| **AI 에이전트** ![AI](docs/screenshots/agent.png) | **로그인** ![로그인](docs/screenshots/login.png) |

</details>

<details open>
<summary><b>모바일</b> — 실제로는 폰에서 더 많이 씁니다</summary>

원비 확인과 출결 체크는 앉아서 하는 일이 아니라 오가면서 하는 일이라,
모바일 레이아웃이 곁다리가 아니라 주 사용 환경에 가깝습니다. PWA로 설치도 됩니다.

| 납부 | 납부 (스크롤 중 — 월 이동 줄만 고정) | 납부 (어둡게) |
|---|---|---|
| <img src="docs/screenshots/mobile-payments.png" width="240"> | <img src="docs/screenshots/mobile-payments-scrolled.png" width="240"> | <img src="docs/screenshots/mobile-payments-dark.png" width="240"> |

| 대시보드 | 월별 매출 | 출결 |
|---|---|---|
| <img src="docs/screenshots/mobile-dashboard.png" width="240"> | <img src="docs/screenshots/mobile-stats.png" width="240"> | <img src="docs/screenshots/mobile-attendance.png" width="240"> |

</details>

## 뭘 하는 앱인가

**핵심은 "이번 달에 누가 얼마를 안 냈는가"를 틀리지 않게 아는 것입니다.**
그 한 줄이 생각보다 어렵습니다 — 월중에 들어오고 나가는 학생, 반을 옮긴 학생,
선택과목을 추가한 학생, 이월금이 있는 학생, 분할 납부한 학생이 매달 섞이기 때문입니다.

- **납부 관리** — 학년 → 반 → 학생 트리. 학생별 월 납부 상태(완납/미납/부분납)를 한 화면에.
  반이 통째로 완납이면 접히고, 미납이 하나라도 있으면 펼쳐진 채로 눈에 띕니다.
- **청구서 발송** — 결제 대행사 API로 학부모에게 결제 링크 발송. 일괄/개별/분할 발송,
  재발송, 파기, 취소(환불), 퇴원 정산 재청구까지. **이중청구 가드가 여러 겹 들어가 있습니다.**
- **출결** — 날짜별 출/지/조/결/보 기록. 전용 **키오스크 화면**이 따로 있어서
  학생이 태블릿에 자기 코드를 눌러 등·하원하면 학부모에게 알림톡이 나갑니다.
  학생별로 **추가 수신 번호**(예: 돌봄 선생님)를 두면 양쪽에 같이 보냅니다.
- **특강** — 정규 수업과 별개로 기간을 정해 열리는 수업. 그룹 편성과 별도 정산.
- **재무** — 월별 매출·지출·강사 급여 배분. 관리자 로그인 위에 **PIN 한 겹을 더** 씌웠습니다.
- **월별 매출 추이** — 수납·예정 원비·특강을 월별로, 선생님·과목·결제수단별 구성과 함께.
- **청구지연 필터** — 결제일이 지났는데 그 달 청구서가 아직 안 나간 학생만 모아 봅니다.
  결제일 달력에서 늦은 날짜가 빨갛게 표시되고, 그대로 일괄 발송 대상이 됩니다.
- **AI 에이전트** — "이번 달 미납인 고2 학생 보여줘" 같은 자연어로 명단을 걸러냅니다.
  1순위 모델이 막히면 다른 실패 도메인의 모델로 넘어가는 폴백 체인이 있습니다.
- **감사 로그** — 돈과 학생 정보를 바꾼 모든 행위를 기록합니다. 지운 적 없이 쌓입니다.

### 설계에서 양보하지 않은 것들

이 앱은 **돈과 학부모 연락을 다룹니다.** 그래서 몇 가지는 편의보다 안전을 택했습니다.

- **DELETE 를 쓰지 않습니다.** 결제·학생·청구 기록은 상태만 바뀌고 행은 남습니다.
  퇴원도 삭제가 아니라 `withdrawal_date` 를 채우는 일입니다.
- **폴백보다 실패를 택합니다.** 결제 API URL 이 없으면 기본값으로 조용히 발사하지 않고
  그 자리에서 던집니다. 돈이 걸린 경로에서 "조용히 틀림"은 최악입니다.
- **발송은 사람이 누릅니다.** 자동 재발송은 의도적으로 꺼져 있습니다.
- **타임존은 KST 고정입니다.** 날짜 경계가 곧 청구 월이라 `toISOString()` 계열은
  코드에서 금지돼 있습니다(`src/lib/date.ts` 참조).
- **결과가 불명확하면 재시도하지 않습니다.** 결제 대행사 호출이 타임아웃 등으로 끝나 성공 여부를
  알 수 없으면 '실패'로 기록하고 사람에게 넘깁니다 — 자동 재시도는 이중 청구의 지름길입니다.
  같은 학생·같은 달 청구는 프로세스 안에서 키별 락(`src/lib/keyedLock.ts`)으로 직렬화합니다.
- **조회가 실패하면 쓰기를 막습니다(fail-closed).** 돈이 걸린 경로에서 선조회 에러를
  "기록 없음"으로 읽으면 중복 청구·잘못된 환불로 이어집니다.
- **퇴원생 문자는 '정산 종결' 뒤에 막습니다.** 퇴원 직후가 정산 안내가 가장 필요한 때라,
  퇴원 표시만으로 막지 않고 정산 상태 전체를 종합해 판정합니다.

### 디자인과 동작

기능만큼 **끊김 없는 동작**을 완료 기준으로 봅니다.

- **종이 테마** — 밝은 아이보리(D3) 바탕에 얇은 그레인. 그레인은 스크롤 비용을 재 보고
  `mix-blend-mode: normal` + 낮은 불투명도로 골랐습니다(`multiply` 는 스크롤 프레임 시간을 두 배로 늘렸습니다).
- **어두운 톤(남색 잉크)** — 색은 전부 CSS 토큰이고 밝음·어두움 두 블록에 같이 정의됩니다.
  두 톤 모두 **본문 대비 4.5:1 이상**을 단위 테스트가 검사합니다(`darkPaperTheme.test.ts`).
  톤 결정은 `src/lib/paperScheme.ts` 한 곳이 맡고, 첫 페인트 전에 `<html>` 에 박아 깜빡임을 없앱니다.
- **스크롤 연동 헤더** — 접힘 상태기계 없이 자연 스크롤. 진행도 하나(smoothstep)로 모든 요소를 보간하고
  transform 만 움직입니다. 지원 브라우저에선 CSS `animation-timeline: scroll()` 이 JS 없이 구동하고,
  아니면 rAF 1개가 CSS 변수만 갱신합니다. 원칙은 [`docs/design/GUIDE-scroll-motion.md`](docs/design/GUIDE-scroll-motion.md).
- **모달** — 가운데 모달은 네 모서리가 같은 둥글기, 바텀시트는 위만 둥글게. 내용이 길어도
  닫기 버튼이 화면 밖으로 밀리지 않게 본문만 스크롤합니다.
- **당겨서 새로고침·스켈레톤·터치 여유(hit-slop)** — 여러 데이터 소스를 기다리는 화면은
  모두 도착하기 전까지 '비어 있음'을 그리지 않습니다(빈 상태가 잠깐 떴다 사라지는 깜빡임 방지).
- **동작 줄이기(reduced motion)** 를 켜면 애니메이션 대신 최종 상태로 바로 갑니다.

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│  브라우저 (React 19 · Tailwind v4 · SWR · Framer Motion) │
└───────────────────────┬─────────────────────────────────┘
                        │  세션 쿠키(HMAC 서명)
┌───────────────────────▼─────────────────────────────────┐
│  Next.js 16 App Router                                   │
│   · middleware.ts   전 경로 인증 게이트 (Edge 런타임)     │
│   · app/api/*       서버 라우트 — 여기서만 DB에 닿는다    │
└───┬──────────────┬──────────────┬───────────────┬───────┘
    │              │              │               │
┌───▼────┐  ┌──────▼──────┐  ┌────▼─────┐  ┌──────▼──────┐
│Supabase│  │ 결제 대행사  │  │  문자·   │  │   Gemini    │
│Postgres│  │  (PaySsam)  │  │ 알림톡   │  │  (AI 필터)  │
│service_│  │  청구·결제   │  │ (Solapi) │  │             │
│  role  │  │             │  │          │  │             │
└────────┘  └─────────────┘  └──────────┘  └─────────────┘
   필수          선택             선택           선택
```

**인증**: 관리자 단일 계정. 아이디/비밀번호로 로그인하면 HMAC 서명 쿠키(`auth_token`)를 받고,
미들웨어가 모든 경로에서 검증합니다. API 라우트에서도 한 번 더 확인합니다(방어 이중화).
재무 화면은 그 위에 PIN 쿠키(`finance_session`)를 한 겹 더 요구합니다.

**DB 접근**: 브라우저는 Supabase 에 **직접 닿지 않습니다.** 서버 라우트가 `service_role` 키로
접근하고, 모든 테이블은 RLS 가 켜진 채 정책이 없습니다 = 공개 `anon` 키로는 아무것도 안 보입니다.
(자세한 이유는 아래 [보안](#보안) 참조.)

### 디렉토리

```
src/
├── app/
│   ├── api/           서버 라우트 (DB·외부 API 접근은 전부 여기)
│   ├── payments/      납부 관리 — 이 앱의 메인 화면
│   ├── billing/       청구서 발송·상태
│   ├── attendance/    출결 기록
│   ├── kiosk/         학생용 등·하원 키오스크 (풀스크린)
│   ├── special/       특강
│   ├── finance/       재무 (PIN 게이트)
│   ├── settings/      학년·반 편성, 화면 톤, 감사 로그
│   ├── stats/         월별 매출 추이
│   └── dashboard/     요약
├── components/        모달·UI (payments/PaymentsHeader 스크롤 모션, stats/ SVG 차트, paperMotion 공용 모션)
├── lib/
│   ├── branding.ts    ⚙️ 학원 이름·연락처 (환경변수 진입점)
│   ├── paperScheme.ts 화면 톤(밝게/어둡게/자동) 단일 컨트롤러
│   ├── keyedLock.ts   같은 학생·같은 달 발송 직렬화
│   ├── geminiModel.ts AI 모델 선택·폴백 체인
│   ├── payssam.ts     결제 대행사 어댑터 — 다른 대행사로 바꾸려면 여기만
│   ├── solapi.ts      문자·알림톡 어댑터
│   ├── auth.ts        세션·PIN 토큰 (Node 런타임)
│   ├── hmac-edge.ts   HMAC 코어 (Edge 런타임 — 미들웨어용)
│   ├── date.ts        KST 날짜 유틸 (⚠️ 여기 규칙을 어기면 청구 월이 틀어진다)
│   └── utils.ts       납부 상태 판정 로직
├── types/index.ts     도메인 타입 (테이블 구조와 대체로 1:1)
└── __tests__/         단위 테스트 975개
supabase/
├── schema.sql         전체 스키마 (여기부터 시작)
├── migrations/        기존 설치본용 증분 마이그레이션 (새로 설치하면 불필요)
└── seed-demo.sql      데모 데이터 (연예인 이름 40명)
tests/e2e/             Playwright 하네스 — 합성 데이터·격리 서버에서만 도는 화면·모션 실측
docs/design/           설계 지침 (스크롤 모션)
```

---

## 설치

### 필요한 것

- Node.js 20 이상
- Supabase 프로젝트 (무료 티어로 충분합니다)
- *(선택)* 결제 대행사 API 키, 문자 대행사 계정, Gemini API 키

### 1. 클론 & 설치

```bash
git clone <이 저장소>
cd tuition-manager
npm install
```

### 2. Supabase 프로젝트 만들고 스키마 적용

1. [supabase.com](https://supabase.com) 에서 새 프로젝트 생성
2. 대시보드 → **SQL Editor** → `supabase/schema.sql` 내용을 통째로 붙여넣고 **Run**
   (여러 번 실행해도 안전하게 짜여 있습니다)
3. 화면을 채워놓고 둘러보고 싶다면 `supabase/seed-demo.sql` 도 같은 방법으로 실행
   — 학년·반·학생 40명과 납부·청구 샘플이 들어갑니다. **운영 DB 에는 넣지 마세요.**
4. **이미 예전 버전으로 운영 중이라면** `supabase/migrations/` 의 파일을 날짜 순서로 한 번씩 실행하세요
   (`schema.sql` 을 다시 돌려도 됩니다 — 없는 컬럼만 추가하도록 짜여 있습니다).

### 3. 환경변수

```bash
cp .env.example .env.local
```

`.env.local` 을 열어 최소한 이 다섯 개를 채웁니다:

| 변수 | 어디서 얻나 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → Data API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → `service_role` |
| `ADMIN_ID` / `ADMIN_PASSWORD` | 직접 정합니다 (관리자 단일 계정) |
| `SESSION_SECRET` | `openssl rand -base64 48` |

나머지 변수는 전부 선택입니다 — `.env.example` 에 무엇이 무엇인지 다 적어놨습니다.

### 4. 실행

```bash
npm run dev          # 개발 서버 → http://localhost:3000
```

배포용 빌드:

```bash
npm run build && npm start
```

`/login` 에서 `ADMIN_ID` / `ADMIN_PASSWORD` 로 들어갑니다.

### 5. 검증

```bash
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # vitest (975개)
```

이 세 개가 CI(`.github/workflows/ci.yml`)에서 도는 것과 같습니다.

---

## 환경변수

전체 목록과 설명은 **[`.env.example`](.env.example)** 에 있습니다. 요약하면:

| 그룹 | 필수? | 없으면 |
|---|---|---|
| Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) | ✅ | 앱이 뜨지 않음 |
| 인증 (`ADMIN_ID`, `ADMIN_PASSWORD`, `SESSION_SECRET`) | ✅ | 로그인 불가 |
| 브랜딩 (`NEXT_PUBLIC_ACADEMY_*`) | — | "우리학원" 기본값으로 표시 |
| 결제 (`PAYSSAM_*`) | — | 청구서 발송만 실패, 나머지 정상 |
| 문자 (`SOLAPI_*`) | — | 알림톡·문자만 안 나감 |
| AI (`GEMINI_API_KEY`) | — | AI 필터만 500 |
| 재무 PIN (`FINANCE_PIN`) | — | 재무 화면 진입 불가 (fail-closed) |
| 크론 (`CRON_SECRET`) | — | 예약 발송 라우트가 항상 401 |
| Sentry (`SENTRY_*`) | — | 에러 추적 없이 정상 동작 |

> 🔴 `NEXT_PUBLIC_` 이 붙은 값은 **브라우저 번들에 그대로 실립니다.**
> 비밀값에 이 접두사를 붙이지 마세요. 특히 `SUPABASE_SERVICE_ROLE_KEY` 는 절대로.

---

## 외부 연동

### 결제선생 (PaySsam) — 청구서 결제

한국의 학원 청구서 결제 서비스입니다(페이민트 운영). 학부모에게 카카오톡/문자로 결제 링크를
보내고, 결제되면 콜백으로 우리 DB 에 반영됩니다.

- **파트너 API 키는 영업 계약 후 발급됩니다** — 개인이 가입 즉시 받을 수 있는 종류가 아닙니다.
- `PAYSSAM_CALLBACK_URL` 은 **공개 URL 이어야** 합니다(대행사 서버가 우리를 호출해야 하므로).
  로컬 개발 중이라면 터널링 도구가 필요합니다.
- 콜백 라우트는 인증 미들웨어에서 제외돼 있고, 대신 요청 본문의 `apikey` 를
  상수시간 비교로 검증합니다. **키가 설정 안 돼 있으면 전부 거부합니다**(fail-closed).

**다른 결제 대행사를 쓰고 싶다면** `src/lib/payssam.ts` 하나만 갈아끼우면 됩니다.
호출부(청구서 발송·취소·파기 라우트)는 전부 그 모듈의 함수만 부릅니다.

`src/lib/payssam.ts` 의 `TEST_MODE` 를 `true` 로 두면 실제 발송 없이 성공 응답만 돌려주므로,
계약 전이나 리허설에 쓸 수 있습니다. **운영 배포 전에 `false` 인지 반드시 확인하세요.**

### Solapi — 문자·알림톡

등·하원 알림, 미납 안내에 씁니다. 발신번호 사전등록과 카카오 알림톡 템플릿 심사가 필요합니다.
템플릿 ID 가 없으면 알림톡 대신 일반 문자로 폴백합니다.

### Google Gemini — AI 에이전트

`/agent` 화면과 납부 페이지의 AI 필터가 씁니다.
[aistudio.google.com/apikey](https://aistudio.google.com/apikey) 에서 발급합니다.

AI 는 **읽기 전용 도구만** 씁니다 — 명단을 조회하고 계산해서 답할 뿐,
발송하거나 데이터를 고치지 않습니다. 이건 의도된 경계입니다(`src/lib/agentTools.ts`).

---

## 보안

몇 가지는 실제로 사고가 나서 이렇게 된 것들입니다. 고치기 전에 이유를 읽어주세요.

### RLS + GRANT

- 모든 테이블에 **RLS 를 켜고, `anon`/`authenticated` 정책은 만들지 않습니다.**
- 앱은 서버에서 `service_role` 키로 접근하고, 이 키는 RLS 를 우회합니다.
- 결과: 브라우저에 노출되는 공개 키(`anon`)로는 **아무 테이블도 보이지 않습니다.**

> 🔴 편하다고 `CREATE POLICY "allow all" ... USING (true)` 를 추가하지 마세요.
> 그 순간 공개 키를 가진 누구나 전교생 이름·학부모 전화번호·결제 내역을 덤프할 수 있습니다.
> 이 저장소의 원본에서 실제로 그런 상태였던 시기가 있었고, 급히 봉합한 흔적이
> `supabase/legacy/supabase-migration-rls-enable.sql` 에 남아 있습니다.

- 새 테이블을 추가할 때는 `ENABLE ROW LEVEL SECURITY` 를 **같은 마이그레이션에** 넣으세요.
  RLS 를 안 켜면 정책이 없어도 열립니다 — 정책 유무와 RLS 활성화는 별개 차원입니다.

### 그 밖에

- **HMAC 비교는 상수시간으로.** `a === b` 는 첫 불일치 바이트에서 조기 리턴하므로
  서명을 한 바이트씩 맞춰가는 timing oracle 이 성립합니다
  (`safeEqual` in `src/lib/auth.ts`, `verify` in `src/lib/hmac-edge.ts`).
- **PIN 은 서버에서만 비교합니다.** 실패 횟수를 IP 단위로 세서 잠급니다(`src/lib/pin-lockout.ts`).
- **에러 리포트에서 개인정보를 지웁니다.** 이름·전화번호·PIN 이 Sentry 로 새 나가지 않도록
  `beforeSend` 에서 마스킹합니다(`src/lib/sentryMask.ts`).
- **CSP·보안 헤더**가 `next.config.ts` 에 박혀 있습니다.
- **알림 착지점 트립와이어**: 사람에게 무언가를 보내는 코드가 새로 생기면
  `src/__tests__/alertLanding.test.ts` 가 깨집니다. 착지점(학부모인가 운영자인가)을
  의식적으로 정하고 등록하게 만드는 장치입니다. 🔴 **착지점이 학부모인 경로에
  고장을 주입해 시험하지 마세요 — 가짜 알림이 실제 학부모에게 갑니다.**

---

## 자기 학원에 맞추기

대부분은 환경변수로 됩니다. 코드를 고쳐야 하는 곳은 이 정도입니다:

| 무엇 | 어디 |
|---|---|
| 학원 이름·연락처·청구서 문구 | `.env.local` (`NEXT_PUBLIC_ACADEMY_*`) |
| 로고 | `public/icons/icon.svg` 교체, `src/app/kiosk/page.tsx` 의 `<img src>` |
| 선택과목 이름·요금 | `src/types/index.ts` 의 `ELECTIVE_FEES` |
| 청구서 제목 형식 | `src/lib/billing-title.ts` |
| 미납 안내 문자 문구 | `src/components/BillActionModal.tsx` 의 `buildOverdueSmsTemplate` |
| 키오스크 응원 문구 | `src/app/kiosk/page.tsx` 의 `CHEER_IN_BASE` |
| 청구서 발송 가능 시간대 | `src/lib/schedule.ts` |
| 결제 대행사 교체 | `src/lib/payssam.ts` |

### 알아둘 것

- **학년·반 구조는 한국 학원 기준입니다.** 학년(중1, 고2…) 아래 반(H, A…)이 있고,
  반 이름이 한 글자라 **반의 신원은 `(학년, 과목, 반이름)` 세 개 조합**입니다.
- **선택 기능 세 개(결제·문자·AI)를 다 안 쓰면** 학생 명단 + 반 편성 + 수기 납부 기록 +
  출결 관리 앱으로 그냥 쓸 수 있습니다. 그것만으로도 쓸모가 있습니다.
- **`/api/students/[id]/360` 은 원래 같은 Supabase 프로젝트를 공유하던
  자매 앱들의 테이블을 읽던 기능입니다.** 그 테이블들이 없으면 해당 섹션이 빈 채로
  뜰 뿐 에러가 나지는 않습니다(`isMissingSchemaError` 처리). 신경 쓰지 않아도 됩니다.

---

## 배포

Vercel 이 가장 쉽습니다.

1. 저장소를 Vercel 에 연결
2. **환경변수를 Vercel 쪽에도 넣습니다** — 로컬 `.env.local` 은 배포에 반영되지 않습니다
3. 한국에서 쓴다면 리전을 `icn1`(서울)로 두세요 — 날짜·지연 양쪽에 이롭습니다

> ⚠️ **키를 교체(rotate)할 때는 로컬과 배포 플랫폼 양쪽을 다 갈아야 합니다.**
> 한쪽만 바꾸면 나머지 절반은 죽은 키로 조용히 돌아갑니다.
> 그리고 환경변수는 **재배포해야 반영됩니다.**

예약 발송을 쓴다면 `/api/cron/send-queued` 를 스케줄러로 주기 호출해야 합니다
(`Authorization: Bearer $CRON_SECRET`). 🔴 **크론을 두 군데(예: Vercel Cron + 서버 crontab)에
동시에 걸지 마세요 — 청구가 두 번 나갑니다.**

---

## 기여

이슈·PR 환영합니다. 다만 이 두 가지만 지켜주세요:

1. **`npm run lint && npm run typecheck && npm test` 가 통과해야 합니다.**
2. **돈·발송 경로를 고칠 때는 테스트를 같이 주세요.** 이 저장소의 테스트 상당수는
   실제로 났던 사고를 다시 못 나게 막는 장치입니다.

---

## 라이선스

MIT. `LICENSE` 참조.

---

## English summary

**Tuition Manager** is a Korean private-academy (*hagwon*) management system: student
roster, class assignment, monthly tuition billing, payment tracking, attendance
(including a student-facing check-in kiosk), and instructor payroll.

Built with **Next.js 16 (App Router) + Supabase + Tailwind v4**. It was extracted from a
system that ran a real academy for over a year, then sanitized for public release.

**Requirements**: Node 20+, a Supabase project. Everything else — the payment gateway
(PaySsam, a Korean academy-billing service), SMS/KakaoTalk (Solapi), and the LLM agent
(Google Gemini) — is optional; missing keys disable only that feature.

**Quick start**

```bash
npm install
# Supabase dashboard → SQL Editor → paste supabase/schema.sql → Run
# (optional) also run supabase/seed-demo.sql for demo data
cp .env.example .env.local     # fill in Supabase URL, service_role key, admin creds, session secret
npm run dev
```

**Security model**: the browser never talks to Supabase directly. Server routes hold the
`service_role` key; every table has RLS enabled with **no** `anon` policies, so the public
key sees nothing. Auth is a single admin account with an HMAC-signed session cookie,
verified in Edge middleware and re-verified in each API route. The finance screen sits
behind an additional server-verified PIN.

**Notable design choices** — these exist because things went wrong once:
no hard `DELETE`s anywhere (rows are soft-marked and kept), no silent fallbacks on the
money path (a missing payment-gateway URL throws rather than defaulting), sends are
always human-triggered (auto-resend is deliberately off), and a tripwire test fails when
new code gains the ability to message a human, forcing you to declare who it lands on.

**UI**: an ivory "paper" theme with an optional navy-ink dark scheme (auto/light/dark, decided
before first paint — no flash), contrast-checked in unit tests; scroll-linked header motion driven by
CSS `animation-timeline: scroll()` with a single-rAF fallback and reduced-motion support; a monthly
revenue page with hand-rolled SVG charts. See `docs/design/GUIDE-scroll-motion.md`.

The UI and code comments are in Korean. The domain model (grades → classes → students,
Korean school-year naming, elective subjects) assumes a Korean academy; adapting it to
another market means more than translating strings.

MIT licensed.
