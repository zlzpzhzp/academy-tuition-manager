'use client'

import { useState } from 'react'
import { TButton } from '@/components/motion'

export default function LoginPage() {
  const [id, setId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password }),
      })
      // 서버가 준 문구(앞으로 N번 / N분 후 잠금)를 그대로 표시. 실패 잠금(429·401)도 JSON error를 준다.
      const data = await res.json().catch(() => null)
      // 2026-07-04: router.push+refresh는 방금 발급된 쿠키가 저장되기 전 RSC 네비게이션이
      // 나가는 레이스로 /login에 머무는 간헐 실패가 있었음. 하드 네비게이션으로 쿠키 확실히 실어 이동.
      if (data?.success) { window.location.href = '/dashboard'; return }
      if (data?.error) setError(data.error)
      // 플랫폼/미들웨어 429는 text/plain이라 json 파싱 실패 → 폴백 안내 (2026-07-04)
      else if (res.status === 429) setError('로그인 시도가 많아 잠시 잠겼습니다. 1~2분 후 다시 시도해주세요.')
      else setError('로그인 중 오류가 발생했습니다.')
    } catch { setError('로그인 중 오류가 발생했습니다.') }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center px-5 bg-[var(--bg)] overflow-y-auto">
      <div className="w-full max-w-sm py-10">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-[var(--blue)] rounded-3xl flex items-center justify-center mx-auto mb-5">
            <span className="text-[var(--on-action)] text-2xl font-extrabold">W</span>
          </div>
          <h1 className="text-[24px] font-extrabold text-[var(--text-1)] tracking-tight">원비관리</h1>
          <p className="text-[15px] text-[var(--text-4)] mt-2">학원 원비 관리 시스템</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text" value={id} onChange={(e) => setId(e.target.value)}
            className="w-full px-5 py-4 bg-[var(--bg-card)] rounded-2xl text-[15px] text-[var(--text-1)] placeholder-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] transition-all"
            placeholder="아이디" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required
          />
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full px-5 py-4 bg-[var(--bg-card)] rounded-2xl text-[15px] text-[var(--text-1)] placeholder-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] transition-all"
            placeholder="비밀번호" autoComplete="current-password" required
          />
          {error && <p className="text-[var(--red)] text-[14px] text-center py-1">{error}</p>}
          <TButton type="submit" disabled={loading}
            className="w-full py-4 bg-[var(--blue)] text-[var(--on-action)] rounded-2xl text-[16px] font-bold hover:bg-[var(--blue-hover)] disabled:bg-[var(--bg-card-hover)] disabled:text-[var(--text-4)] transition-all active:scale-[0.98]">
            {loading ? '로그인 중...' : '로그인'}
          </TButton>
        </form>
      </div>
    </div>
  )
}
