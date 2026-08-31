'use client'

import { useState, useEffect } from 'react'
import { Lock } from 'lucide-react'
import { TButton } from '@/components/motion'

/**
 * 원장 전용 PIN 입력 페이지 — audit 2026-05-10 P0 fix.
 * /finance/* 진입 시 middleware가 finance_session HMAC 쿠키 없으면 이쪽으로 리다이렉트.
 * PIN은 서버(/api/auth/finance)에서 timingSafeEqual로 비교, 통과 시 쿠키 발급.
 */
export default function FinanceAuthPage() {
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const verifyPin = async (val: string) => {
    if (verifying) return
    setVerifying(true)
    setErrorMsg('')
    try {
      const r = await fetch('/api/auth/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: val }),
      })
      if (r.ok) {
        // PIN 통과 — 풀 리로드로 /finance 이동. router.replace+refresh race로 같은 화면에 머무는 버그 회피.
        window.location.replace('/finance')
        return
      }
      const data = await r.json().catch(() => ({}))
      setPinError(true)
      setErrorMsg(data?.error || 'PIN이 올바르지 않습니다')
      setTimeout(() => setPin(''), 300)
    } catch {
      setPinError(true)
      setErrorMsg('네트워크 오류가 발생했습니다')
    } finally {
      setVerifying(false)
    }
  }

  const handlePinSubmit = () => {
    if (pin.length === 6) void verifyPin(pin)
  }

  // Enter 키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') handlePinSubmit() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="card-elevated p-8 w-full max-w-xs text-center">
        <div className="w-14 h-14 bg-gradient-to-br from-[#3182f6] to-[#1b64da] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#3182f6]/20">
          <Lock className="w-6 h-6 text-white" />
        </div>
        <h1 className="text-lg font-bold mb-1">원장 전용</h1>
        <p className="text-sm text-[var(--text-4)] mb-6">PIN 번호를 입력하세요</p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={e => {
            const val = e.target.value.replace(/\D/g, '')
            setPin(val)
            setPinError(false)
            setErrorMsg('')
            if (val.length === 6) void verifyPin(val)
          }}
          placeholder="••••••"
          className={`w-full text-center text-2xl tracking-[0.5em] px-4 py-3.5 bg-[var(--bg-card-hover)] border rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:bg-[var(--bg-card)] transition-all ${pinError ? 'border-[var(--unpaid-text)] bg-[var(--unpaid-bg)]' : 'border-[var(--border)]'}`}
          autoFocus
          disabled={verifying}
        />
        {pinError && <p className="text-xs text-[var(--unpaid-text)] mt-2">{errorMsg || 'PIN이 올바르지 않습니다'}</p>}
        <TButton
          onClick={handlePinSubmit}
          disabled={verifying || pin.length !== 6}
          className="mt-4 w-full py-3 rounded-xl bg-[var(--blue)] text-white font-bold disabled:opacity-50"
        >
          {verifying ? '확인 중...' : '확인'}
        </TButton>
      </div>
    </div>
  )
}
