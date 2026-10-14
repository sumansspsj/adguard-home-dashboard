import { type ReactNode } from 'react'
import { useCountUp } from '../hooks/useCountUp'
import Sparkline from './Sparkline'

interface StatCardProps {
  label: string
  value: number | string
  sub?: string
  icon?: ReactNode
  accent?: string
  loading?: boolean
  sparkData?: number[]
  onClick?: () => void
}

export default function StatCard({
  label, value, sub, icon, loading = false, sparkData, onClick, accent
}: StatCardProps) {
  const animated = useCountUp(typeof value === 'number' ? value : 0)
  const displayValue = typeof value === 'number' ? animated.toLocaleString() : value

  return (
    <article
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `View details for ${label}` : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      } : undefined}
      className={`card metric card-hover flex flex-col justify-between ${
        onClick ? 'cursor-pointer' : ''
      }`}
    >
      {/* Metric Top: Label & Symbol Box */}
      <div className="metric-top">
        <span>{label}</span>
        {icon && (
          <span className="metric-symbol" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>

      {/* Metric Value */}
      {loading ? (
        <div className="h-8 skeleton-shimmer rounded-[9px] w-28 my-3.5" />
      ) : (
        <div className={`metric-value font-mono tabular-nums ${
          accent === 'good' ? 'goodtext' : accent === 'bad' ? 'badtext' : ''
        }`}>
          {displayValue}
        </div>
      )}

      {/* Metric Foot: Subtitle & Sparkline */}
      <div className="metric-foot flex items-end justify-between gap-2 mt-auto">
        <span className={`flex-1 truncate leading-tight ${
          accent === 'good' ? 'goodtext' : accent === 'bad' ? 'badtext' : ''
        }`}>{loading ? 'Loading…' : sub}</span>
        {sparkData && sparkData.length > 1 && !loading && (
          <Sparkline
            data={sparkData}
            color={accent === 'good' ? 'var(--green)' : accent === 'bad' ? 'var(--red)' : 'var(--text)'}
            height={22}
            width={58}
          />
        )}
      </div>
    </article>
  )
}
