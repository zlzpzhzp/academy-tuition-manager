'use client'

import { useEffect } from 'react'

/**
 * Global Error Boundary — App Router root에서 잡히지 않은 에러 fallback.
 * layout.tsx 자체에 에러가 발생한 경우만 호출됨. 자체 <html><body> 필요.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Global Error]', error)
  }, [error])

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          background: '#17171c',
          color: '#e6e6e9',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Pretendard Variable", Pretendard, sans-serif',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
        }}
      >
        <div style={{ maxWidth: 400, textAlign: 'center' }}>
          <div
            style={{
              fontSize: 32,
              marginBottom: 16,
              opacity: 0.8,
            }}
          >
            ⚠
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 8px' }}>
            앱에 심각한 오류가 발생했습니다
          </h1>
          <p style={{ fontSize: 13, color: '#9098a3', margin: '0 0 24px' }}>
            페이지를 새로고침하거나 잠시 후 다시 접속해주세요.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace', margin: '0 0 16px' }}>
              {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              padding: '12px 24px',
              borderRadius: 12,
              border: 'none',
              background: '#3182f6',
              color: 'white',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  )
}
