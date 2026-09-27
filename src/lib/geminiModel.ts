/**
 * Gemini 모델 선택·폴백 (2026-09-16, 운영 점검 정정 — 2.5 계열 2026-10-20 종료 공지 대응).
 *
 * 규칙(전 앱 통일):
 *  ① 1순위는 **고정 핀**한다. `gemini-flash-latest` 같은 별칭은 내용이 바뀌어도 우리가 모른다.
 *  ② 폴백은 현행 GA 로 갱신되는 별칭을 쓴다. 2.5 고정 핀은 10/20 죽은 칸이라 제거한다.
 *  ③ 모델명은 환경변수로 덮을 수 있게 연다 — 다음 폐기 때 코드 수정 없이 넘긴다.
 *
 * ⚠️ 우리 Vertex 프로젝트에서 실제로 200 이 나오는 3.x 는 gemini-3-flash-preview 뿐이다
 * (gemini-3-flash / gemini-3-pro / gemini-3-pro-preview / gemini-3-flash-lite 는 전부 404 — 전수 프로브).
 * 그래서 3.x pro·flash-lite 고정 핀으로 갈아타는 선택지는 지금 없다.
 */

/** 1순위 모델. GEMINI_MODEL 로 덮어쓸 수 있다. */
export const GEMINI_PRIMARY_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3-flash-preview'

/**
 * 폴백 후보 — 별칭 허용은 폴백에 한정하며, 1순위 고정 핀 규칙은 유지한다.
 * 마지막은 Lite 계열: Flash 광역 장애 대비(2026-06-10 3앱 동시 다운).
 */
const LEGACY_FALLBACKS = ['gemini-flash-latest', 'gemini-flash-lite-latest']

/** 시도 순서. 1순위가 폴백과 같으면 중복 제거. */
export const GEMINI_MODELS: string[] = [
  GEMINI_PRIMARY_MODEL,
  ...LEGACY_FALLBACKS.filter(m => m !== GEMINI_PRIMARY_MODEL),
]

/**
 * 다음 후보로 넘어갈 오류인지 판정.
 *
 * 기준은 "다음 후보가 **다른 실패 도메인**에 있는가" 하나다 (2026-09-12 재검토 정정):
 *  · 404 / not found / unsupported → 넘긴다. 그 모델만 없다.
 *  · 429 → **넘긴다.** 용량 소진은 모델 단위로 떨어진다("No capacity available for model …",
 *    reason MODEL_CAPACITY_EXHAUSTED). 다른 모델은 다른 통이라 폴백이 '같은 실패 두 번'이 아니다.
 *    특히 우리 1순위는 preview 모델이라 용량 소진이 실제로 일어날 수 있다.
 *  · 5xx / 타임아웃 → 넘긴다. 백엔드 경로가 갈릴 수 있다(자매 앱은 2026-07-14 에 이 완충이 없어 기능이 통째로 멈췄다).
 *  · 401 / 403 → **안 넘긴다.** 키는 모델과 무관하게 공유돼 같은 도메인이다 — 두 번 불러도 같은 이유로 죽는다.
 *  · 프롬프트·스키마 오류(400) → 안 넘긴다. 모델을 바꿔도 같은 입력이면 같은 결과다.
 */
export function isRetryableWithAnotherModel(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  if (/\b401\b|\b403\b|API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) return false
  if (/\b404\b|not found|NOT_FOUND|is not supported|does not exist|unsupported model/i.test(msg)) return true
  if (/\b429\b|RESOURCE_EXHAUSTED|MODEL_CAPACITY_EXHAUSTED|quota|rate limit/i.test(msg)) return true
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined
  if (typeof status === 'number' && Number.isInteger(status) && status >= 500 && status <= 599) return true
  if (/\[5\d{2}(?:\]|\s[^\]]*\])|\b(?:HTTP\s+|status\s*[:=]\s*)5\d{2}\b|UNAVAILABLE|INTERNAL|deadline|timeout|timed out|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg)) return true
  return false
}

/** @deprecated 이름이 좁다 — isRetryableWithAnotherModel 을 써라. 남은 호출부 호환용. */
export const isModelUnavailableError = isRetryableWithAnotherModel

/**
 * 후보 모델을 순서대로 시도한다. run 은 **부작용이 없어야 한다**(재시도 시 처음부터 다시 돈다).
 * 이 앱의 두 호출부(에이전트 질의·필터)는 조회 전용이라 안전하다.
 */
export async function withGeminiModel<T>(run: (model: string) => Promise<T>): Promise<T> {
  let lastError: unknown
  for (const model of GEMINI_MODELS) {
    try {
      return await run(model)
    } catch (error) {
      if (!isRetryableWithAnotherModel(error)) throw error
      console.error('[gemini] 이 모델로는 실패 → 다음 후보로:', model,
        error instanceof Error ? error.message : String(error))
      lastError = error
    }
  }
  throw lastError
}
