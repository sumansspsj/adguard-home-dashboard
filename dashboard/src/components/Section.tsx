interface SectionProps {
  title: string
  subtitle?: string
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
  noPadding?: boolean
}

export default function Section({
  title,
  subtitle,
  children,
  action,
  className = '',
  noPadding = false,
}: SectionProps) {
  return (
    <article className={`card panel section-frame ${noPadding ? '!p-0 overflow-hidden' : ''} ${className}`}>
      <div className={`panel-heading ${noPadding ? 'p-4 sm:p-[21px] pb-3 border-b border-[var(--border)] !mb-0' : ''}`}>
        <div className="min-w-0">
          <h2>{title}</h2>
          {subtitle && <div className="panel-subtitle">{subtitle}</div>}
        </div>
        {action && <div className="shrink-0 section-action">{action}</div>}
      </div>
      {children}
    </article>
  )
}
