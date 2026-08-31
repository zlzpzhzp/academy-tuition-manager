# e2e 테스트 (Playwright)

audit 2026-05-10 Phase 3.5 — 핵심 흐름 회귀 테스트.

## 실행

```bash
# 1) 로컬 next-server 가동 확인
systemctl is-active tuition-manager  # active

# 2) 어드민 세션 토큰 발급 (HMAC 쿠키 한 번 받기)
curl -sS -c /tmp/e2e-session.txt -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"id":"<ADMIN_ID>","password":"<ADMIN_PASSWORD>"}'

export TOKEN=$(grep auth_token /tmp/e2e-session.txt | awk '{print $7}')

# 3) 시나리오 실행
node tests/e2e/login.mjs       # 로그인 → 대시보드
node tests/e2e/modal.mjs       # PaymentModal 열기/닫기 애니메이션
node tests/e2e/finance-pin.mjs # /finance PIN 흐름

# 4) 전체 한 번에
for f in tests/e2e/*.mjs; do echo "=== $f ==="; TOKEN=$TOKEN node "$f"; done
```

## 시나리오

| 파일 | 검증 항목 |
|---|---|
| `login.mjs` | 비인증 → /login 리다이렉트, 인증 후 /dashboard 200 |
| `modal.mjs` | PaymentModal open/close exit 애니메이션 정상 (close 후 240ms 대기) |
| `finance-pin.mjs` | /finance HMAC 쿠키 흐름 — 비PIN 시 /finance/auth 리다이렉트, 위조 쿠키 차단, 올바른 PIN → 진입 |

## 종료 코드

각 스크립트는 실패 시 `process.exit(1)` — CI 통합 시 그대로 사용 가능.
