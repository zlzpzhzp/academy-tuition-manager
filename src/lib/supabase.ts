import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
// RLS가 켜진 뒤에도 혼자 쓰는 앱 전체가 그대로 작동해야 하므로 service_role로 서버에서만 접근.
// 모든 @/lib/supabase 임포터는 api/* 라우트와 layout.tsx(서버 컴포넌트) — 브라우저 번들 미포함.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'
  )
}

// 네트워크 일시 장애(DNS 지연, TLS 재협상, ECONNRESET)로 undici fetch가 "TypeError: fetch failed"
// 떨어지면 납부 페이지가 통째로 까만 에러 바운더리로 돌아감. 최대 3회 단발 재시도로 복구.
// ⚠️ 재시도는 멱등 메서드(GET/HEAD)만 — INSERT/UPDATE가 서버 처리 후 응답 단계에서 끊긴 경우
// 재시도하면 납부 row 등이 중복 생성됨 (2026-07-10 전수점검)
const retryFetch: typeof fetch = async (input, init) => {
  const method = (
    init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
  ).toUpperCase()
  const idempotent = method === 'GET' || method === 'HEAD'
  const MAX_ATTEMPTS = idempotent ? 3 : 1
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fetch(input, init)
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise(r => setTimeout(r, 200 * (attempt + 1)))
      }
    }
  }
  throw lastErr
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  global: { fetch: retryFetch },
  auth: { persistSession: false, autoRefreshToken: false },
})
