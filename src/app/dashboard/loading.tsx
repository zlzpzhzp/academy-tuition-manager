export default function Loading() {
  return (
    <div className="space-y-5">
      <div>
        <div className="skeleton-shimmer rounded-xl h-7 w-44 mb-2"></div>
        <div className="skeleton-shimmer rounded-xl h-4 w-32"></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="card p-5 space-y-3">
            <div className="flex items-center gap-1.5">
              <div className="skeleton-shimmer rounded-full w-4 h-4"></div>
              <div className="skeleton-shimmer rounded-xl h-3 w-12"></div>
            </div>
            <div className="skeleton-shimmer rounded-xl h-8 w-16"></div>
          </div>
        ))}
      </div>
      <div className="card p-5">
        <div className="skeleton-shimmer rounded-xl h-4 w-16 mb-4"></div>
        <div className="space-y-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3 py-2">
              <div className="skeleton-shimmer rounded-xl h-4 flex-1"></div>
              <div className="skeleton-shimmer rounded-full h-5 w-16"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
