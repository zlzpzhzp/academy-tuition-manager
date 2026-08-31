export default function Loading() {
  return (
    <div className="space-y-3">
      <div className="h-6 skeleton-shimmer rounded w-32 mb-6"></div>
      {[...Array(3)].map((_, i) => (
        <div key={i} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 mb-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-5 skeleton-shimmer rounded w-20"></div>
            <div className="h-4 skeleton-shimmer rounded w-8"></div>
          </div>
          <div className="space-y-2">
            {[...Array(2)].map((_, j) => (
              <div key={j} className="h-10 skeleton-shimmer rounded-lg"></div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
