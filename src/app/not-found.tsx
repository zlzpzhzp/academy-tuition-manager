import Link from 'next/link'
import { SearchX, Home } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="card-elevated p-8 w-full max-w-sm">
        <div className="w-14 h-14 bg-[var(--bg-card-hover)] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <SearchX className="w-7 h-7 text-[var(--text-3)]" />
        </div>
        <h1 className="text-lg font-bold mb-2 text-[var(--text-1)]">페이지를 찾을 수 없습니다</h1>
        <p className="text-sm text-[var(--text-3)] mb-6">주소를 다시 확인해주세요.</p>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center gap-1.5 px-6 py-3 rounded-xl bg-[var(--blue)] text-white font-bold hover:opacity-90 transition-opacity"
        >
          <Home className="w-4 h-4" /> 대시보드로
        </Link>
      </div>
    </div>
  )
}
