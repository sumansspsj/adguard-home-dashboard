import { useState } from 'react'

interface FaviconDomainProps {
  domain: string
  className?: string
  blocked?: boolean
  clickable?: boolean
  onClick?: () => void
}

export default function FaviconDomain({ domain, className = '', blocked = false, clickable = false, onClick }: FaviconDomainProps) {
  const [imgError, setImgError] = useState(false)
  
  const safeDomain = domain ? String(domain) : ''
  if (!safeDomain) {
    return null
  }

  // Extract root domain for favicon lookup
  const parts = safeDomain.replace(/^(www\.|[*][.])/i, '').split('.')
  const rootDomain = parts.slice(-2).join('.')
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${rootDomain}&sz=16`

  return (
    <span
      className={`inline-flex items-center gap-1.5 min-w-0 ${clickable ? 'cursor-pointer hover:underline' : ''} ${className}`}
      onClick={onClick}
    >
      {!imgError ? (
        <img
          src={faviconUrl}
          alt=""
          width={14}
          height={14}
          className={`shrink-0 rounded-sm ${blocked ? 'opacity-40 grayscale' : 'opacity-85'}`}
          onError={() => setImgError(true)}
        />
      ) : (
        <span className={`w-3.5 h-3.5 shrink-0 rounded-sm flex items-center justify-center text-[8px] font-mono ${
          blocked ? 'bg-[var(--bg-active)] text-[var(--text-primary)] font-bold border border-[var(--border-strong)]' : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)]'
        }`}>
          {domain[0]?.toUpperCase()}
        </span>
      )}
      <span className="truncate" title={domain}>{domain}</span>
    </span>
  )
}
