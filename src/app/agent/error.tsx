'use client'

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <p className="text-gray-500 mb-4">문제가 발생했습니다</p>
      <button onClick={reset} className="px-4 py-2 bg-[var(--blue)] text-white rounded-lg hover:opacity-90">
        다시 시도
      </button>
    </div>
  )
}
