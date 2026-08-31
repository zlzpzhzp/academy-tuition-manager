'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // 운영 환경에서 에러 추적용 콘솔 로그 (서버 로그 아님 — 클라이언트에서만)
    console.error('[App Error]', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="card-elevated p-8 w-full max-w-sm">
        <div className="w-14 h-14 bg-[var(--unpaid-bg)] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-7 h-7 text-[var(--unpaid-text)]" />
        </div>
        <h1 className="text-lg font-bold mb-2 text-[var(--text-1)]">오류가 발생했습니다</h1>
        <p className="text-sm text-[var(--text-3)] mb-1">잠시 후 다시 시도해주세요.</p>
        {error.digest && (
          <p className="text-[11px] text-[var(--text-4)] font-mono mb-5">{error.digest}</p>
        )}
        <div className="flex gap-2 mt-6">
          <button
            onClick={reset}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-[var(--blue)] text-white font-bold hover:opacity-90 transition-opacity"
          >
            <RefreshCw className="w-4 h-4" /> 다시 시도
          </button>
          <a
            href="/dashboard"
            className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-[var(--bg-card-hover)] text-[var(--text-2)] font-medium hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <Home className="w-4 h-4" /> 홈으로
          </a>
        </div>
      </div>
    </div>
  )
}
