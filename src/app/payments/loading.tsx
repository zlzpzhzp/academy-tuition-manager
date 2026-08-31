export default function Loading() {
  return (
    <div>
      <div className="flex items-center justify-center gap-3 mb-4">
        <div className="skeleton-shimmer rounded-lg w-10 h-10"></div>
        <div className="skeleton-shimmer rounded-xl h-10 w-56 sm:w-72"></div>
        <div className="skeleton-shimmer rounded-lg w-10 h-10"></div>
      </div>
      {[0, 1].map(gi => (
        <div key={gi} className="mb-4">
          <div className="skeleton-shimmer rounded-xl h-4 w-20 mb-2 ml-1"></div>
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 bg-[var(--bg-card-hover)] border-b border-[var(--border)]">
              <div className="skeleton-shimmer rounded-xl h-3 w-24"></div>
            </div>
            {[0, 1, 2, 3].map(si => (
              <div key={si} className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] last:border-b-0">
                <div className="skeleton-shimmer rounded-xl h-4 flex-1"></div>
                <div className="skeleton-shimmer rounded-full h-5 w-16"></div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
