import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  getStats, getStatus, getCacheStats, getQueryLog, blockDomain, unblockDomain,
  getApiUrl, isDnsBlocked, type AghStats, type AghStatus, type CacheStats, type QueryLogEntry
} from '../api'
import FaviconDomain from '../components/FaviconDomain'
import SpeedTestModal from '../components/SpeedTestModal'
import ProtectionPauseModal from '../components/ProtectionPauseModal'
import DomainDrawer from '../components/DomainDrawer'
import AnalyticsPage from './Analytics'
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts'
import {
  ShieldCheck, RefreshCw, Zap, Clock, Monitor, Smartphone,
  Laptop, Server, Radio, Pause, Play, AlertTriangle,
  ArrowRight, ShieldAlert, Activity, BarChart2
} from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useServer } from '../contexts/ServerContext'

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildChartData(stats: AghStats, isDaily = false) {
  const queries = stats.dns_queries || []
  const blocked = stats.blocked_filtering || []
  const now = new Date()
  const intervalMs = isDaily ? 24 * 3600 * 1000 : 3600 * 1000
  return queries.map((q, i) => {
    const offset = queries.length - i - 1
    const d = new Date(now.getTime() - offset * intervalMs)
    return {
      hour: isDaily
        ? d.toLocaleDateString([], { month: 'short', day: 'numeric' })
        : `${String(d.getHours()).padStart(2, '0')}:00`,
      Queries: q,
      Blocked: blocked[i] ?? 0,
    }
  })
}

function flattenTop(arr: Record<string, number>[] | undefined, n = 8): [string, number][] {
  if (!arr || arr.length === 0) return []
  return arr
    .flatMap(o => Object.entries(o) as [string, number][])
    .slice(0, n)
}

function safeNum(v: number | undefined | null): number {
  return typeof v === 'number' && isFinite(v) ? v : 0
}

function getDeviceIcon(clientName: string) {
  const n = (clientName || '').toLowerCase()
  if (n.includes('phone') || n.includes('pixel') || n.includes('iphone') || n.includes('android') || n.includes('samsung')) {
    return Smartphone
  }
  if (n.includes('mac') || n.includes('laptop') || n.includes('pc') || n.includes('desktop') || n.includes('windows') || n.includes('thinkpad')) {
    return Laptop
  }
  if (n.includes('nas') || n.includes('server') || n.includes('pi') || n.includes('gateway') || n.includes('router')) {
    return Server
  }
  return Monitor
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-2.5 shadow-xl text-xs space-y-1 min-w-[130px]">
      <div className="text-[10px] font-mono text-[var(--muted)] border-b border-[var(--border)] pb-1">
        Time: {label}
      </div>
      {payload.map(p => (
        <div key={p.name} className="flex items-center justify-between gap-3 font-mono">
          <span className="text-[var(--text-2)]">{p.name}:</span>
          <span className="text-[var(--text)] font-semibold tabular-nums">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl text-xs text-[var(--text)]">
      <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--red)]" />
      <span className="flex-1">{message}</span>
      <button
        onClick={onRetry}
        className="px-2.5 py-1 rounded-lg bg-[var(--text)] text-[var(--bg)] font-medium transition-colors cursor-pointer"
      >
        Retry
      </button>
    </div>
  )
}

// ── Main Overview Page ────────────────────────────────────────────────────────

export default function OverviewPage() {
  usePageTitle('Overview')
  const { serverVersion } = useServer()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isAnalyticsTab = searchParams.get('tab') === 'analytics'

  const [stats, setStats] = useState<AghStats | null>(null)
  const [status, setStatus] = useState<AghStatus | null>(null)
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null)
  const [recentLog, setRecentLog] = useState<QueryLogEntry[]>([])
  const [overviewChartMode, setOverviewChartMode] = useState<'volume' | 'latency'>('volume')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(() => new Date())
  const [protectionEnabled, setProtectionEnabled] = useState(true)
  const [protectionModalOpen, setProtectionModalOpen] = useState(false)
  const [speedTestOpen, setSpeedTestOpen] = useState(false)
  const [drawerDomain, setDrawerDomain] = useState<{ domain: string; blocked: boolean } | null>(null)
  const [streamPaused, setStreamPaused] = useState(false)
  const [domainFilter, setDomainFilter] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const [s, st, cs, ql] = await Promise.all([
        getStats(),
        getStatus(),
        getCacheStats(),
        getQueryLog({ limit: 150 }).catch(() => null),
      ])
      setStats(s)
      setStatus(st)
      setCacheStats(cs)
      if (ql?.data) setRecentLog(ql.data)
      setProtectionEnabled(st.protection_enabled)
      setLastRefresh(new Date())
      setError(null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load dashboard data'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + 5s live polling
  useEffect(() => {
    let isMounted = true
    const init = async () => {
      try {
        const [s, st, cs, ql] = await Promise.all([
          getStats(),
          getStatus(),
          getCacheStats(),
          getQueryLog({ limit: 150 }).catch(() => null),
        ])
        if (!isMounted) return
        setStats(s)
        setStatus(st)
        setCacheStats(cs)
        if (ql?.data) setRecentLog(ql.data)
        setProtectionEnabled(st.protection_enabled)
        setLastRefresh(new Date())
      } catch (e: unknown) {
        if (!isMounted) return
        const msg = e instanceof Error ? e.message : 'Failed to load dashboard data'
        setError(msg)
      } finally {
        if (isMounted) setLoading(false)
      }
    }
    init()

    const startPolling = () => {
      intervalRef.current = setInterval(() => {
        if (!document.hidden && !streamPaused && !isAnalyticsTab) refresh(true)
      }, 5000)
    }
    const stopPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling()
      } else {
        refresh(true)
        startPolling()
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      isMounted = false
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refresh, serverVersion, streamPaused, isAnalyticsTab])

  // Sync with global protection toggle events
  useEffect(() => {
    const handleToggle = (e: Event) => {
      const custom = e as CustomEvent<{ enabled?: boolean }>
      if (typeof custom.detail?.enabled === 'boolean') {
        setProtectionEnabled(custom.detail.enabled)
      }
    }
    window.addEventListener('agh:protection-toggled', handleToggle)
    return () => window.removeEventListener('agh:protection-toggled', handleToggle)
  }, [])

  // Live SSE stream
  useEffect(() => {
    if (streamPaused) return

    const es = new EventSource(getApiUrl('/querylog/stream'))
    es.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data)
        if (Array.isArray(raw) && (raw[0] as unknown as { __event?: string })?.__event === 'server_switched') {
          refresh(false)
          return
        }
        const entries: QueryLogEntry[] = raw
        if (Array.isArray(entries) && entries.length > 0) {
          setRecentLog(prev => {
            const combined = [...entries, ...prev]
            const seen = new Set<string>()
            const deduped: QueryLogEntry[] = []
            for (const item of combined) {
              const key = `${item.time}-${item.client}-${item.question?.name}`
              if (!seen.has(key)) {
                seen.add(key)
                deduped.push(item)
              }
            }
            return deduped.slice(0, 150)
          })

          setLastRefresh(new Date())
        }
      } catch {
        // ignore parse error
      }
    }
    return () => {
      es.close()
    }
  }, [refresh, streamPaused])

  // ── Derived values ──
  const totalQueries = safeNum(stats?.num_dns_queries)
  const totalBlocked = safeNum(stats?.num_blocked_filtering)

  const blockPct = useMemo(() => {
    if (!stats) return 0
    return (safeNum(stats.num_blocked_filtering) / Math.max(safeNum(stats.num_dns_queries), 1)) * 100
  }, [stats])

  const avgLatencyMs = useMemo(() => {
    if (cacheStats?.real_avg_latency_ms !== undefined && cacheStats.real_avg_latency_ms > 0) {
      return cacheStats.real_avg_latency_ms
    }
    if (!stats) return 0
    return safeNum(stats.avg_processing_time) * 1000
  }, [cacheStats, stats])

  // Health Score (0–100%)
  const healthRating = useMemo(() => {
    let score = 100
    if (!protectionEnabled) score -= 35
    if (avgLatencyMs > 60) score -= Math.min(25, Math.round((avgLatencyMs - 60) / 4))
    else if (avgLatencyMs > 30) score -= 5
    if (blockPct === 0 && totalQueries > 50) score -= 15
    const finalScore = Math.max(25, Math.min(100, Math.round(score)))
    let label = 'A+ Optimal'
    let colorClass = 'text-[var(--green)]'
    if (finalScore < 70) {
      label = 'C Warning'
      colorClass = 'text-[var(--red)]'
    } else if (finalScore < 88) {
      label = 'B Healthy'
      colorClass = 'text-[var(--text)]'
    }
    return { score: finalScore, label, colorClass }
  }, [protectionEnabled, avgLatencyMs, blockPct, totalQueries])

  const isDaily = Boolean(stats?.dns_queries && stats.dns_queries.length > 24)
  const chartData = useMemo(() => stats ? buildChartData(stats, isDaily) : [], [stats, isDaily])
  const topQueried = useMemo(() => flattenTop(stats?.top_queried_domains, 8), [stats])
  const topBlocked = useMemo(() => flattenTop(stats?.top_blocked_domains, 8), [stats])
  const topClients = useMemo(() => flattenTop(stats?.top_clients, 8), [stats])

  const filteredTopQueried = useMemo(() => {
    if (!domainFilter) return topQueried
    const q = domainFilter.toLowerCase()
    return topQueried.filter(([d]) => d.toLowerCase().includes(q))
  }, [topQueried, domainFilter])

  const primaryUpstream = useMemo(() => {
    if (!cacheStats?.upstreams) return null
    const entries = Object.entries(cacheStats.upstreams).sort((a, b) => b[1] - a[1])
    const top = entries[0]?.[0]
    if (!top) return null
    return top.replace('https://', '').replace('/dns-query', '')
  }, [cacheStats])

  const latencyTimeline = useMemo(() => {
    if (!recentLog || !recentLog.length) {
      const spark = cacheStats?.latency_spark
      if (spark && spark.length > 0) {
        return spark.map((ms, idx) => ({
          time: `T-${spark.length - idx}`,
          Latency: ms,
        }))
      }
      return []
    }
    const list = [...recentLog].reverse()
    const bucketMap: Record<string, { totalMs: number; count: number }> = {}

    list.forEach(e => {
      if (!e.time) return
      const t = new Date(e.time)
      const label = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      if (!bucketMap[label]) {
        bucketMap[label] = { totalMs: 0, count: 0 }
      }
      const ms = parseFloat(e.elapsedMs || '0')
      bucketMap[label].totalMs += ms
      bucketMap[label].count += 1
    })

    return Object.entries(bucketMap).map(([time, data]) => ({
      time,
      Latency: Math.round((data.totalMs / Math.max(data.count, 1)) * 10) / 10,
    }))
  }, [recentLog, cacheStats])

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto text-[var(--text)]">

      {/* ── Sub-Navigation: Summary vs Deep Analytics & Speed ── */}
      <div className="flex items-center gap-1.5 p-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setSearchParams({})}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
            !isAnalyticsTab
              ? 'bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] shadow-xs font-semibold'
              : 'text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Summary & Pulse</span>
        </button>
        <button
          type="button"
          onClick={() => setSearchParams({ tab: 'analytics' })}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
            isAnalyticsTab
              ? 'bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] shadow-xs font-semibold'
              : 'text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          <span>Analytics & Speed</span>
        </button>
      </div>

      {isAnalyticsTab ? (
        <AnalyticsPage />
      ) : (
        <>
          {/* ── 1. Page Header (Monochrome Standard) ── */}
          <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)] font-mono font-semibold">
            Network Monitoring / Executive Overview
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--text)] m-0 mt-1">
            Overview
          </h1>
          <p className="text-sm text-[var(--muted)] m-0 mt-1">
            Real-time DNS telemetry, threat interception, and network health.
          </p>
          <div className="flex items-center gap-3 text-xs text-[var(--muted)] font-mono mt-2.5 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[var(--muted)]" />
              {lastRefresh.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${protectionEnabled ? 'bg-[var(--green)] animate-pulse' : 'bg-[var(--red)]'}`} />
              <span className={protectionEnabled ? 'text-[var(--green)] font-semibold' : 'text-[var(--red)] font-semibold'}>
                {protectionEnabled ? 'Protection Active' : 'Protection Paused'}
              </span>
            </span>
            <span className="flex items-center gap-1.5 border-l border-[var(--border)] pl-3">
              <Activity className="w-3.5 h-3.5 text-[var(--muted)]" />
              <span>Health: </span>
              <span className={`font-mono font-bold ${healthRating.colorClass}`}>{healthRating.score}% ({healthRating.label})</span>
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setProtectionModalOpen(true)}
            className={`px-3.5 py-2 rounded-xl font-semibold text-xs transition-all cursor-pointer flex items-center gap-2 border ${
              protectionEnabled
                ? 'bg-[var(--fg)] text-[var(--bg)] border-transparent hover:opacity-90'
                : 'bg-[var(--red-bg)] text-[var(--red)] border-[var(--red)]/30 hover:bg-[var(--red)] hover:text-black'
            }`}
          >
            {protectionEnabled ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            <span>{protectionEnabled ? 'Protected' : 'Paused'}</span>
          </button>

          <button
            type="button"
            onClick={() => refresh()}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--surface-3)] font-medium text-xs transition-all cursor-pointer flex items-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setSpeedTestOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--surface-3)] font-medium text-xs transition-all cursor-pointer flex items-center gap-2"
          >
            <Zap className="w-3.5 h-3.5 text-[var(--text)]" />
            <span>Speed Race</span>
          </button>
        </div>
      </section>

      {/* Error banner if any */}
      {error && <ErrorBanner message={error} onRetry={() => refresh()} />}

      {/* ── 2. Top 4-Card Metrics Grid ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-3.5">
        {/* Metric 1: Total Queries */}
        <article
          onClick={() => setSearchParams({ tab: 'analytics' })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSearchParams({ tab: 'analytics' }) } }}
          role="button"
          tabIndex={0}
          aria-label="View Analytics"
          className="p-4 sm:p-4.5 rounded-2xl bg-[var(--card)] border border-[var(--border)] hover:border-[var(--strong-border)] transition-colors cursor-pointer select-none"
        >
          <div className="text-xs sm:text-[13px] text-[var(--muted)]">Total queries</div>
          <div className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-[var(--text)] my-2 sm:my-2.5">
            {totalQueries.toLocaleString()}
          </div>
          <div className="text-xs text-[var(--muted)]">Last 24 hours</div>
        </article>

        {/* Metric 2: Threats Filtered */}
        <article
          onClick={() => navigate('/security')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/security') } }}
          role="button"
          tabIndex={0}
          aria-label="View Security Threats"
          className="p-4 sm:p-4.5 rounded-2xl bg-[var(--card)] border border-[var(--border)] hover:border-[var(--strong-border)] transition-colors cursor-pointer select-none"
        >
          <div className="text-xs sm:text-[13px] text-[var(--muted)]">Threats filtered</div>
          <div className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-[var(--red)] my-2 sm:my-2.5">
            {blockPct.toFixed(1)}%
          </div>
          <div className="text-xs font-mono font-medium text-[var(--red)]">
            {totalBlocked.toLocaleString()} blocked requests
          </div>
        </article>

        {/* Metric 3: Mean Latency */}
        <article
          onClick={() => setSpeedTestOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSpeedTestOpen(true) } }}
          role="button"
          tabIndex={0}
          aria-label="Open Speed Race & Benchmarks"
          className="p-4 sm:p-4.5 rounded-2xl bg-[var(--card)] border border-[var(--border)] hover:border-[var(--strong-border)] transition-colors cursor-pointer select-none"
        >
          <div className="text-xs sm:text-[13px] text-[var(--muted)]">Mean latency</div>
          <div className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-[var(--text)] my-2 sm:my-2.5">
            {avgLatencyMs > 0 ? `${avgLatencyMs.toFixed(1)} ms` : '—'}
          </div>
          <div className="text-xs text-[var(--green)] font-medium">
            Across upstreams
          </div>
        </article>

        {/* Metric 4: Active Devices */}
        <article
          onClick={() => navigate('/clients')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/clients') } }}
          role="button"
          tabIndex={0}
          aria-label="View Fleet Clients"
          className="p-4 sm:p-4.5 rounded-2xl bg-[var(--card)] border border-[var(--border)] hover:border-[var(--strong-border)] transition-colors cursor-pointer select-none"
        >
          <div className="text-xs sm:text-[13px] text-[var(--muted)]">Active devices</div>
          <div className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-[var(--text)] my-2 sm:my-2.5">
            {topClients.length}
          </div>
          <div className="text-xs text-[var(--green)] font-medium">
            Clients online
          </div>
        </article>
      </section>

      {/* ── 3. Split 2-Column Responsive Layout ── */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 sm:gap-4 items-start">

        {/* ── LEFT COLUMN (7 Cols on Desktop) ── */}
        <div className="lg:col-span-7 space-y-3.5 sm:space-y-4">

          {/* Card A: Protection Active Hero Card */}
          <article className="p-4 sm:p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)] space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-[var(--text)] m-0">
                  {protectionEnabled ? 'Protection Active' : 'Protection Paused'}
                </h2>
                <p className="text-xs sm:text-[13px] text-[var(--muted)] m-0 mt-1 font-mono">
                  {primaryUpstream ? `${primaryUpstream} · Encrypted upstream` : 'Local AdGuard Core Engine'}
                </p>
              </div>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-semibold border ${
                protectionEnabled
                  ? 'bg-[var(--green-bg)] text-[var(--green)] border-[var(--green)]/30'
                  : 'bg-[var(--red-bg)] text-[var(--red)] border-[var(--red)]/30'
              }`}>
                ● {protectionEnabled ? 'Protected' : 'Paused'}
              </span>
            </div>

            {/* Progress label & Bar */}
            <div>
              <div className="flex items-center justify-between text-xs sm:text-[13px] text-[var(--muted)] mb-2">
                <span>Blocked today</span>
                <span className="font-mono text-[var(--text)] font-semibold">
                  {blockPct.toFixed(1)}%　
                  <span className="text-[var(--red)] font-normal font-mono">({totalBlocked.toLocaleString()} threats)</span>
                </span>
              </div>
              <div className="h-2 w-full bg-[var(--surface-3)] rounded-full overflow-hidden flex">
                <div
                  style={{ width: `${Math.min(100, Math.max(0, 100 - blockPct))}%` }}
                  className="h-full bg-[var(--fg)] transition-all duration-500"
                  title="Allowed traffic"
                />
                <div
                  style={{ width: `${Math.min(100, Math.max(0, blockPct))}%` }}
                  className="h-full bg-[var(--red)] transition-all duration-500"
                  title="Threats blocked"
                />
              </div>
            </div>

            {/* 3 Minis */}
            <div className="grid grid-cols-3 gap-2 sm:gap-2.5 pt-1">
              <div className="p-2.5 sm:p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
                <span className="text-[11px] text-[var(--muted)] block">Total queries</span>
                <strong className="text-base sm:text-lg font-bold font-mono text-[var(--text)] block mt-0.5">
                  {totalQueries.toLocaleString()}
                </strong>
                <span className="text-[10.5px] text-[var(--muted)]">Last 24h</span>
              </div>
              <div className="p-2.5 sm:p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
                <span className="text-[11px] text-[var(--muted)] block">Latency</span>
                <strong className="text-base sm:text-lg font-bold font-mono text-[var(--text)] block mt-0.5">
                  {avgLatencyMs > 0 ? `${avgLatencyMs.toFixed(1)} ms` : '—'}
                </strong>
                <span className="text-[10.5px] text-[var(--muted)]">Average</span>
              </div>
              <div className="p-2.5 sm:p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
                <span className="text-[11px] text-[var(--muted)] block">Devices</span>
                <strong className="text-base sm:text-lg font-bold font-mono text-[var(--text)] block mt-0.5">
                  {topClients.length}
                </strong>
                <span className="text-[10.5px] text-[var(--muted)]">Online</span>
              </div>
            </div>

            {/* Card Actions */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={() => setSpeedTestOpen(true)}
                className="px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--surface-3)] text-xs font-medium text-[var(--text)] flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <Zap className="w-3.5 h-3.5 text-[var(--muted)]" />
                <span>Speed Race</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById('live-stream-card')
                  if (el) el.scrollIntoView({ behavior: 'smooth' })
                  else navigate('/live')
                }}
                className="px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--surface-3)] text-xs font-medium text-[var(--text)] flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <Radio className="w-3.5 h-3.5 text-[var(--muted)]" />
                <span>Live Stream</span>
              </button>
              <button
                type="button"
                onClick={() => refresh()}
                disabled={loading}
                className="px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--surface-3)] text-xs font-medium text-[var(--text)] flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[var(--muted)] ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </article>

          {/* Card B: DNS Query Velocity Card */}
          <article className="p-4 sm:p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)] space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-[var(--text)] m-0">
                  DNS Query Velocity
                </h2>
                <p className="text-xs sm:text-[13px] text-[var(--muted)] m-0 mt-1">
                  24-hour request distribution across upstreams.
                </p>
              </div>
              <div className="flex items-center p-0.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl text-xs">
                <button
                  type="button"
                  onClick={() => setOverviewChartMode('volume')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                    overviewChartMode === 'volume'
                      ? 'bg-[var(--fg)] text-[var(--bg)] font-semibold shadow-xs'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Volume
                </button>
                <button
                  type="button"
                  onClick={() => setOverviewChartMode('latency')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                    overviewChartMode === 'latency'
                      ? 'bg-[var(--fg)] text-[var(--bg)] font-semibold shadow-xs'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Latency
                </button>
              </div>
            </div>

            <div style={{ height: 180 }} className="pt-2">
              {loading ? (
                <div className="w-full h-full bg-[var(--surface-2)] rounded-xl animate-pulse" />
              ) : overviewChartMode === 'volume' ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 0, left: -22, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} opacity={0.4} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fill: 'var(--muted)', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      interval={Math.max(1, Math.floor(chartData.length / 6))}
                    />
                    <YAxis
                      tick={{ fill: 'var(--muted)', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(128, 128, 128, 0.08)' }} />
                    <Bar
                      dataKey="Queries"
                      fill="var(--fg)"
                      opacity={0.85}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={16}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={latencyTimeline} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} opacity={0.4} />
                    <XAxis dataKey="time" tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} unit="ms" />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="Latency" stroke="var(--fg)" strokeWidth={1.5} fill="var(--surface-3)" fillOpacity={0.5} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="text-[11px] text-[var(--muted)]">Hourly distribution · Live telemetry</div>
          </article>

          {/* Card C: Real-Time Query Stream Card */}
          <article id="live-stream-card" className="p-4 sm:p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)] space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-[var(--text)] m-0">
                  Real-Time Query Stream
                </h2>
                <p className="text-xs sm:text-[13px] text-[var(--muted)] m-0 mt-1">
                  Live streaming lookups across network devices.
                </p>
              </div>
              <button
                type="button"
                onClick={() => refresh()}
                disabled={loading}
                className="p-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--surface-3)] text-[var(--muted)] hover:text-[var(--text)] cursor-pointer transition-colors"
                title="Refresh stream"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Stream Rows */}
            <div className="space-y-1 pt-1">
              {recentLog.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--muted)] font-mono">
                  Listening for incoming network queries...
                </div>
              ) : (
                recentLog.slice(0, 6).map((e, idx) => {
                  const isBlocked = isDnsBlocked(e)
                  const isRewrite = Boolean(e.reason?.startsWith('Rewrite'))
                  const clientName = e.client_info?.name || e.client
                  const timeStr = e.time ? new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
                  const domainName = e.question?.name || ''
                  const DeviceIcon = getDeviceIcon(clientName)

                  return (
                    <div
                      key={`${e.time}-${e.client}-${domainName}-${idx}`}
                      onClick={() => setDrawerDomain({ domain: domainName, blocked: isBlocked })}
                      className="py-2.5 px-2 border-b border-[var(--border)] last:border-b-0 text-xs hover:bg-[var(--surface-2)] rounded-xl transition-colors cursor-pointer select-none"
                    >
                      {/* Mobile Layout (< sm): 2-line list tile */}
                      <div className="flex sm:hidden flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="font-mono text-[var(--text)] font-semibold truncate text-xs" title={domainName}>
                            {domainName}
                          </span>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border shrink-0 ${
                            isBlocked
                              ? 'bg-[var(--red-bg)] text-[var(--red)] border-[var(--red)]/30 font-semibold'
                              : isRewrite
                                ? 'bg-[var(--surface-3)] text-[var(--text-2)] border-[var(--border)] font-semibold'
                                : 'bg-[var(--green-bg)] text-[var(--green)] border-[var(--green)]/30 font-semibold'
                          }`}>
                            ● {isBlocked ? 'Blocked' : isRewrite ? 'Rewrite' : 'Allowed'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-[var(--muted)] font-mono">
                          <div className="flex items-center gap-1.5 min-w-0 truncate">
                            <DeviceIcon className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
                            <span className="truncate text-[var(--text-2)] font-sans" title={clientName}>
                              {clientName}
                            </span>
                          </div>
                          <span className="shrink-0 text-[10.5px] tabular-nums">
                            {timeStr}
                          </span>
                        </div>
                      </div>

                      {/* Desktop Layout (>= sm): 4-column aligned table grid */}
                      <div className="hidden sm:grid sm:grid-cols-[78px_minmax(70px,0.8fr)_minmax(0,1.4fr)_auto] gap-2 items-center">
                        <span className="text-[11px] font-mono text-[var(--muted)] truncate tabular-nums">
                          {timeStr}
                        </span>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <DeviceIcon className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
                          <span className="text-[var(--text)] truncate font-medium" title={clientName}>
                            {clientName}
                          </span>
                        </div>
                        <span className="font-mono text-[var(--text-2)] hover:text-[var(--text)] truncate" title={domainName}>
                          {domainName}
                        </span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border shrink-0 ${
                          isBlocked
                            ? 'bg-[var(--red-bg)] text-[var(--red)] border-[var(--red)]/30 font-semibold'
                            : isRewrite
                              ? 'bg-[var(--surface-3)] text-[var(--text-2)] border-[var(--border)] font-semibold'
                              : 'bg-[var(--green-bg)] text-[var(--green)] border-[var(--green)]/30 font-semibold'
                        }`}>
                          ● {isBlocked ? 'Blocked' : isRewrite ? 'Rewrite' : 'Allowed'}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Card Actions */}
            <div className="flex items-center gap-2 pt-2 flex-wrap">
              <button
                type="button"
                onClick={() => setStreamPaused(p => !p)}
                className="px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--surface-3)] text-xs font-medium text-[var(--text)] flex items-center gap-1.5 cursor-pointer transition-all"
              >
                {streamPaused ? <Play className="w-3.5 h-3.5 text-[var(--green)]" /> : <Pause className="w-3.5 h-3.5 text-[var(--muted)]" />}
                <span>{streamPaused ? 'Resume stream' : 'Pause stream'}</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/live')}
                className="px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--surface-3)] text-xs font-medium text-[var(--text)] flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <span>Open Live DNS</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </article>
        </div>

        {/* ── RIGHT COLUMN (5 Cols on Desktop) ── */}
        <div className="lg:col-span-5 space-y-3.5 sm:space-y-4">

          {/* Card 1: Top Lookups */}
          <article className="p-4 sm:p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)] space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-[var(--text)] m-0">Top Lookups</h2>
                <p className="text-xs sm:text-[13px] text-[var(--muted)] m-0 mt-1">Most frequent queried domains</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/domains')}
                className="px-2.5 py-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--surface-3)] text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                View all →
              </button>
            </div>

            {/* Filter Input */}
            <input
              type="text"
              value={domainFilter}
              onChange={e => setDomainFilter(e.target.value)}
              placeholder="Search domains…"
              className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-hidden focus:border-[var(--strong-border)]"
            />

            {/* Rows */}
            <div className="space-y-0.5 pt-1">
              {filteredTopQueried.length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--muted)] font-mono">
                  No matching domains found
                </div>
              ) : (
                filteredTopQueried.map(([domain, count], idx) => (
                  <div
                    key={domain}
                    onClick={() => setDrawerDomain({ domain, blocked: false })}
                    className="grid grid-cols-[24px_minmax(0,1fr)_65px] gap-2 items-center py-2 border-b border-[var(--border)] last:border-b-0 text-xs hover:bg-[var(--surface-2)] px-2 rounded-xl transition-colors cursor-pointer select-none"
                  >
                    <span className="text-[11px] font-mono text-[var(--muted)]">
                      #{String(idx + 1).padStart(2, '0')}
                    </span>
                    <FaviconDomain domain={domain} className="font-mono text-xs text-[var(--text)] truncate" />
                    <span className="font-mono text-right text-[var(--muted)] tabular-nums">
                      {Number(count).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </article>

          {/* Card 2: Top Blocked Endpoints */}
          <article className="p-4 sm:p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)] space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-[var(--text)] m-0">Top Blocked Endpoints</h2>
                <p className="text-xs sm:text-[13px] text-[var(--muted)] m-0 mt-1">Filtered ad, tracker and threat hosts</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/security')}
                className="px-2.5 py-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--surface-3)] text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                Security →
              </button>
            </div>

            {/* Rows */}
            <div className="space-y-0.5 pt-1">
              {topBlocked.length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--muted)] font-mono">
                  No blocked endpoints recorded
                </div>
              ) : (
                topBlocked.map(([domain, count]) => (
                  <div
                    key={domain}
                    onClick={() => setDrawerDomain({ domain, blocked: true })}
                    className="grid grid-cols-[24px_minmax(0,1fr)_65px] gap-2 items-center py-2 border-b border-[var(--border)] last:border-b-0 text-xs hover:bg-[var(--surface-2)] px-2 rounded-xl transition-colors cursor-pointer select-none"
                  >
                    <span className="text-[var(--red)] text-xs">●</span>
                    <FaviconDomain domain={domain} blocked className="font-mono text-xs text-[var(--text-2)] truncate" />
                    <span className="font-mono text-right text-[var(--red)] tabular-nums font-semibold">
                      {Number(count).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </article>

          {/* Card 3: Active Network Fleet */}
          <article className="p-4 sm:p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)] space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-[var(--text)] m-0">Active Network Fleet</h2>
                <p className="text-xs sm:text-[13px] text-[var(--muted)] m-0 mt-1">Top devices by request volume</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/clients')}
                className="px-2.5 py-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--surface-3)] text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                Fleet →
              </button>
            </div>

            {/* Rows */}
            <div className="space-y-0.5 pt-1">
              {topClients.length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--muted)] font-mono">
                  No client activity recorded
                </div>
              ) : (
                topClients.map(([client, count], idx) => {
                  const pct = totalQueries > 0 ? Math.round((count / totalQueries) * 100) : 0
                  return (
                    <div
                      key={client}
                      onClick={() => navigate(`/clients/${encodeURIComponent(client)}`)}
                      className="grid grid-cols-[minmax(0,1fr)_42px_65px] gap-2 items-center py-2 border-b border-[var(--border)] last:border-b-0 text-xs hover:bg-[var(--surface-2)] px-2 rounded-xl transition-colors cursor-pointer select-none"
                    >
                      <span className="truncate font-mono text-[var(--text)]" title={client}>
                        #{idx + 1}　{client}
                      </span>
                      <span className="text-[var(--muted)] font-mono text-right">
                        {pct}%
                      </span>
                      <span className="font-mono text-right text-[var(--muted)] tabular-nums">
                        {Number(count).toLocaleString()}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </article>

          {/* Card 4: System Status */}
          <article className="p-4 sm:p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)] space-y-3">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[var(--text)] m-0">System status</h2>
              <p className="text-xs sm:text-[13px] text-[var(--muted)] m-0 mt-1">AdGuard Home node status</p>
            </div>

            <div className="space-y-0.5 pt-1 text-xs">
              <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] gap-2 items-center py-2 border-b border-[var(--border)]">
                <span className="font-mono text-[var(--muted)]">01</span>
                <span className="text-[var(--text)] font-medium">DNS engine</span>
                <span className={`${status?.running ? 'text-[var(--green)]' : 'text-[var(--red)]'} font-semibold flex items-center gap-1 font-mono`}>
                  ● {status?.running ? 'Running' : 'Stopped'}
                </span>
              </div>
              <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] gap-2 items-center py-2 border-b border-[var(--border)]">
                <span className="font-mono text-[var(--muted)]">02</span>
                <span className="text-[var(--text)] font-medium">Encrypted upstream</span>
                <span className="text-[var(--green)] font-semibold flex items-center gap-1 font-mono">
                  ● {primaryUpstream ? 'Ready' : 'Connected'}
                </span>
              </div>
              <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] gap-2 items-center py-2 border-b border-[var(--border)]">
                <span className="font-mono text-[var(--muted)]">03</span>
                <span className="text-[var(--text)] font-medium">Core version</span>
                <span className="font-mono text-[var(--muted)]">
                  v{status?.version || '0.107'}
                </span>
              </div>
              <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] gap-2 items-center py-2">
                <span className="font-mono text-[var(--muted)]">04</span>
                <span className="text-[var(--text)] font-medium">DNS Port</span>
                <span className="font-mono text-[var(--muted)]">
                  :{status?.dns_port || '53'}
                </span>
              </div>
            </div>
          </article>

        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="pt-4 pb-2 border-t border-[var(--border)] text-xs text-[var(--muted)] flex flex-col sm:flex-row items-center justify-between gap-2">
        <span>DNS CONTROL · MONOCHROME UNIFIED DASHBOARD</span>
        <span>AdGuard Home Core v{status?.version || '0.107'} · Port {status?.http_port || '80'}</span>
      </footer>
      </>
      )}

      {/* ── Modals & Drawers ── */}
      <ProtectionPauseModal
        open={protectionModalOpen}
        onClose={() => setProtectionModalOpen(false)}
        onToggle={(enabled) => {
          setProtectionEnabled(enabled)
          window.dispatchEvent(new CustomEvent('agh:protection-toggled', { detail: { enabled } }))
        }}
        currentlyEnabled={protectionEnabled}
      />

      <SpeedTestModal open={speedTestOpen} onClose={() => setSpeedTestOpen(false)} />

      <DomainDrawer
        domain={drawerDomain?.domain || null}
        blocked={drawerDomain?.blocked || false}
        onClose={() => setDrawerDomain(null)}
        onBlock={blockDomain}
        onUnblock={unblockDomain}
        onViewLive={(d) => navigate(`/live?search=${encodeURIComponent(d)}`)}
      />
    </div>
  )
}
