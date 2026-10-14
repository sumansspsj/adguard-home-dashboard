interface SkeletonProps {
  className?: string
  rounded?: string
}

/** Single shimmer rectangle */
export function Skeleton({ className = '', rounded = 'rounded' }: SkeletonProps) {
  return (
    <div className={`skeleton-shimmer ${rounded} ${className}`} />
  )
}

/** Skeleton for a stat card */
export function StatCardSkeleton() {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-8" rounded="rounded-lg" />
      </div>
      <Skeleton className="h-9 w-32 mt-1" rounded="rounded-lg" />
      <Skeleton className="h-3 w-40" />
    </div>
  )
}

/** Skeleton for a table row */
export function RowSkeleton({ cols = 4 }: { cols?: number }) {
  const widths = ['w-32', 'w-24', 'w-20', 'w-16', 'w-12']
  return (
    <div className="flex items-center gap-4 px-5 py-3 border-b border-[var(--border-subtle)]">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${widths[i % widths.length]} flex-shrink-0`} />
      ))}
    </div>
  )
}

/** Skeleton for a chart area */
export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="px-4 py-4">
      <div className="skeleton-shimmer rounded-lg w-full" style={{ height }} />
    </div>
  )
}

/** Skeleton for a section with rows */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <RowSkeleton key={i} cols={3} />
      ))}
    </div>
  )
}
