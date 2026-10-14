import { Fragment, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getClientLog, getClients, getFilterLists, blockDomain, unblockDomain, isDnsBlocked,
  type QueryLogEntry, type AghClient
} from '../api'
import { format, parseISO } from 'date-fns'
import {
  ArrowLeft, RefreshCw, Download, Lock, ExternalLink
} from 'lucide-react'
import FaviconDomain from '../components/FaviconDomain'
import DomainDrawer from '../components/DomainDrawer'
import { exportQueryLog } from '../utils/export'
import { useToast } from '../contexts/ToastContext'
import { useServer } from '../contexts/ServerContext'
import { useCountUp } from '../hooks/useCountUp'
import { usePageTitle } from '../hooks/usePageTitle'

function StatusBadge({ reason }: { reason: string }) {
  if (reason.startsWith('NotFiltered') || reason.includes('WhiteList') || reason.includes('AllowList')) {
    return (
      <span className="status good text-[10px] py-0.5 px-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] shrink-0" />
        <span>Allowed</span>
      </span>
    )
  }
  if (reason.startsWith('Rewrite')) {
    return (
      <span className="status text-[10px] py-0.5 px-2 bg-[var(--surface-3)] text-[var(--text-2)] border border-[var(--border)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-2)] shrink-0" />
        <span>Rewrite</span>
      </span>
    )
  }
  return (
    <span className="status bad text-[10px] py-0.5 px-2">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)] shrink-0" />
      <span>Blocked</span>
    </span>
  )
}

function filterShort(name: string): string {
  if (!name) return 'Filter Rule'
  return name.replace(/^HaGeZi's /i, '').replace(/ (Blocklist|List|filter)$/i, '').slice(0, 30)
}

export default function ClientDetailPage() {
  const { ip } = useParams<{ ip: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { serverVersion } = useServer()

  const [entries, setEntries] = useState<QueryLogEntry[]>([])
  const [client, setClient] = useState<AghClient | null>(null)
  const [filterNames, setFilterNames] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [drawerDomain, setDrawerDomain] = useState<{ domain: string; blocked: boolean; count: number } | null>(null)

  const decodedIp = decodeURIComponent(ip || '')
  usePageTitle(client?.name ? `${client.name} (${decodedIp})` : decodedIp || 'Client Detail')

  const [refreshCount, setRefreshCount] = useState(0)
  const handleRefresh = () => {
    setLoading(true)
    setRefreshCount(c => c + 1)
  }

  useEffect(() => {
    let isMounted = true
    const fetchData = async () => {
      try {
        const [log, clients, filters] = await Promise.all([
          getClientLog(decodedIp, 300),
          getClients(),
          getFilterLists().catch(() => ({})),
        ])
        if (!isMounted) return
        setEntries(log.data || [])
        setFilterNames(filters)
        const found = clients.clients.find(c => c.ids?.includes(decodedIp))
        if (!found && clients.auto_clients) {
          const auto = clients.auto_clients.find(a => a.ip === decodedIp)
          if (auto) {
            setClient({
              name: auto.name || auto.ip,
              ids: [auto.ip],
              use_global_settings: true,
              filtering_enabled: true,
              parental_enabled: false,
              safebrowsing_enabled: false,
              safesearch_enabled: false,
              blocked_services: [],
              upstreams: [],
              tags: auto.source ? [`src_${auto.source.toLowerCase()}`] : [],
              ignore_querylog: false,
              ignore_statistics: false,
            })
          } else {
            setClient(null)
          }
        } else {
          setClient(found || null)
        }
      } catch (e) {
        console.error(e)
      } finally {
        if (isMounted) setLoading(false)
      }
    }
    fetchData()
    return () => {
      isMounted = false
    }
  }, [decodedIp, refreshCount, serverVersion])

  // Derived metrics
  const total = entries.length
  const blocked = entries.filter(e => isDnsBlocked(e)).length
  const cached = entries.filter(e => e.cached).length
  const blockPct = total > 0 ? ((blocked / total) * 100).toFixed(1) : '0'
  const cacheHitPct = total > 0 ? ((cached / total) * 100).toFixed(1) : '0'

  const animTotal = useCountUp(total)
  const animBlocked = useCountUp(blocked)
  const animCached = useCountUp(cached)

  // Top domains
  const domainCount: Record<string, number> = {}
  entries.forEach(e => {
    const d = e.question?.name
    if (d) domainCount[d] = (domainCount[d] || 0) + 1
  })
  const topDomains = Object.entries(domainCount).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const maxDomain = topDomains[0]?.[1] || 1

  // Top blocked
  const blockedCountMap: Record<string, number> = {}
  entries.filter(e => isDnsBlocked(e)).forEach(e => {
    const d = e.question?.name
    if (d) blockedCountMap[d] = (blockedCountMap[d] || 0) + 1
  })
  const topBlocked = Object.entries(blockedCountMap).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const maxBlocked = topBlocked[0]?.[1] || 1

  const displayName = client?.name || decodedIp

  const handleBlock = async (domain: string) => {
    try {
      await blockDomain(domain)
      toast(`${domain} blocked`, { type: 'success', undoFn: () => handleUnblock(domain) })
      setDrawerDomain(null)
    } catch { toast('Failed to block domain', { type: 'error' }) }
  }

  const handleUnblock = async (domain: string) => {
    try {
      await unblockDomain(domain)
      toast(`${domain} whitelisted`, { type: 'success', undoFn: () => handleBlock(domain) })
      setDrawerDomain(null)
    } catch { toast('Failed to unblock domain', { type: 'error' }) }
  }

  return (
    <div className="space-y-6 text-[var(--text)]">
      {/* ── Page Heading matching sample.html ── */}
      <section className="page-heading">
          <div className="flex items-start gap-3 sm:gap-4 min-w-0">
          <button
            onClick={() => navigate('/clients')}
            className="secondary-btn !min-h-[38px] mt-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Fleet</span>
          </button>
          <div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0">
              <h1 className="min-w-0 break-words">{displayName}</h1>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-[6px] bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] font-semibold">
                {decodedIp}
              </span>
            </div>
            <p className="subtitle">
              Sampled from last {entries.length} requests{client?.tags?.length ? ` · Tags: ${client.tags.join(', ')}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => exportQueryLog(entries, `${displayName.replace(/[^a-zA-Z0-9]/g, '_')}_queries.csv`)}
            className="secondary-btn"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="icon-btn"
            title="Refresh client requests"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </section>

      {/* ── Metric Cards matching sample.html ── */}
      <section className="metrics" aria-label="Client details metrics">
        <article className="card metric">
          <div className="metric-top"><span>Sampled Queries</span><span className="metric-symbol">◈</span></div>
          <div className="metric-value font-mono tabular-nums">{animTotal.toLocaleString()}</div>
          <div className="metric-foot">In local buffer window</div>
        </article>
        <article className="card metric">
          <div className="metric-top"><span>Blocked Queries</span><span className="metric-symbol">↗</span></div>
          <div className="metric-value font-mono tabular-nums">{animBlocked.toLocaleString()}</div>
          <div className="metric-foot"><span className="delta">{blockPct}%</span> block rate</div>
        </article>
        <article className="card metric">
          <div className="metric-top"><span>Cache Hits</span><span className="metric-symbol">◎</span></div>
          <div className="metric-value font-mono tabular-nums">{animCached.toLocaleString()}</div>
          <div className="metric-foot"><span className="delta">{cacheHitPct}%</span> hit rate</div>
        </article>
        <article className="card metric">
          <div className="metric-top"><span>Distinct Endpoints</span><span className="metric-symbol">⇄</span></div>
          <div className="metric-value font-mono tabular-nums">{Object.keys(domainCount).length.toLocaleString()}</div>
          <div className="metric-foot">Unique domain destinations</div>
        </article>
      </section>

      {/* Top Domains & Top Blocked */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        {/* Top Domains */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-primary)] flex items-center justify-between">
            <span>Top Domains Queried</span>
            <span className="text-[11px] text-[var(--text-tertiary)] font-normal">Click for inspector</span>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {topDomains.map(([d, c]) => (
              <div
                key={d}
                onClick={() => setDrawerDomain({ domain: d, blocked: false, count: c })}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <FaviconDomain domain={d} className="text-xs text-[var(--text-primary)] w-full font-mono" />
                  <div className="mt-1 h-1 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--text-primary)] opacity-40 rounded-full" style={{ width: `${(c / maxDomain) * 100}%` }} />
                  </div>
                </div>
                <span className="text-xs font-mono text-[var(--text-secondary)] shrink-0">{c}</span>
              </div>
            ))}
            {topDomains.length === 0 && <div className="px-4 py-6 text-center text-xs text-[var(--text-tertiary)]">No data</div>}
          </div>
        </div>

        {/* Top Blocked */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-primary)] flex items-center justify-between">
            <span>Top Blocked Domains</span>
            <span className="text-[11px] text-[var(--text-tertiary)] font-normal">Filtered requests</span>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {topBlocked.map(([d, c]) => (
              <div
                key={d}
                onClick={() => setDrawerDomain({ domain: d, blocked: true, count: c })}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <FaviconDomain domain={d} blocked className="text-xs text-[var(--text-secondary)] w-full font-mono" />
                  <div className="mt-1 h-1 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--red)] opacity-80 rounded-full" style={{ width: `${(c / maxBlocked) * 100}%` }} />
                  </div>
                </div>
                <span className="text-xs font-mono text-[var(--text-primary)] font-medium shrink-0">{c}</span>
              </div>
            ))}
            {topBlocked.length === 0 && <div className="px-4 py-6 text-center text-xs text-[var(--text-tertiary)]">No queries blocked for this device</div>}
          </div>
        </div>
      </div>

      {/* Query log table */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between">
          <div className="text-xs font-semibold text-[var(--text-primary)]">
            Device Query History <span className="text-[var(--text-tertiary)] font-normal ml-1">({entries.length} recent queries)</span>
          </div>
          <button
            onClick={() => navigate(`/live?client=${encodeURIComponent(decodedIp)}`)}
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>Open in Live Monitor</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>

        <div
          className="hidden md:grid gap-x-3 px-4 py-2.5 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider shrink-0"
          style={{ gridTemplateColumns: '84px 1fr 56px 64px 48px 84px' }}
        >
          <span>Time</span>
          <span>Domain · Filter attribution</span>
          <span>Type</span>
          <span>Latency</span>
          <span>Cache</span>
          <span>Status</span>
        </div>

        <div className="max-h-96 overflow-y-auto divide-y divide-[var(--border-subtle)]">
          {loading ? (
            <div className="py-10 text-center text-xs text-[var(--text-tertiary)]">Loading queries…</div>
          ) : entries.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--text-tertiary)]">No query activity recorded for this device</div>
          ) : (
            entries.map((e, i) => {
              const blocked = isDnsBlocked(e)
              const qtype = e.question?.type || ''
              const filterListName = e.rules?.[0] ? filterShort(filterNames[e.rules[0].filter_list_id] || '') : null

              return (
                <Fragment key={i}>
                <div
                  onClick={() => setDrawerDomain({ domain: e.question?.name || '', blocked: !!blocked, count: 1 })}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setDrawerDomain({ domain: e.question?.name || '', blocked: !!blocked, count: 1 }) } }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect ${e.question?.name || 'DNS query'}`}
                  className={`hidden md:grid gap-x-3 px-4 py-2 hover:bg-[var(--bg-hover)] cursor-pointer transition-colors ${
                    blocked ? 'bg-[var(--bg-active)]/30' : ''
                  }`}
                  style={{ gridTemplateColumns: '84px 1fr 56px 64px 48px 84px' }}
                >
                  <span className="text-[var(--text-tertiary)] font-mono text-[11px] self-center tabular-nums">
                    {e.time ? format(parseISO(e.time), 'HH:mm:ss') : '—'}
                  </span>

                  <div className="min-w-0 self-center">
                    <div className="flex items-center gap-1.5">
                      <FaviconDomain
                        domain={e.question?.name || ''}
                        blocked={!!blocked}
                        className={`text-xs font-mono ${blocked ? 'text-[var(--text-secondary)] font-normal' : 'text-[var(--text-primary)] font-medium'}`}
                      />
                      {e.answer_dnssec && <Lock className="w-3 h-3 text-[var(--text-tertiary)] shrink-0" />}
                    </div>
                    {filterListName && (
                      <div className="text-[10px] text-[var(--text-tertiary)] truncate mt-0.5 flex items-center gap-1 font-sans">
                        <span className="w-1 h-1 rounded-full bg-[var(--text-muted)]" />
                        <span>{filterListName}</span>
                      </div>
                    )}
                  </div>

                  <span className="self-center">
                    <span className="inline-block px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[10px] font-mono text-[var(--text-secondary)] font-medium">
                      {qtype}
                    </span>
                  </span>

                  <span className="text-[var(--text-secondary)] font-mono text-xs tabular-nums self-center">
                    {e.elapsedMs && parseFloat(e.elapsedMs) > 0
                      ? `${parseFloat(e.elapsedMs).toFixed(0)}ms`
                      : <span className="text-[var(--text-secondary)] text-[11px] font-mono font-medium">cache</span>
                    }
                  </span>

                  <span className={`text-[10px] font-medium font-mono self-center ${e.cached ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                    {e.cached ? 'HIT' : 'MISS'}
                  </span>

                  <div className="self-center">
                    <StatusBadge reason={e.reason} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerDomain({ domain: e.question?.name || '', blocked: !!blocked, count: 1 })}
                  className={`md:hidden w-full text-left px-3.5 py-3 hover:bg-[var(--bg-hover)] transition-colors ${
                    blocked ? 'bg-[var(--bg-active)]/30' : ''
                  }`}
                  aria-label={`Inspect ${e.question?.name || 'DNS query'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FaviconDomain
                          domain={e.question?.name || ''}
                          blocked={!!blocked}
                          className={`text-xs font-mono truncate ${blocked ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)] font-medium'}`}
                        />
                        {e.answer_dnssec && <Lock className="w-3 h-3 text-[var(--text-tertiary)] shrink-0" />}
                      </div>
                      {filterListName && <div className="mt-1 text-[10px] text-[var(--text-tertiary)] truncate">{filterListName}</div>}
                    </div>
                    <div className="shrink-0 scale-90 origin-top-right"><StatusBadge reason={e.reason} /></div>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-[10.5px] font-mono text-[var(--text-tertiary)]">
                    <span>{e.time ? format(parseISO(e.time), 'HH:mm:ss') : '—'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{qtype}</span>
                    <span aria-hidden="true">·</span>
                    <span>{e.elapsedMs && parseFloat(e.elapsedMs) > 0 ? `${parseFloat(e.elapsedMs).toFixed(0)}ms` : 'cache'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{e.cached ? 'HIT' : 'MISS'}</span>
                  </div>
                </button>
                </Fragment>
              )
            })
          )}
        </div>
      </div>

      {/* Domain details drawer */}
      <DomainDrawer
        domain={drawerDomain?.domain ?? null}
        blocked={drawerDomain?.blocked ?? false}
        count={drawerDomain?.count ?? 0}
        onClose={() => setDrawerDomain(null)}
        onBlock={handleBlock}
        onUnblock={handleUnblock}
        onViewLive={d => navigate(`/live?search=${encodeURIComponent(d)}`)}
      />
    </div>
  )
}
