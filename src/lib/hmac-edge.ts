/**
 * HMAC-SHA256 코어 (isomorphic: Node 20+ / Next.js Edge 런타임 양쪽에서 동작).
 *
 * 왜 WebCrypto인가: `crypto.subtle` 은 Node 20+ 와 Edge 런타임 둘 다에 있다.
 * 미들웨어는 Edge 런타임에서 돌기 때문에 `node:crypto` 를 못 쓴다 —
 * 그래서 서버 라우트용(`src/lib/auth.ts`, node crypto)과 미들웨어용(이 파일)이 나뉘어 있다.
 * **두 구현은 반드시 같은 서명을 내야 한다**(base64url HMAC-SHA256). 한쪽만 고치지 마라.
 *
 * 왜 `subtle.verify` 인가: 검증을 constant-time 으로 수행한다.
 * `signature === expected` 같은 문자열 비교는 첫 불일치 바이트에서 조기 리턴하므로
 * 서명을 한 바이트씩 맞춰가는 timing oracle 이 성립한다. 비교를 우리가 직접 하지 않고
 * 표준 verify 에 위임하면 그 공격 표면이 구조적으로 사라진다.
 */

const enc = new TextEncoder()

function subtle(): SubtleCrypto {
  const c = globalThis.crypto
  if (!c || !c.subtle) throw new Error('[hmac] WebCrypto subtle 미지원 런타임')
  return c.subtle
}

function importKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return subtle().importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages)
}

function toB64url(bytes: ArrayBuffer): string {
  let bin = ''
  const arr = new Uint8Array(bytes)
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** HMAC-SHA256(secret, data) → base64url. `src/lib/auth.ts` 의 sign() 과 동일 출력. */
export async function sign(secret: string, data: string): Promise<string> {
  const key = await importKey(secret, ['sign'])
  const sig = await subtle().sign('HMAC', key, enc.encode(data))
  return toB64url(sig)
}

/** constant-time 검증 — signature(base64url)가 data 의 유효한 서명인지. */
export async function verify(secret: string, data: string, signature: string): Promise<boolean> {
  if (typeof signature !== 'string' || signature.length === 0) return false
  let sigBytes: Uint8Array
  try {
    sigBytes = fromB64url(signature)
  } catch {
    return false
  }
  const key = await importKey(secret, ['verify'])
  try {
    return await subtle().verify('HMAC', key, sigBytes as unknown as BufferSource, enc.encode(data))
  } catch {
    return false
  }
}
