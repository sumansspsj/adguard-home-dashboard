import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, ExternalLink, Eye, Shield, ShieldOff, Copy, Check,
  AlertTriangle, Database, Activity, RefreshCw, Search
} from 'lucide-react'
import FaviconDomain from './FaviconDomain'
import {
  checkHost,
  getQueryLog,
  getFilterLists,
  isDnsBlocked,
  type CheckHostResult,
  type QueryLogEntry
} from '../api'

interface DomainDrawerProps {
  domain: string | null
  blocked?: boolean
  count?: number
  onClose: () => void
  onBlock?: (domain: string) => Promise<void> | void
  onUnblock?: (domain: string) => Promise<void> | void
  onViewLive?: (domain: string) => void
  onViewClient?: (clientIp: string) => void
}

interface ClientDistribution {
  ip: string
  name: string
  count: number
}

export default function DomainDrawer({
  domain,
  blocked: initialBlocked = false,
  count = 0,
  onClose,
  onBlock,
  onUnblock,
  onViewLive,
  onViewClient,
}: DomainDrawerProps) {
  const [copied, setCopied] = useState(false)
  const [filterNames, setFilterNames] = useState<Record<number, string>>({})
  const [actionInProgress, setActionInProgress] = useState(false)
  const [prevDomain, setPrevDomain] = useState(domain)
  const [blockedOverride, setBlockedOverride] = useState<boolean | null>(null)
  const [filterCheck, setFilterCheck] = useState<CheckHostResult | null>(null)
  const [clients, setClients] = useState<ClientDistribution[]>([])
  const [recentQueries, setRecentQueries] = useState<QueryLogEntry[]>([])
  const [logsLoaded, setLogsLoaded] = useState(false)

  if (domain !== prevDomain) {
    setPrevDomain(domain)
    setBlockedOverride(null)
    setFilterCheck(null)
    setClients([])
    setRecentQueries([])
    setLogsLoaded(false)
  }

  const isBlockedState = blockedOverride ?? initialBlocked
  const loadingCheck = Boolean(domain && filterCheck === null)
  const loadingLogs = Boolean(domain && !logsLoaded)

  // Fetch filter names once
  useEffect(() => {
    getFilterLists().then(setFilterNames).catch(() => {})
  }, [])

  // Escape key handler
  useEffect(() => {
    if (!domain) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [domain, onClose])

  // Whenever domain opens, perform deep inspection
  useEffect(() => {
    if (!domain) return
    let isMounted = true

    // 1. Fetch real-time check_host diagnosis
    checkHost(domain)
      .then(res => {
        if (isMounted) {
          setFilterCheck(res)
          if (isDnsBlocked(res.reason)) {
            setBlockedOverride(true)
          }
        }
      })
      .catch(() => {})

    // 2. Fetch recent queries & aggregate client breakdown
    getQueryLog({ search: domain, limit: 80 })
      .then(res => {
        if (!isMounted) return
        const entries = res.data || []
        setRecentQueries(entries.slice(0, 6))

        // Aggregate client counts
        const clientMap: Record<string, { ip: string; name: string; count: number }> = {}
        entries.forEach(e => {
          const ip = e.client
          const name = e.client_info?.name || ip
          if (!clientMap[ip]) {
            clientMap[ip] = { ip, name, count: 0 }
          }
          clientMap[ip].count++
        })

        const sorted = Object.values(clientMap).sort((a, b) => b.count - a.count)
        setClients(sorted)
        setLogsLoaded(true)
      })
      .catch(() => {
        if (isMounted) setLogsLoaded(true)
      })

    return () => {
      isMounted = false
    }
  }, [domain])

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }

  const handleToggleBlock = async () => {
    if (!domain || actionInProgress) return
    setActionInProgress(true)
    try {
      if (isBlockedState) {
        if (onUnblock) await onUnblock(domain)
        setBlockedOverride(false)
      } else {
        if (onBlock) await onBlock(domain)
        setBlockedOverride(true)
      }
      // Re-run filter check
      const updated = await checkHost(domain)
      setFilterCheck(updated)
    } finally {
      setActionInProgress(false)
    }
  }

  if (!domain) return null

  const maxClientHits = clients[0]?.count || 1
  const matchedRule = filterCheck?.rules?.[0] || (filterCheck?.rule ? { text: filterCheck.rule, filter_list_id: filterCheck.filter_id } : null)
  const filterListName = matchedRule
    ? (filterNames[matchedRule.filter_list_id] || (matchedRule.filter_list_id === 0 ? 'Custom User Rules' : `List #${matchedRule.filter_list_id}`))
    : null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[80] overflow-hidden">
        {/* Backdrop */}
        <motion.div
          className="fixed inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />

        {/* Drawer Container */}
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 340, damping: 32 }}
          className="fixed right-0 top-0 bottom-0 z-[81] w-full max-w-md bg-[var(--bg-card)] border-l border-[var(--border)] shadow-2xl flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="Domain details drawer"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[var(--bg-active)] border border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)] shrink-0">
                <Search className="w-4 h-4 text-[var(--text-primary)]" />
              </div>
              <div className="min-w-0">
                <h2 className="text-xs font-semibold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
                  <span>Domain Intelligence</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[var(--bg-active)] text-[var(--text-secondary)] border border-[var(--border)] font-medium">
                    DIAGNOSTICS
                  </span>
                </h2>
                <p className="text-[11px] text-[var(--text-tertiary)] truncate mt-0.5">
                  Real-time rule engine & client request profiling
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              aria-label="Close domain drawer"
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--border-subtle)] p-5 space-y-4">
            {/* Domain Overview Card */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <FaviconDomain
                    domain={domain}
                    blocked={isBlockedState}
                    className="text-base font-semibold font-mono text-[var(--text-primary)] break-all leading-tight"
                  />
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleCopy(domain)}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                    title="Copy domain"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-[var(--text-primary)]" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a
                    href={`https://${domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                    title="Open domain in browser"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Status Tags */}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                    isBlockedState
                      ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border-[var(--border-strong)]'
                      : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] border-[var(--border)]'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isBlockedState ? 'bg-[var(--color-danger)]' : 'bg-[var(--text-primary)]'}`} />
                  <span>{isBlockedState ? 'BLOCKED' : 'ALLOWED'}</span>
                </span>

                <span className="text-xs font-mono text-[var(--text-secondary)] px-2 py-0.5 rounded bg-[var(--bg-active)] border border-[var(--border)]">
                  {count.toLocaleString()} queries (24h)
                </span>

                {filterCheck?.cname && (
                  <span className="text-[10.5px] font-mono text-[var(--text-tertiary)] truncate" title={`CNAME: ${filterCheck.cname}`}>
                    CNAME: {filterCheck.cname}
                  </span>
                )}
              </div>
            </div>

            {/* Live Filter Diagnostics */}
            <div className="space-y-2.5 pt-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-tertiary)] uppercase tracking-wider font-semibold text-[10.5px] flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                  <span>Filter Engine Verdict</span>
                </span>
                {loadingCheck && <RefreshCw className="w-3 h-3 text-[var(--text-muted)] animate-spin" />}
              </div>

              {matchedRule ? (
                <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-primary)] font-medium">{filterListName}</span>
                    <span className="text-[10px] font-mono text-[var(--text-tertiary)]">ID: {matchedRule.filter_list_id}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-active)] border border-[var(--border)] px-2 py-1 rounded break-all flex-1">
                      {matchedRule.text}
                    </code>
                    <button
                      onClick={() => handleCopy(matchedRule.text)}
                      className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                      title="Copy rule syntax"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {filterCheck?.reason && (
                    <div className="text-[11px] text-[var(--text-tertiary)] font-mono">
                      Reason: <span className="text-[var(--text-secondary)]">{filterCheck.reason}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-3 text-xs text-[var(--text-secondary)] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--text-primary)] shrink-0" />
                  <span>No blocking filter rule matched. Domain resolves unrestricted.</span>
                </div>
              )}
            </div>

            {/* Queried by Clients breakdown */}
            <div className="space-y-2.5 pt-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-tertiary)] uppercase tracking-wider font-semibold text-[10.5px] flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                  <span>Active Clients ({clients.length})</span>
                </span>
                {loadingLogs && <RefreshCw className="w-3 h-3 text-[var(--text-muted)] animate-spin" />}
              </div>

              {clients.length === 0 ? (
                <div className="text-xs text-[var(--text-tertiary)] py-3 text-center bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl">
                  {loadingLogs ? 'Scanning query log…' : 'No recent queries found in local window'}
                </div>
              ) : (
                <div className="space-y-2">
                  {clients.slice(0, 5).map(c => {
                    const pct = Math.round((c.count / maxClientHits) * 100)
                    return (
                      <div
                        key={c.ip}
                        onClick={() => onViewClient?.(c.ip)}
                        className="p-2.5 bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-xl cursor-pointer transition-colors group"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[var(--text-primary)] group-hover:underline truncate">
                            {c.name || c.ip}
                          </span>
                          <span className="font-mono text-[var(--text-secondary)] font-medium">
                            {c.count} {c.count === 1 ? 'query' : 'queries'}
                          </span>
                        </div>
                        {c.name && c.name !== c.ip && (
                          <div className="text-[10px] font-mono text-[var(--text-tertiary)] mt-0.5">{c.ip}</div>
                        )}
                        <div className="mt-1.5 h-1.5 bg-[var(--bg-active)] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all bg-[var(--text-primary)]"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Recent Query Log Stream sample */}
            {recentQueries.length > 0 && (
              <div className="space-y-2.5 pt-4">
                <span className="text-[var(--text-tertiary)] uppercase tracking-wider font-semibold text-[10.5px] flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                  <span>Recent Lookups</span>
                </span>
                <div className="space-y-1.5">
                  {recentQueries.map((q, idx) => {
                    const timeStr = q.time ? new Date(q.time).toLocaleTimeString() : '—'
                    const isQBlocked = isDnsBlocked(q)
                    return (
                      <div
                        key={idx}
                        className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-xs flex items-center justify-between font-mono"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className={`w-1.5 h-1.5 rounded-full ${isQBlocked ? 'bg-[var(--color-danger)]' : 'bg-[var(--text-primary)]'}`} />
                          <span className="text-[var(--text-primary)] text-[11px] truncate">{q.client_info?.name || q.client}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-[var(--text-tertiary)] text-[11px]">
                          <span>{q.elapsedMs ? `${parseFloat(q.elapsedMs).toFixed(0)}ms` : 'cache'}</span>
                          <span>{timeStr}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* External Threat Intelligence & Security Verification */}
            <div className="space-y-2 pt-4">
              <span className="text-[var(--text-tertiary)] uppercase tracking-wider font-semibold text-[10.5px] flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                <span>External Reputation & Intelligence</span>
              </span>

              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`https://www.virustotal.com/gui/domain/${domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-2.5 bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-xl text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <span className="font-medium">VirusTotal</span>
                  <ExternalLink className="w-3 h-3 text-[var(--text-muted)]" />
                </a>

                <a
                  href={`https://urlscan.io/search/#${domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-2.5 bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-xl text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <span className="font-medium">URLScan.io</span>
                  <ExternalLink className="w-3 h-3 text-[var(--text-muted)]" />
                </a>

                <a
                  href={`https://transparencyreport.google.com/safe-browsing/search?url=${domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-2.5 bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-xl text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <span className="font-medium">Google Safe</span>
                  <ExternalLink className="w-3 h-3 text-[var(--text-muted)]" />
                </a>

                <a
                  href={`https://who.is/whois/${domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-2.5 bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-xl text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <span className="font-medium">WHOIS Record</span>
                  <ExternalLink className="w-3 h-3 text-[var(--text-muted)]" />
                </a>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-surface)] shrink-0 space-y-2">
            {isBlockedState ? (
              <button
                onClick={handleToggleBlock}
                disabled={actionInProgress}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
              >
                {actionInProgress ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldOff className="w-3.5 h-3.5" />}
                <span>Whitelist Domain (Allow)</span>
              </button>
            ) : (
              <button
                onClick={handleToggleBlock}
                disabled={actionInProgress}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
              >
                {actionInProgress ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
                <span>Block Domain (Enforce Rule)</span>
              </button>
            )}

            {onViewLive && (
              <button
                onClick={() => {
                  onClose()
                  onViewLive(domain)
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-xs text-[var(--text-primary)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] rounded-xl transition-colors cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                <span>Inspect in Live DNS Stream</span>
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
