# e2e 테스트 (Playwright)

audit 2026-05-10 Phase 3.5 — 핵심 흐름 회귀 테스트.

## 실행

```bash
# 1) 로컬 서버 가동 (npm run build && npm start, 기본 :3000 — 아래 포트는 자기 환경에 맞게)

# 2) 어드민 세션 토큰 발급 (HMAC 쿠키 한 번 받기)
curl -sS -c /tmp/e2e-session.txt -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"id":"<ADMIN_ID>","password":"<ADMIN_PASSWORD>"}'

export TOKEN=$(grep auth_token /tmp/e2e-session.txt | awk '{print $7}')

# 3) 시나리오 실행
node tests/e2e/login.mjs       # 로그인 → 대시보드
node tests/e2e/modal.mjs       # PaymentModal 열기/닫기 애니메이션
node tests/e2e/finance-pin.mjs # /finance PIN 흐름

# 4) 위 세 개 한 번에
TOKEN=$TOKEN npm run test:e2e
```

## 시나리오

| 파일 | 검증 항목 |
|---|---|
| `login.mjs` | 비인증 → /login 리다이렉트, 인증 후 /dashboard 200 |
| `modal.mjs` | PaymentModal open/close exit 애니메이션 정상 (close 후 240ms 대기) |
| `finance-pin.mjs` | /finance HMAC 쿠키 흐름 — 비PIN 시 /finance/auth 리다이렉트, 위조 쿠키 차단, 올바른 PIN → 진입 |

## 화면·모션 실측 하네스 (합성 데이터 전용)

아래는 **운영 서버·DB 에 절대 닿지 않는** 검수 도구입니다. 격리 빌드(`127.0.0.1:33xx`)를 띄우고
모든 `/api/*` 요청을 합성 데이터(`paper-fixtures.cjs`)로 가로챕니다. 외부 요청은 차단합니다.

| 파일 | 무엇을 재나 |
|---|---|
| `paper-redesign.mjs` | 종이 테마 전후 화면·가로 넘침 |
| `dark-paper.mjs` | 어두운 톤 대비·첫 페인트 플래시·탭 가림 |
| `payments-header.mjs` | 납부 헤더 스크롤 위치별 값표·튕김 시퀀스·프레임 시간 |
| `polish-modals-motion.mjs` | 모달 모서리·모션 기하·성능 |
| `with-headless-chrome.sh` | 시스템 크롬을 CDP 로 띄우고 **어떻게 끝나든** 닫아 주는 런처 |

`*-fixtures.cjs`, `*-metrics.cjs`, `*-cases.cjs` 는 단위 테스트(`src/__tests__`)도 같이 씁니다.
하네스는 각 파일 머리의 환경변수(`PAPER_BASE`, `POLISH_CDP` 등)를 요구합니다.

## 종료 코드

각 스크립트는 실패 시 `process.exit(1)` — CI 통합 시 그대로 사용 가능.
