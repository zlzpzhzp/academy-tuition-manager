// 클라이언트 IP 판정 — 미들웨어(Edge)와 라우트 핸들러(Node) 공용.
// ⚠️ 두 곳이 서로 다른 IP를 보면 IP별 잠금이 통째로 무의미해지므로 반드시 이 헬퍼 하나만 쓸 것.
// (2026-07-26: 미들웨어에만 있던 로직을 PIN 락아웃 도입하며 공용화)
//
// 이 앱은 Cloudflare Tunnel(cloudflared) 뒤에 있으므로 신뢰경계는 cf-connecting-ip.
// cloudflared가 이 헤더를 덮어쓰므로 터널 통과 클라이언트는 위조 불가.
// XFF는 leftmost(공격자 조작 가능) 절대 신뢰 금지 → rightmost(마지막 홉)만 사용.
export function getClientIp(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const xReal = headers.get('x-real-ip')?.trim()
  if (xReal) return xReal
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }
  return 'unknown'
}
