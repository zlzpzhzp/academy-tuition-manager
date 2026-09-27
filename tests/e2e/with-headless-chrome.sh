#!/bin/bash
# with-headless-chrome.sh — 검증 하네스용 시스템 크롬 런처. **어떻게 끝나든 크롬을 닫는다**(trap EXIT).
# 왜: 하네스(polish-modals-motion.mjs·dark-paper.mjs)는 CDP 로 붙기만 하고 크롬 프로세스는 밖에서 띄운다.
#     browser.close() 는 CDP 연결만 끊지 프로세스는 안 죽여서, 하네스가 예외로 죽으면 크롬(수백 MB)이 남았다.
#     2026-09-20 운영 규칙: 헤들리스 크롬은 예외에도 닫히게 try/finally·trap EXIT.
# 사용: bash tests/e2e/with-headless-chrome.sh [PORT] -- <명령...>
#   예: POLISH_SHA=… bash tests/e2e/with-headless-chrome.sh 9337 -- node tests/e2e/dark-paper.mjs screens
#   PORT 생략 시 9337. POLISH_CDP 를 자동으로 넣어 준다. 프로필은 /tmp/tuition-polish-chrome-<PORT>-<pid> (종료 시 삭제).
# ⚠️ 종료는 PID 로만 한다 — `pkill -f` 는 이 스크립트 자신의 명령줄(크롬 인자가 들어 있다)을 잡아 셸을 죽인다(2026-09-14 실측 rc144).
set -uo pipefail
PORT=9337
if [ "${1:-}" != "--" ] && [ $# -ge 1 ]; then PORT="$1"; shift; fi
[ "${1:-}" = "--" ] && shift
[ $# -ge 1 ] || { echo "usage: $0 [PORT] -- <command...>" >&2; exit 2; }
CHROME="${CHROME_BIN:-/usr/bin/google-chrome}"
[ -x "$CHROME" ] || { echo "❌ $CHROME 없음" >&2; exit 2; }
PROFILE="/tmp/tuition-polish-chrome-${PORT}-$$"
mkdir -p "$PROFILE"
"$CHROME" --headless=new --no-sandbox --disable-gpu --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" about:blank >"$PROFILE/chrome.log" 2>&1 &
CHROME_PID=$!
cleanup() {
  if kill -0 "$CHROME_PID" 2>/dev/null; then
    kill "$CHROME_PID" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$CHROME_PID" 2>/dev/null || break; sleep 0.3; done
    kill -9 "$CHROME_PID" 2>/dev/null || true
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT INT TERM
# CDP 가 열릴 때까지 대기(최대 15s)
for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break
  kill -0 "$CHROME_PID" 2>/dev/null || { echo "❌ 크롬이 바로 죽음: $(tail -3 "$PROFILE/chrome.log")" >&2; exit 3; }
  sleep 0.3
done
curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 || { echo "❌ CDP :$PORT 미개방(15s)" >&2; exit 3; }
POLISH_CDP="http://127.0.0.1:$PORT" "$@"
rc=$?
exit $rc
