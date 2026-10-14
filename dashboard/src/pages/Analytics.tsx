import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  type AghStats,
  type CacheStats,
  type QueryLogEntry,
  type Clients,
  type ResolverComparisonResponse,
  getStats,
  getCacheStats,
  getQueryLog,
  getClientLog,
  getClients,
  getResolverComparison,
  runResolverRace,
} from '../api'
import Section from '../components/Section'
import StatCard from '../components/StatCard'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line
} from 'recharts'
import {
  RefreshCw, Download, Zap, Shield,
  Server, ChevronRight, Filter, Clock, Radio,
  Trophy, Activity, Layers
} from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useServer } from '../contexts/ServerContext'

// ── Monochrome Tooltip Styling ──────────────────────────────────────────────────
const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-strong)',
    borderRadius: 10,
    fontSize: 12,
    boxShadow: '0 12px 32px rgba(0,0,0,0.15)',
    padding: '8px 12px',
  },
  labelStyle: { color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 },
  itemStyle: { fontSize: 11, padding: '2px 0', color: 'var(--text-secondary)' },
}

function cleanUpstreamName(url: string): { name: string; proto: string; cleanUrl: string } {
  const cleanUrl = url.replace('https://', '').replace('/dns-query', '')
  let name = cleanUrl
  let proto = 'DoH'

  if (url.includes('cloudflare')) name = 'Cloudflare DNS'
  else if (url.includes('google')) name = 'Google DNS'
  else if (url.includes('quad9')) name = 'Quad9 DNS'
  else if (url.includes('adguard')) name = 'AdGuard DNS'
  else if (url.includes('opendns')) name = 'OpenDNS'

  if (url.startsWith('tls://')) proto = 'DoT'
  else if (url.startsWith('quic://')) proto = 'DoQ'
  else if (!url.includes('://') && url.includes(':53')) proto = 'UDP'

  return { name, proto, cleanUrl }
}

export default function AnalyticsPage() {
  usePageTitle('Analytics')
  const { serverVersion } = useServer()
  const navigate = useNavigate()

  // Primary data states
  const [stats, setStats] = useState<AghStats | null>(null)
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null)
  const [queryLog, setQueryLog] = useState<QueryLogEntry[]>([])
  const [clients, setClients] = useState<Clients | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Top-Level Analytics Tab State
  const [activeTab, setActiveTab] = useState<'traffic' | 'latency' | 'upstreams' | 'protocols'>('traffic')

  // Filters & Interactivity
  const [selectedClient, setSelectedClient] = useState<string>('all')
  const [clientLog, setClientLog] = useState<QueryLogEntry[]>([])
  const [prevClient, setPrevClient] = useState(selectedClient)
  const [clientLogLoaded, setClientLogLoaded] = useState(true)

  if (selectedClient !== prevClient) {
    setPrevClient(selectedClient)
    setClientLogLoaded(selectedClient === 'all')
  }

  const loadingClientLog = !clientLogLoaded && selectedClient !== 'all'
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(() => Date.now())
  const [chartSeries, setChartSeries] = useState({
    queries: true,
    blocked: true,
    malware: false,
    parental: false,
  })
  const [latencyViewMode, setLatencyViewMode] = useState<'timeline' | 'rolling' | 'blockrate'>('timeline')
  const [upstreamViewMode, setUpstreamViewMode] = useState<'split' | 'list'>('split')
  const [resolverData, setResolverData] = useState<ResolverComparisonResponse | null>(null)
  const [racingResolvers, setRacingResolvers] = useState(false)
  const [raceToast, setRaceToast] = useState<string | null>(null)
  const [resolverFilter, setResolverFilter] = useState<'all' | 'quad9' | 'cloudflare' | 'google'>('all')

  // Fetch dedicated client logs when a specific device is selected
  useEffect(() => {
    if (selectedClient === 'all') {
      return
    }
    let isMounted = true
    getClientLog(selectedClient, 500)
      .then(res => {
        if (isMounted) {
          setClientLog(res.data || [])
          setClientLogLoaded(true)
        }
      })
      .catch(() => {
        if (isMounted) {
          setClientLog([])
          setClientLogLoaded(true)
        }
      })
    return () => {
      isMounted = false
    }
  }, [selectedClient])

  // Active query log used for latency and protocol breakdowns
  const activeLog = useMemo(() => {
    if (selectedClient !== 'all') {
      if (clientLog.length > 0) return clientLog
      return queryLog.filter(e => e.client === selectedClient)
    }
    return queryLog
  }, [selectedClient, clientLog, queryLog])

  // Fetch all analytics datasets
  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)

    try {
      const [s, cs, ql, cl, rc] = await Promise.all([
        getStats().catch(() => null),
        getCacheStats().catch(() => null),
        getQueryLog({ limit: 1000 }).catch(() => ({ data: [], oldest: '', total: 0 })),
        getClients().catch(() => null),
        getResolverComparison().catch(() => null),
      ])

      if (s) setStats(s)
      if (cs) setCacheStats(cs)
      if (ql?.data) setQueryLog(ql.data)
      if (cl) setClients(cl)
      if (rc) setResolverData(rc)
      setLastRefreshedAt(Date.now())
    } catch (err) {
      console.error('Failed to load analytics telemetry', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Instant multi-resolver speed race trigger
  const handleRunRace = async () => {
    if (racingResolvers) return
    setRacingResolvers(true)
    setRaceToast(null)
    try {
      const res = await runResolverRace()
      if (res?.ok && res.race) {
        setResolverData(prev => {
          if (!prev) return null
          const raceObj = res.race as unknown as Record<string, number | string | undefined>
          const updatedProviders = prev.providers.map(p => ({
            ...p,
            liveLatencyMs: typeof raceObj[p.id] === 'number' ? (raceObj[p.id] as number) : p.liveLatencyMs,
          }))
          const leaderboard = [...updatedProviders].sort((a, b) => a.liveLatencyMs - b.liveLatencyMs).map((p, idx) => ({
            ...p,
            rank: idx + 1,
            medal: idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉',
          }))
          return {
            ...prev,
            providers: updatedProviders,
            leaderboard,
            timeline: res.timeline || prev.timeline,
            latestRace: res.race,
          }
        })
        const winnerKey = res.race.winner as 'cloudflare' | 'google' | 'quad9'
        const winnerMs = res.race[winnerKey]
        setRaceToast(`🏁 Instant Race Winner: ${res.race.winnerName} (${winnerMs} ms) — faster by ${res.race.marginMs} ms!`)
        setTimeout(() => setRaceToast(null), 7000)
      }
    } catch (err) {
      console.error('Failed to run resolver race', err)
    } finally {
      setRacingResolvers(false)
    }
  }

  useEffect(() => {
    let isMounted = true
    const init = async () => {
      try {
        const [s, cs, ql, cl, rc] = await Promise.all([
          getStats().catch(() => null),
          getCacheStats().catch(() => null),
          getQueryLog({ limit: 1000 }).catch(() => ({ data: [], oldest: '', total: 0 })),
          getClients().catch(() => null),
          getResolverComparison().catch(() => null),
        ])

        if (!isMounted) return
        if (s) setStats(s)
        if (cs) setCacheStats(cs)
        if (ql?.data) setQueryLog(ql.data)
        if (cl) setClients(cl)
        if (rc) setResolverData(rc)
        setLastRefreshedAt(Date.now())
      } catch (err) {
        if (!isMounted) return
        console.error('Failed to load analytics telemetry', err)
      } finally {
        if (isMounted) setLoading(false)
      }
    }
    init()

    const interval = setInterval(() => {
      if (!document.hidden) loadData(true)
    }, 10_000)
    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [loadData, serverVersion])

  // ── Derived Hourly/Daily Chart Series ─────────────────────────────────────────────
  const isDaily = Boolean(stats?.dns_queries && stats.dns_queries.length > 24)
  const chartData = useMemo(() => {
    if (!stats) return []
    const queries = stats.dns_queries || []
    return queries.map((q, i) => {
      const b = stats.blocked_filtering?.[i] || 0
      const m = stats.replaced_safebrowsing?.[i] || 0
      const p = stats.replaced_parental?.[i] || 0
      const blockRate = q > 0 ? Math.round((b / q) * 1000) / 10 : 0
      const offset = queries.length - i - 1
      const intervalMs = isDaily ? 24 * 3600 * 1000 : 3600 * 1000
      const d = new Date(lastRefreshedAt - offset * intervalMs)
      const label = isDaily
        ? d.toLocaleDateString([], { month: 'short', day: 'numeric' })
        : `${String(d.getHours()).padStart(2, '0')}:00`
      return {
        hour: label,
        Queries: q,
        Blocked: b,
        Malware: m,
        Parental: p,
        BlockPct: blockRate,
      }
    })
  }, [stats, lastRefreshedAt, isDaily])

  // Peak Traffic Insights
  const peakInsights = useMemo(() => {
    if (chartData.length === 0) return null
    let maxQ = { hour: '00:00', val: 0 }
    let minQ = { hour: '00:00', val: Infinity }
    let maxB = { hour: '00:00', val: 0, pct: 0 }

    chartData.forEach(d => {
      if (d.Queries > maxQ.val) maxQ = { hour: d.hour, val: d.Queries }
      if (d.Queries < minQ.val && d.Queries > 0) minQ = { hour: d.hour, val: d.Queries }
      if (d.Blocked > maxB.val) maxB = { hour: d.hour, val: d.Blocked, pct: d.BlockPct }
    })

    return { maxQ, minQ, maxB }
  }, [chartData])

  // ── Derived Latency Profile Buckets ─────────────────────────────────────────
  const latencyProfile = useMemo(() => {
    const buckets = {
      under5: 0,    // Cache / local RAM
      ms5to25: 0,   // Ultra-fast direct edge
      ms25to50: 0,  // Standard DoH/DoT
      ms50to100: 0, // Elevated latency
      over100: 0,   // High latency / slow
    }

    const totalSampled = activeLog.length || 1

    activeLog.forEach(e => {
      const ms = parseFloat(e.elapsedMs) || 0
      if (ms < 5) buckets.under5++
      else if (ms < 25) buckets.ms5to25++
      else if (ms < 50) buckets.ms25to50++
      else if (ms < 100) buckets.ms50to100++
      else buckets.over100++
    })

    return [
      {
        label: '< 5 ms',
        name: 'Ultra-Fast (Cache / RAM)',
        count: buckets.under5,
        pct: Math.round((buckets.under5 / totalSampled) * 100),
        dotColor: 'bg-[var(--green)]',
        textColor: 'text-[var(--green)]',
        barColor: 'var(--green)',
        badge: 'good',
      },
      {
        label: '5 – 25 ms',
        name: 'Fast Edge Lookups',
        count: buckets.ms5to25,
        pct: Math.round((buckets.ms5to25 / totalSampled) * 100),
        dotColor: 'bg-[var(--green)] opacity-80',
        textColor: 'text-[var(--green)]',
        barColor: 'color-mix(in srgb, var(--green) 75%, var(--text))',
        badge: 'good',
      },
      {
        label: '25 – 50 ms',
        name: 'Standard Upstream',
        count: buckets.ms25to50,
        pct: Math.round((buckets.ms25to50 / totalSampled) * 100),
        dotColor: 'bg-[var(--text-secondary)]',
        textColor: 'text-[var(--text-primary)]',
        barColor: 'var(--text-secondary)',
        badge: 'neutral',
      },
      {
        label: '50 – 100 ms',
        name: 'Elevated Latency',
        count: buckets.ms50to100,
        pct: Math.round((buckets.ms50to100 / totalSampled) * 100),
        dotColor: 'bg-[var(--muted)]',
        textColor: 'text-[var(--muted)]',
        barColor: 'var(--border-strong)',
        badge: 'neutral',
      },
      {
        label: '> 100 ms',
        name: 'High Latency / Slow',
        count: buckets.over100,
        pct: Math.round((buckets.over100 / totalSampled) * 100),
        dotColor: 'bg-[var(--red)]',
        textColor: 'text-[var(--red)]',
        barColor: 'var(--red)',
        badge: 'bad',
      },
    ]
  }, [activeLog])

  // ── Record Types & Protocols Distribution ───────────────────────────────────
  const recordDistribution = useMemo(() => {
    const types: Record<string, number> = {}
    const protos: Record<string, number> = {}
    const total = activeLog.length || 1

    activeLog.forEach(e => {
      const t = e.question?.type || 'OTHER'
      types[t] = (types[t] || 0) + 1
      const p = e.client_proto || 'UDP'
      protos[p] = (protos[p] || 0) + 1
    })

    const sortedTypes = Object.entries(types)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        type,
        count,
        pct: Math.round((count / total) * 100),
      }))

    const sortedProtos = Object.entries(protos)
      .sort((a, b) => b[1] - a[1])
      .map(([proto, count]) => ({
        proto,
        count,
        pct: Math.round((count / total) * 100),
      }))

    return { sortedTypes, sortedProtos }
  }, [activeLog])

  // ── Derived Latency Timeline Series (Adaptive Time Series) ───────────────────
  const latencyTimelineData = useMemo(() => {
    if (!activeLog || !activeLog.length) return []
    const list = [...activeLog].reverse() // chronological order (oldest to newest)
    const firstTime = list[0]?.time
    const lastTime = list[list.length - 1]?.time
    const startTime = firstTime ? new Date(firstTime).getTime() : 0
    const endTime = lastTime ? new Date(lastTime).getTime() : startTime
    const spanMinutes = Math.max((endTime - startTime) / (1000 * 60), 1)

    const bucketMap: Record<string, { totalMs: number; count: number; upstreamMs: number; upstreamCount: number }> = {}

    list.forEach(e => {
      if (!e.time) return
      const t = new Date(e.time)
      let label: string
      if (spanMinutes <= 45) {
        label = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      } else if (spanMinutes <= 360) {
        const m = Math.floor(t.getMinutes() / 5) * 5
        label = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).replace(/:\d\d/, ':' + String(m).padStart(2, '0'))
      } else {
        label = t.toLocaleTimeString([], { hour: '2-digit' })
      }

      if (!bucketMap[label]) {
        bucketMap[label] = { totalMs: 0, count: 0, upstreamMs: 0, upstreamCount: 0 }
      }
      const ms = parseFloat(e.elapsedMs || '0')
      bucketMap[label].totalMs += ms
      bucketMap[label].count++
      if (e.upstream && !e.cached) {
        bucketMap[label].upstreamMs += ms
        bucketMap[label].upstreamCount++
      }
    })

    return Object.entries(bucketMap).map(([time, val]) => {
      const avg = val.count > 0 ? Math.round((val.totalMs / val.count) * 10) / 10 : 0
      const upstreamAvg = val.upstreamCount > 0 ? Math.round((val.upstreamMs / val.upstreamCount) * 10) / 10 : 0
      return {
        time,
        hour: time,
        Latency: avg,
        UpstreamLatency: upstreamAvg,
        Samples: val.count,
      }
    })
  }, [activeLog])

  // Rolling real-time query-by-query latency wave
  const rollingLatencyData = useMemo(() => {
    if (!activeLog || !activeLog.length) return []
    return [...activeLog].slice(0, 32).reverse().map((e, idx) => {
      const ms = parseFloat(e.elapsedMs || '0')
      const timeStr = e.time ? new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : `#${idx + 1}`
      const domain = e.question?.name || 'Unknown'
      return {
        index: idx + 1,
        time: timeStr,
        domain: domain.length > 22 ? domain.slice(0, 20) + '…' : domain,
        fullDomain: domain,
        Latency: Math.min(ms, 300),
        actualLatency: ms,
        cached: e.cached,
        upstream: e.upstream ? e.upstream.replace('https://', '').replace('/dns-query', '') : 'Cache / Local RAM',
      }
    })
  }, [activeLog])

  // ── Upstream Resolvers Performance Analysis ─────────────────────────────────
  const upstreamsAnalysis = useMemo(() => {
    if (!stats?.top_upstreams_responses) return []

    const timesMap: Record<string, number> = {}
    ;(stats.top_upstreams_avg_time || []).forEach(o => {
      Object.entries(o).forEach(([u, t]) => {
        timesMap[u] = Math.round(t * 1000 * 10) / 10
      })
    })

    const list = stats.top_upstreams_responses.flatMap(o => Object.entries(o))
    const totalResp = list.reduce((sum, [, count]) => sum + count, 0) || 1

    return list
      .sort((a, b) => b[1] - a[1])
      .map(([url, count]) => {
        const { name, proto, cleanUrl } = cleanUpstreamName(url)
        const avgTimeMs = timesMap[url] ?? 0
        const sharePct = Math.round((count / totalResp) * 1000) / 10

        return {
          rawUrl: url,
          name,
          proto,
          cleanUrl,
          count,
          sharePct,
          avgTimeMs,
          status: avgTimeMs < 75 ? 'Optimal' : avgTimeMs < 110 ? 'Elevated' : 'Slow',
        }
      })
  }, [stats])

  // ── Top Clients Breakdown ───────────────────────────────────────────────────
  const clientBreakdown = useMemo(() => {
    if (!stats?.top_clients) return []
    const totalQ = stats.num_dns_queries || 1
    const friendlyMap: Record<string, string> = {}

    clients?.clients?.forEach(c => {
      c.ids?.forEach(id => {
        friendlyMap[id] = c.name
      })
    })

    return stats.top_clients
      .flatMap(o => Object.entries(o))
      .sort((a, b) => b[1] - a[1])
      .map(([ip, count], idx) => {
        const sharePct = Math.round((count / totalQ) * 1000) / 10
        const friendlyName = friendlyMap[ip] || ''

        return {
          rank: idx + 1,
          ip,
          name: friendlyName,
          count,
          sharePct,
        }
      })
  }, [stats, clients])

  // ── Export Analytics Report ─────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (!stats) return
    const lines = [
      'DNS Traffic Telemetry & Analytics Report',
      `Exported: ${new Date().toISOString()}`,
      `Total Queries: ${stats.num_dns_queries}`,
      `Blocked Filtering: ${stats.num_blocked_filtering}`,
      `Malware Blocked: ${stats.num_replaced_safebrowsing}`,
      `Parental Blocked: ${stats.num_replaced_parental}`,
      `Average Latency (ms): ${(stats.avg_processing_time * 1000).toFixed(1)}`,
      '',
      'Hourly Traffic Velocity:',
      'Hour,Total Queries,Blocked Queries,Malware,Parental,Block Rate %',
      ...chartData.map(d => `${d.hour},${d.Queries},${d.Blocked},${d.Malware},${d.Parental},${d.BlockPct}%`),
      '',
      'Upstream Resolvers Performance:',
      'Resolver,URL,Responses,Traffic Share %,Average Latency (ms)',
      ...upstreamsAnalysis.map(u => `"${u.name}","${u.rawUrl}",${u.count},${u.sharePct}%,${u.avgTimeMs} ms`),
      '',
      'Top Client Distribution:',
      'Rank,IP Address,Client Name,Queries,Traffic Share %',
      ...clientBreakdown.map(c => `${c.rank},${c.ip},"${c.name}",${c.count},${c.sharePct}%`),
    ]

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `adguard-telemetry-report-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Calculated overall metrics
  const avgQPS = stats ? ((stats.num_dns_queries) / (24 * 3600)).toFixed(1) : '0.0'
  const blockPct = stats ? ((stats.num_blocked_filtering / Math.max(stats.num_dns_queries, 1)) * 100).toFixed(1) : '0.0'
  const rawHitRate = cacheStats?.cache_hit_rate ?? 0
  const cacheHitRate = (rawHitRate > 1 ? rawHitRate : rawHitRate * 100).toFixed(1)
  const avgLatency = (cacheStats?.real_avg_latency_ms !== undefined && cacheStats.real_avg_latency_ms > 0)
    ? cacheStats.real_avg_latency_ms.toFixed(1)
    : stats ? (stats.avg_processing_time * 1000).toFixed(1) : '0.0'

  const allowedCount = Math.max((stats?.num_dns_queries || 0) - (stats?.num_blocked_filtering || 0), 0)
  const allowedPct = stats?.num_dns_queries ? ((allowedCount / stats.num_dns_queries) * 100).toFixed(1) : '100.0'

  return (
    <div className="space-y-6 text-[var(--text)]">
      {/* ── Page Heading matching design standards (Desktop) ── */}
      <section className="page-heading hidden sm:flex">
        <div>
          <h1>Analytics &amp; Observability</h1>
          <div className="subtitle">
            24-hour DNS telemetry, latency profiling, upstream benchmarking &amp; network traffic distribution.
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Client Filter */}
          <div className="flex items-center gap-1.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-[9px] px-2.5 py-1.5 text-xs">
            <Filter className="w-3.5 h-3.5 text-[var(--muted)]" />
            <select
              value={selectedClient}
              onChange={e => setSelectedClient(e.target.value)}
              className="bg-transparent text-[var(--text)] text-xs focus:outline-none cursor-pointer"
            >
              <option value="all">All Network Fleet</option>
              {clientBreakdown.map(c => (
                <option key={c.ip} value={c.ip}>
                  {c.name ? `${c.name} (${c.ip})` : c.ip}
                </option>
              ))}
            </select>
          </div>

          {/* Export Report Button */}
          <button
            onClick={handleExportCSV}
            className="secondary-btn"
            title="Download CSV analytics telemetry"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="icon-btn"
            title="Refresh analytics"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </section>

      {/* ── Mobile Analytics Filter Bar (X-Style) ── */}
      <div className="sm:hidden space-y-2">
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
          <div className="flex items-center gap-1.5 min-w-0">
            <Filter className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
            <select
              value={selectedClient}
              onChange={e => setSelectedClient(e.target.value)}
              className="bg-transparent text-[var(--text)] text-xs font-medium focus:outline-none cursor-pointer truncate max-w-[200px]"
            >
              <option value="all">Fleet: All Devices</option>
              {clientBreakdown.map(c => (
                <option key={c.ip} value={c.ip}>
                  {c.name ? `${c.name} (${c.ip})` : c.ip}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleExportCSV}
              className="secondary-btn !min-h-[30px] !text-xs !py-1 flex items-center gap-1"
            >
              <Download className="w-3 h-3" />
              <span>CSV</span>
            </button>
            <button
              type="button"
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="p-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* 3-pill quick metrics with semantic accents */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-left">
            <div className="text-[10px] uppercase font-semibold text-[var(--muted)]">Velocity</div>
            <div className="text-xs font-mono font-bold text-[var(--text)] truncate">
              {stats?.num_dns_queries?.toLocaleString() ?? 0}
            </div>
          </div>
          <div className="p-2 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-left">
            <div className="text-[10px] uppercase font-semibold text-[var(--red)] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
              Blocked
            </div>
            <div className="text-xs font-mono font-bold text-[var(--red)] truncate">
              {blockPct}%
            </div>
          </div>
          <div className="p-2 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-left">
            <div className="text-[10px] uppercase font-semibold text-[var(--green)] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
              Speed
            </div>
            <div className="text-xs font-mono font-bold text-[var(--green)] truncate">
              {avgLatency}ms
            </div>
          </div>
        </div>
      </div>

      {/* ── Executive Top KPI Metric Cards (Desktop) ── */}
      <section className="metrics hidden sm:grid grid-cols-2 lg:grid-cols-5 gap-3.5" aria-label="Analytics key metrics">
        <StatCard
          label="Total Velocity"
          value={stats?.num_dns_queries ?? 0}
          sub={`~${avgQPS} q/s avg · 24h window`}
          icon={<Radio className="w-3.5 h-3.5" />}
          loading={loading}
        />
        <StatCard
          label="Filter Rate"
          value={`${blockPct}%`}
          sub={`${stats?.num_blocked_filtering?.toLocaleString() ?? 0} threats intercepted`}
          icon={<Shield className="w-3.5 h-3.5 text-[var(--red)]" />}
          accent="bad"
          loading={loading}
        />
        <StatCard
          label="Cache Hits"
          value={`${cacheHitRate}%`}
          sub={`${cacheStats?.cached?.toLocaleString() ?? 0} zero-roundtrip hits`}
          icon={<Zap className="w-3.5 h-3.5 text-[var(--green)]" />}
          accent="good"
          loading={loading}
        />
        <StatCard
          label="Average Latency"
          value={`${avgLatency} ms`}
          accent={parseFloat(avgLatency) <= 60 ? 'good' : undefined}
          sub={cacheStats?.real_avg_latency_ms !== undefined && cacheStats.real_avg_latency_ms > 0
            ? `Real-time · ${(stats ? stats.avg_processing_time * 1000 : 0).toFixed(0)}ms 30d`
            : "Network edge response"}
          icon={<Clock className="w-3.5 h-3.5" />}
          loading={loading}
        />
        <StatCard
          label="Fastest Node"
          value={resolverData?.latestRace?.winnerName ? resolverData.latestRace.winnerName.split(' ')[0] : upstreamsAnalysis[0]?.name ? upstreamsAnalysis[0].name.split(' ')[0] : 'Cloudflare'}
          sub={resolverData?.latestRace?.winner ? `${(resolverData.latestRace as any)[resolverData.latestRace.winner]} ms live ping` : 'Encrypted DoH'}
          icon={<Server className="w-3.5 h-3.5 text-[var(--green)]" />}
          accent="good"
          loading={loading}
        />
      </section>

      {/* ── Redesigned Analytics Navigation Tab Bar (Ground Up) ── */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] pb-1 overflow-x-auto scrollbar-none" role="tablist" aria-label="Analytics sections">
        <button
          role="tab"
          aria-selected={activeTab === 'traffic'}
          onClick={() => setActiveTab('traffic')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'traffic'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Activity className="w-3.5 h-3.5 text-[var(--text-primary)]" />
          <span>Traffic &amp; Velocity</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-mono">
            {stats ? `~${avgQPS} q/s` : '24h'}
          </span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'latency'}
          onClick={() => setActiveTab('latency')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'latency'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Clock className="w-3.5 h-3.5 text-[var(--text-primary)]" />
          <span>Latency &amp; Speed</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--green-bg)] text-[var(--green)] border border-[color-mix(in_srgb,var(--green)_30%,var(--border))] font-mono font-semibold">
            {avgLatency} ms
          </span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'upstreams'}
          onClick={() => setActiveTab('upstreams')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'upstreams'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Server className="w-3.5 h-3.5 text-[var(--text-primary)]" />
          <span>Upstreams &amp; Race</span>
          {resolverData?.latestRace?.winnerName ? (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-mono">
              ⚡ {resolverData.latestRace.winnerName.split(' ')[0]}
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-mono">
              {upstreamsAnalysis.length} nodes
            </span>
          )}
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'protocols'}
          onClick={() => setActiveTab('protocols')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'protocols'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-[var(--text-primary)]" />
          <span>Protocols &amp; Fleet</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-mono">
            {clientBreakdown.length} devices
          </span>
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 1: TRAFFIC & VELOCITY ────────────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'traffic' && (
        <div className="space-y-4">
          {/* Allowed vs Blocked Traffic Ratio Banner */}
          <div className="p-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--green)]" />
                  <span className="text-[var(--text-secondary)] font-medium">Clean Lookups:</span>
                  <span className="font-mono font-bold text-[var(--text-primary)]">
                    {allowedCount.toLocaleString()}
                  </span>
                  <span className="font-mono text-[var(--green)] font-semibold text-[11px]">
                    ({allowedPct}%)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--red)]" />
                  <span className="text-[var(--text-secondary)] font-medium">Intercepted Threats:</span>
                  <span className="font-mono font-bold text-[var(--text-primary)]">
                    {stats?.num_blocked_filtering?.toLocaleString() ?? 0}
                  </span>
                  <span className="font-mono text-[var(--red)] font-semibold text-[11px]">
                    ({blockPct}%)
                  </span>
                </div>
              </div>

              {peakInsights && (
                <div className="flex items-center gap-2 text-[11px] font-mono">
                  <span className="px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--muted)]">
                    Peak Hour: <strong className="text-[var(--text)]">{peakInsights.maxQ.hour}</strong>
                  </span>
                  <span className="status bad text-[10px] py-0.5 px-2">
                    Max Block: {peakInsights.maxB.hour} ({peakInsights.maxB.pct}%)
                  </span>
                </div>
              )}
            </div>

            {/* Split Progress Bar */}
            <div className="w-full h-2 rounded-full overflow-hidden flex bg-[var(--surface-2)]">
              <div
                className="h-full bg-[var(--green)] transition-all duration-500"
                style={{ width: `${Math.max(parseFloat(allowedPct), 1)}%` }}
                title={`Allowed: ${allowedPct}%`}
              />
              <div
                className="h-full bg-[var(--red)] transition-all duration-500"
                style={{ width: `${Math.max(parseFloat(blockPct), 1)}%` }}
                title={`Blocked: ${blockPct}%`}
              />
            </div>
          </div>

          {/* Master Velocity & Security Area Chart */}
          <Section
            title={isDaily ? 'DNS Query Dynamics & Threat History' : '24-Hour DNS Query Velocity & Security Events'}
            subtitle={
              selectedClient !== 'all'
                ? `${isDaily ? 'Daily' : 'Hourly'} global network volume (Dedicated latency profile for ${clientBreakdown.find(c => c.ip === selectedClient)?.name || selectedClient} shown below)`
                : isDaily
                  ? 'Daily aggregated request volume, filter block attribution, and malicious endpoint interception'
                  : 'Hourly request volume, filter block attribution, and malicious endpoint interception'
            }
            action={
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setChartSeries(p => ({ ...p, queries: !p.queries }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                    chartSeries.queries
                      ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border-[var(--border-strong)]'
                      : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <div className="w-2 h-2 rounded-full bg-[var(--text-primary)]" />
                  <span>Total Queries</span>
                </button>

                <button
                  onClick={() => setChartSeries(p => ({ ...p, blocked: !p.blocked }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                    chartSeries.blocked
                      ? 'bg-[var(--red-bg)] text-[var(--red)] border-[color-mix(in_srgb,var(--red)_30%,var(--border))] font-semibold'
                      : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <div className="w-2 h-2 rounded-full bg-[var(--red)]" />
                  <span>Blocked Filtering</span>
                </button>

                <button
                  onClick={() => setChartSeries(p => ({ ...p, malware: !p.malware }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                    chartSeries.malware
                      ? 'bg-[var(--red-bg)] text-[var(--red)] border-[color-mix(in_srgb,var(--red)_30%,var(--border))]'
                      : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <div className="w-2 h-2 rounded-full bg-[var(--red)] opacity-80" />
                  <span>Malware Threats</span>
                </button>

                <button
                  onClick={() => setChartSeries(p => ({ ...p, parental: !p.parental }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                    chartSeries.parental
                      ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border-[var(--border-strong)]'
                      : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <div className="w-2 h-2 rounded-full bg-[var(--border-strong)]" />
                  <span>Parental Policy</span>
                </button>
              </div>
            }
          >
            <div className="p-4 space-y-3">
              <div style={{ height: 290 }}>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                      <XAxis dataKey="hour" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.floor(chartData.length / 6)} />
                      <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
                      <Tooltip {...TOOLTIP_STYLE} />

                      {chartSeries.queries && (
                        <Area type="monotone" dataKey="Queries" stroke="var(--text-primary)" strokeWidth={1.8} fill="var(--surface-3)" fillOpacity={0.8} dot={false} name="Total Queries" />
                      )}
                      {chartSeries.blocked && (
                        <Area type="monotone" dataKey="Blocked" stroke="var(--red)" strokeWidth={2} strokeDasharray="4 4" fill="var(--red-bg)" fillOpacity={0.3} dot={false} name="Blocked Requests" />
                      )}
                      {chartSeries.malware && (
                        <Area type="monotone" dataKey="Malware" stroke="var(--red)" strokeWidth={1.8} strokeDasharray="2 2" fill="none" dot={false} name="Malware / Phishing" />
                      )}
                      {chartSeries.parental && (
                        <Area type="monotone" dataKey="Parental" stroke="var(--border-strong)" strokeWidth={1.8} strokeDasharray="1 3" fill="none" dot={false} name="Parental Filter" />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-xs text-[var(--text-tertiary)]">
                    {loading ? 'Loading velocity data…' : 'No query data available for this period'}
                  </div>
                )}
              </div>
            </div>
          </Section>

          {/* Peak Activity Intelligence Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3.5 space-y-1">
              <div className="text-[10px] uppercase font-bold text-[var(--muted)] tracking-wider">
                Peak Traffic Window
              </div>
              <div className="font-mono text-base font-bold text-[var(--text)]">
                {peakInsights?.maxQ.hour || '—'}
              </div>
              <div className="text-[11px] text-[var(--muted)] font-mono">
                {peakInsights?.maxQ.val.toLocaleString() || 0} queries handled
              </div>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3.5 space-y-1">
              <div className="text-[10px] uppercase font-bold text-[var(--muted)] tracking-wider">
                Quietest Hour
              </div>
              <div className="font-mono text-base font-bold text-[var(--text)]">
                {peakInsights?.minQ.hour || '—'}
              </div>
              <div className="text-[11px] text-[var(--muted)] font-mono">
                {peakInsights?.minQ.val.toLocaleString() || 0} queries handled
              </div>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3.5 space-y-1">
              <div className="text-[10px] uppercase font-bold text-[var(--red)] tracking-wider flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                Max Block Window
              </div>
              <div className="font-mono text-base font-bold text-[var(--red)]">
                {peakInsights?.maxB.hour || '—'}
              </div>
              <div className="text-[11px] text-[var(--red)] font-mono">
                {peakInsights?.maxB.pct || 0}% interception rate ({peakInsights?.maxB.val.toLocaleString() || 0} blocked)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 2: LATENCY & SPEED ───────────────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'latency' && (
        <div className="space-y-4">
          {/* Latency Health Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 space-y-1">
              <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Average Speed</div>
              <div className={`font-mono text-lg font-bold ${parseFloat(avgLatency) <= 60 ? 'goodtext' : 'text-[var(--text)]'}`}>
                {avgLatency} ms
              </div>
              <div className="text-[10.5px] text-[var(--muted)]">Global response time</div>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 space-y-1">
              <div className="text-[10px] uppercase font-bold text-[var(--green)] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
                Cache Efficiency
              </div>
              <div className="font-mono text-lg font-bold text-[var(--green)]">
                {cacheHitRate}%
              </div>
              <div className="text-[10.5px] text-[var(--muted)]">
                {cacheStats?.cached?.toLocaleString() || 0} zero-roundtrip hits
              </div>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 space-y-1">
              <div className="text-[10px] uppercase font-bold text-[var(--green)] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
                Sub-5ms Lookups
              </div>
              <div className="font-mono text-lg font-bold text-[var(--green)]">
                {latencyProfile[0]?.pct}%
              </div>
              <div className="text-[10.5px] text-[var(--muted)]">
                {latencyProfile[0]?.count.toLocaleString()} RAM lookups
              </div>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 space-y-1">
              <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Sub-25ms Lookups</div>
              <div className="font-mono text-lg font-bold text-[var(--text)]">
                {(latencyProfile[0]?.pct || 0) + (latencyProfile[1]?.pct || 0)}%
              </div>
              <div className="text-[10.5px] text-[var(--muted)]">Direct edge speed</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* DNS Response Latency Profiler */}
            <Section
              title="DNS Response Latency Profiler"
              subtitle={selectedClient === 'all'
                ? "Real-world query resolution time distribution across speed buckets"
                : `Dedicated latency profile for ${clientBreakdown.find(c => c.ip === selectedClient)?.name || selectedClient} (${activeLog.length} queries sampled)`}
              action={
                <div className="flex items-center gap-2">
                  {loadingClientLog && <RefreshCw className="w-3 h-3 text-[var(--text-primary)] animate-spin" />}
                  {selectedClient !== 'all' && (
                    <button
                      onClick={() => setSelectedClient('all')}
                      className="text-[10px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] transition-colors cursor-pointer"
                    >
                      Reset to Fleet
                    </button>
                  )}
                  <span className="status good text-[10px] py-0.5 px-2">
                    {latencyProfile[0]?.pct}% sub-5ms
                  </span>
                </div>
              }
            >
              <div className="p-4 space-y-3.5">
                <div className="space-y-3">
                  {latencyProfile.map(bucket => (
                    <div key={bucket.label} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${bucket.dotColor}`} />
                          <span className="font-mono text-[var(--text-primary)] font-medium">{bucket.label}</span>
                          <span className="text-[11px] text-[var(--text-tertiary)]">({bucket.name})</span>
                        </div>

                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-[var(--text-secondary)] text-xs">{bucket.count.toLocaleString()}</span>
                          <span className={`font-semibold ${bucket.textColor} w-10 text-right`}>{bucket.pct}%</span>
                        </div>
                      </div>

                      {/* Semantic color-coded progress bar */}
                      <div className="w-full h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(bucket.pct, 1)}%`, backgroundColor: bucket.barColor }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-tertiary)]">
                  <span>Sampled from latest {activeLog.length} queries</span>
                  <span className={`font-medium ${latencyProfile[0]?.pct >= 50 ? 'goodtext' : ''}`}>
                    Cache rating: {latencyProfile[0]?.pct >= 60 ? 'Optimal (RAM Fast)' : latencyProfile[0]?.pct >= 35 ? 'Good' : 'Standard'}
                  </span>
                </div>
              </div>
            </Section>

            {/* Interactive Latency Curve / Waveform */}
            <Section
              title={
                latencyViewMode === 'timeline'
                  ? '24-Hour DNS Latency Timeline'
                  : latencyViewMode === 'rolling'
                  ? 'Live Query Latency Waveform'
                  : 'Hourly Filter Blocking Ratio (%)'
              }
              subtitle={
                latencyViewMode === 'timeline'
                  ? 'Average lookup response time (ms) distribution across the last 24 hours'
                  : latencyViewMode === 'rolling'
                  ? 'Real-time response time per query across latest sampled lookups'
                  : 'Fluctuation of network filter interception rate over 24 hours'
              }
              action={
                <div className="flex items-center gap-1 bg-[var(--bg-surface)] border border-[var(--border)] p-0.5 rounded-lg text-[10.5px]">
                  <button
                    onClick={() => setLatencyViewMode('timeline')}
                    className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                      latencyViewMode === 'timeline'
                        ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] font-semibold shadow-xs'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    24h Curve
                  </button>
                  <button
                    onClick={() => setLatencyViewMode('rolling')}
                    className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                      latencyViewMode === 'rolling'
                        ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] font-semibold shadow-xs'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    Live Waveform
                  </button>
                  <button
                    onClick={() => setLatencyViewMode('blockrate')}
                    className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                      latencyViewMode === 'blockrate'
                        ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] font-semibold shadow-xs'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    Block %
                  </button>
                </div>
              }
            >
              <div className="p-4" style={{ height: 260 }}>
                {latencyViewMode === 'timeline' ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={latencyTimelineData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                      <XAxis dataKey="time" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} unit="ms" />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null
                          const lat = payload.find(p => p.dataKey === 'Latency')?.value
                          const up = payload.find(p => p.dataKey === 'UpstreamLatency')?.value
                          const samples = payload[0]?.payload?.Samples || 0
                          return (
                            <div className="bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-xl p-3 shadow-2xl text-xs space-y-1.5 min-w-[170px]">
                              <div className="text-[11px] font-mono text-[var(--text-secondary)] font-semibold border-b border-[var(--border-subtle)] pb-1">
                                Time Window: {label}
                              </div>
                              <div className="flex items-center justify-between text-[var(--text-primary)] font-mono">
                                <span>Overall Latency:</span>
                                <span className="font-bold">{lat !== null && lat !== undefined ? `${lat} ms` : '—'}</span>
                              </div>
                              {up && (
                                <div className="flex items-center justify-between text-[var(--text-secondary)] font-mono text-[11px]">
                                  <span>Cloud Upstream:</span>
                                  <span>{up} ms</span>
                                </div>
                              )}
                              <div className="text-[10px] text-[var(--text-muted)] font-mono pt-0.5">
                                {samples} {samples === 1 ? 'query' : 'queries'} sampled
                              </div>
                            </div>
                          )
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="Latency"
                        stroke="var(--green)"
                        strokeWidth={2}
                        fill="var(--green-bg)"
                        fillOpacity={0.4}
                        dot={false}
                        name="Overall Latency (ms)"
                        connectNulls
                      />
                      <Area
                        type="monotone"
                        dataKey="UpstreamLatency"
                        stroke="var(--text-secondary)"
                        strokeWidth={1.5}
                        strokeDasharray="3 3"
                        fill="none"
                        dot={false}
                        name="Upstream Resolvers (ms)"
                        connectNulls
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : latencyViewMode === 'rolling' ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={rollingLatencyData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                      <XAxis dataKey="index" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} unit="ms" />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const data = payload[0]?.payload
                          if (!data) return null
                          return (
                            <div className="bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-xl p-3 shadow-2xl text-xs space-y-1.5 min-w-[210px]">
                              <div className="text-[11px] font-mono text-[var(--text-primary)] font-semibold truncate border-b border-[var(--border-subtle)] pb-1">
                                {data.fullDomain}
                              </div>
                              <div className="flex items-center justify-between text-[var(--text-primary)] font-mono">
                                <span>Response Time:</span>
                                <span className={`font-bold ${data.actualLatency < 25 ? 'goodtext' : data.actualLatency > 100 ? 'badtext' : ''}`}>
                                  {data.actualLatency.toFixed(1)} ms
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)] font-mono">
                                <span>Resolver:</span>
                                <span className="text-[var(--text-primary)] truncate max-w-[120px]">{data.upstream}</span>
                              </div>
                              <div className="text-[10px] text-[var(--text-muted)] font-mono pt-0.5">
                                Logged at: {data.time}
                              </div>
                            </div>
                          )
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="Latency"
                        stroke="var(--green)"
                        strokeWidth={2}
                        fill="var(--green-bg)"
                        fillOpacity={0.4}
                        dot={{ r: 2.5, fill: 'var(--green)' }}
                        name="Query Latency (ms)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                      <XAxis dataKey="hour" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.floor(chartData.length / 6)} />
                      <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
                      <Tooltip {...TOOLTIP_STYLE} />
                      <Line
                        type="monotone"
                        dataKey="BlockPct"
                        stroke="var(--red)"
                        strokeWidth={2}
                        dot={{ r: 2, fill: 'var(--red)' }}
                        name="Block Rate %"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Section>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 3: UPSTREAM RESOLVERS & RACE ─────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'upstreams' && (
        <div className="space-y-4">
          <Section
            title="Upstream Resolvers & Head-to-Head Speed Race"
            subtitle={
              upstreamViewMode === 'split'
                ? 'Multi-resolver speed comparison: Cloudflare vs Google vs Quad9 throughout the day'
                : 'Traffic dispatch distribution and round-trip response latency across all upstream endpoints'
            }
            action={
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleRunRace}
                  disabled={racingResolvers}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--green-bg)] text-[var(--green)] border border-[color-mix(in_srgb,var(--green)_30%,var(--border))] hover:opacity-90 transition-all cursor-pointer disabled:opacity-50 shadow-xs"
                  title="Probe all 3 resolvers simultaneously right now to test real-world round-trip time"
                >
                  <Zap className={`w-3.5 h-3.5 text-[var(--green)] ${racingResolvers ? 'animate-bounce' : ''}`} />
                  <span>{racingResolvers ? 'Probing Resolvers…' : 'Run Instant Race'}</span>
                </button>

                <div className="flex items-center gap-1 bg-[var(--bg-surface)] border border-[var(--border)] p-0.5 rounded-lg text-[10.5px]">
                  <button
                    onClick={() => setUpstreamViewMode('split')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                      upstreamViewMode === 'split'
                        ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] font-semibold shadow-xs'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    ⚔️ Split Race
                  </button>
                  <button
                    onClick={() => setUpstreamViewMode('list')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                      upstreamViewMode === 'list'
                        ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] font-semibold shadow-xs'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    📋 All Nodes ({upstreamsAnalysis.length})
                  </button>
                </div>
              </div>
            }
          >
            <div className="p-4 space-y-4">
              {upstreamViewMode === 'split' ? (
                <div className="space-y-4">
                  {/* Instant Race Toast Alert */}
                  {raceToast && (
                    <div className="bg-[var(--green-bg)] border border-[color-mix(in_srgb,var(--green)_30%,var(--border))] text-[var(--green)] px-3.5 py-2.5 rounded-xl text-xs flex items-center justify-between shadow-xs">
                      <div className="flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-[var(--green)] shrink-0" />
                        <span className="font-semibold">{raceToast}</span>
                      </div>
                      <button
                        onClick={() => setRaceToast(null)}
                        className="text-[var(--green)] hover:opacity-75 text-xs cursor-pointer ml-2"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {/* ── Podium Leaderboard Cards ── */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(resolverData?.leaderboard || []).map(provider => {
                      const isWinner = provider.rank === 1
                      return (
                        <div
                          key={provider.id}
                          className={`relative p-3.5 rounded-xl border transition-all ${
                            isWinner
                              ? 'bg-[var(--surface)] border-[var(--green)] shadow-md'
                              : 'bg-[var(--surface)] border-[var(--border)]'
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xl select-none">{provider.medal}</span>
                              <div>
                                <div className="text-xs font-bold text-[var(--text-primary)] leading-tight flex items-center gap-1.5">
                                  <span>{provider.name}</span>
                                  {isWinner && (
                                    <span className="status good text-[9px] py-0 px-1.5 font-bold uppercase tracking-wider">
                                      Leader
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-[var(--text-tertiary)] font-mono">{provider.host}</div>
                              </div>
                            </div>
                            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                              isWinner
                                ? 'bg-[var(--green-bg)] text-[var(--green)] border border-[color-mix(in_srgb,var(--green)_30%,var(--border))]'
                                : 'bg-[var(--surface-2)] text-[var(--muted)] border border-[var(--border)]'
                            }`}>
                              #{provider.rank}
                            </span>
                          </div>

                          <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] grid grid-cols-2 gap-2 text-[11px]">
                            <div>
                              <div className="text-[9.5px] uppercase font-mono text-[var(--text-tertiary)]">Live Ping</div>
                              <div className={`font-mono font-bold text-base ${isWinner ? 'text-[var(--green)]' : 'text-[var(--text-primary)]'}`}>
                                {provider.liveLatencyMs} ms
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[9.5px] uppercase font-mono text-[var(--text-tertiary)]">Query Share</div>
                              <div className="font-mono font-bold text-base text-[var(--text-primary)]">
                                {provider.querySharePct}%
                              </div>
                            </div>
                          </div>

                          <div className="mt-2.5 pt-1.5 text-[10px] text-[var(--text-tertiary)] font-mono flex items-center justify-between border-t border-[var(--border-subtle)]">
                            <span>{provider.queriesResolved.toLocaleString()} queries</span>
                            <span className="text-[var(--text-secondary)] font-semibold">{provider.protocol}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* ── 24-Hour Split Line Graph ── */}
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--text-primary)]">24h Speed Race Timeline</span>
                        <span className="text-[10px] font-mono text-[var(--muted)]">Lower is faster (ms)</span>
                      </div>

                      {/* Filter buttons */}
                      <div className="flex items-center gap-1 text-[10.5px]">
                        <button
                          onClick={() => setResolverFilter('all')}
                          className={`px-2 py-0.5 rounded font-mono transition-colors cursor-pointer border ${
                            resolverFilter === 'all'
                              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] font-semibold border-[var(--border-strong)]'
                              : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          All 3
                        </button>
                        <button
                          onClick={() => setResolverFilter('quad9')}
                          className={`px-2 py-0.5 rounded font-mono transition-colors cursor-pointer flex items-center gap-1 border ${
                            resolverFilter === 'quad9'
                              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] font-semibold border-[var(--border-strong)]'
                              : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-primary)]" />
                          Quad9
                        </button>
                        <button
                          onClick={() => setResolverFilter('cloudflare')}
                          className={`px-2 py-0.5 rounded font-mono transition-colors cursor-pointer flex items-center gap-1 border ${
                            resolverFilter === 'cloudflare'
                              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] font-semibold border-[var(--border-strong)]'
                              : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
                          Cloudflare
                        </button>
                        <button
                          onClick={() => setResolverFilter('google')}
                          className={`px-2 py-0.5 rounded font-mono transition-colors cursor-pointer flex items-center gap-1 border ${
                            resolverFilter === 'google'
                              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] font-semibold border-[var(--border-strong)]'
                              : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-secondary)]" />
                          Google
                        </button>
                      </div>
                    </div>

                    <div className="h-[220px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={resolverData?.timeline || []} margin={{ top: 8, right: 10, left: -15, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                          <XAxis
                            dataKey="hour"
                            tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            interval={Math.floor((resolverData?.timeline?.length || 24) / 6)}
                          />
                          <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} unit="ms" />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null
                              const data = payload[0]?.payload
                              if (!data) return null
                              return (
                                <div className="bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-xl p-3 shadow-2xl text-xs space-y-2 min-w-[210px]">
                                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-1.5 font-mono">
                                    <span className="text-[var(--text-primary)] font-semibold">{data.hour}</span>
                                    <span className="status good text-[10px] py-0 px-1.5 font-semibold">
                                      🏆 {data.winner} won
                                    </span>
                                  </div>
                                  <div className="space-y-1 font-mono text-[11px]">
                                    <div className="flex items-center justify-between text-[var(--text-primary)]">
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-[var(--text-primary)]" />
                                        Quad9:
                                      </span>
                                      <span className="font-bold">{data.quad9} ms</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[var(--text-secondary)]">
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-[var(--green)]" />
                                        Cloudflare:
                                      </span>
                                      <span className="font-bold text-[var(--green)]">{data.cloudflare} ms</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[var(--text-tertiary)]">
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />
                                        Google:
                                      </span>
                                      <span className="font-bold">{data.google} ms</span>
                                    </div>
                                  </div>
                                  <div className="text-[10px] text-[var(--text-tertiary)] pt-1 border-t border-[var(--border-subtle)]">
                                    Fastest: <span className="text-[var(--green)] font-bold">{data.fastestMs} ms</span>
                                  </div>
                                </div>
                              )
                            }}
                          />

                          {(resolverFilter === 'all' || resolverFilter === 'quad9') && (
                            <Line
                              type="monotone"
                              dataKey="quad9"
                              stroke="var(--text-primary)"
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 4, fill: 'var(--text-primary)' }}
                              name="Quad9 DNS"
                            />
                          )}
                          {(resolverFilter === 'all' || resolverFilter === 'cloudflare') && (
                            <Line
                              type="monotone"
                              dataKey="cloudflare"
                              stroke="var(--green)"
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 4, fill: 'var(--green)' }}
                              name="Cloudflare DNS"
                            />
                          )}
                          {(resolverFilter === 'all' || resolverFilter === 'google') && (
                            <Line
                              type="monotone"
                              dataKey="google"
                              stroke="var(--text-secondary)"
                              strokeWidth={1.5}
                              strokeDasharray="3 3"
                              dot={false}
                              activeDot={{ r: 4, fill: 'var(--text-secondary)' }}
                              name="Google DNS"
                            />
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-[var(--text-tertiary)] gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] shrink-0" />
                      <span>Parallel Mode active: lookups dispatched concurrently to all 3 nodes, fastest response wins.</span>
                    </div>
                    <div className="text-[var(--text-secondary)] font-mono text-[10.5px]">
                      Total resolved: <span className="text-[var(--text-primary)] font-semibold">{(resolverData?.totalQueriesResolved || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ) : (
                /* All Configured Upstream Nodes Registry */
                upstreamsAnalysis.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[var(--text-tertiary)]">No upstream statistics available</div>
                ) : (
                  <div className="space-y-3">
                    {upstreamsAnalysis.map(upstream => (
                      <div key={upstream.rawUrl} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-secondary)] shrink-0">
                              <Server className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-[var(--text-primary)] truncate flex items-center gap-1.5">
                                <span>{upstream.name}</span>
                                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface-2)] border border-[var(--border-subtle)] text-[var(--text-tertiary)]">
                                  {upstream.proto}
                                </span>
                              </div>
                              <div className="text-[10px] font-mono text-[var(--text-tertiary)] truncate mt-0.5">
                                {upstream.cleanUrl}
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className={`text-xs font-mono font-bold ${
                              upstream.status === 'Optimal' ? 'text-[var(--green)]' : upstream.status === 'Slow' ? 'text-[var(--red)]' : 'text-[var(--text-primary)]'
                            }`}>
                              {upstream.avgTimeMs > 0 ? `${upstream.avgTimeMs} ms` : '—'}
                            </div>
                            <div className={`text-[10px] font-mono font-semibold ${
                              upstream.status === 'Optimal' ? 'text-[var(--green)]' : upstream.status === 'Slow' ? 'text-[var(--red)]' : 'text-[var(--text-secondary)]'
                            }`}>
                              {upstream.status === 'Optimal' ? '● OPTIMAL' : upstream.status === 'Slow' ? '● SLOW' : '● NORMAL'}
                            </div>
                          </div>
                        </div>

                        {/* Traffic Share Progress Bar */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)] font-mono">
                            <span>{upstream.count.toLocaleString()} queries resolved</span>
                            <span>{upstream.sharePct}% traffic load</span>
                          </div>
                          <div className="w-full h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--text-primary)] transition-all duration-500"
                              style={{ width: `${upstream.sharePct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </Section>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 4: PROTOCOLS & FLEET DEVICES ─────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'protocols' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Record Types */}
            <Section
              title="DNS Record Types Distribution"
              subtitle="Query distribution across DNS record schemas (IPv4, IPv6, HTTPS, SRV)"
            >
              <div className="p-4 space-y-4">
                <div>
                  <div className="text-xs font-medium text-[var(--text-secondary)] mb-2.5 flex items-center justify-between">
                    <span>Schema Frequency</span>
                    <span className="text-[10px] font-mono text-[var(--text-tertiary)]">Latest 1,000 lookups</span>
                  </div>

                  {/* Segmented Bar */}
                  <div className="flex h-3 rounded-lg overflow-hidden bg-[var(--surface-3)] gap-0.5 mb-3">
                    {recordDistribution.sortedTypes.map((t, idx) => {
                      const colors = ['var(--text-primary)', 'var(--text-secondary)', 'var(--text-tertiary)', 'var(--border-strong)', 'var(--border)']
                      return (
                        <div
                          key={t.type}
                          style={{ width: `${t.pct}%`, backgroundColor: colors[idx % colors.length] }}
                          title={`${t.type}: ${t.count} (${t.pct}%)`}
                          className="h-full first:rounded-l-lg last:rounded-r-lg transition-all"
                        />
                      )
                    })}
                  </div>

                  {/* Legend Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {recordDistribution.sortedTypes.slice(0, 6).map((t, idx) => {
                      const dotColors = ['bg-[var(--text-primary)]', 'bg-[var(--text-secondary)]', 'bg-[var(--text-tertiary)]', 'bg-[var(--border-strong)]', 'bg-[var(--border)]']
                      return (
                        <div key={t.type} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-2 flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${dotColors[idx % dotColors.length]}`} />
                            <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">{t.type}</span>
                          </div>
                          <span className="font-mono text-xs text-[var(--text-tertiary)]">{t.pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="pt-2.5 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-tertiary)]">
                  <span>IPv4 (A): {recordDistribution.sortedTypes.find(t => t.type === 'A')?.pct || 0}%</span>
                  <span>IPv6 (AAAA): {recordDistribution.sortedTypes.find(t => t.type === 'AAAA')?.pct || 0}%</span>
                </div>
              </div>
            </Section>

            {/* Transport Protocols */}
            <Section
              title="Transport Layer Protocols"
              subtitle="DNS network transport distribution across UDP, TCP, and encrypted wrappers"
            >
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                  {recordDistribution.sortedProtos.map(p => (
                    <div key={p.proto} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3.5 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-mono font-bold text-[var(--text-primary)]">{p.proto}</div>
                        <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                          {p.proto === 'UDP' ? 'Standard Port 53' : p.proto === 'TCP' ? 'Stream Socket' : 'Encrypted Transport'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-mono font-bold text-[var(--text-primary)]">{p.pct}%</div>
                        <div className="text-[10px] text-[var(--text-tertiary)] font-mono">{p.count} reqs</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-2.5 border-t border-[var(--border-subtle)] text-[11px] text-[var(--text-tertiary)] flex items-center justify-between">
                  <span>Transport security: Encrypted DoH/DoT upstream enabled</span>
                  <span className="status good text-[10px] py-0 px-2 font-mono">TLS / HTTP2</span>
                </div>
              </div>
            </Section>
          </div>

          {/* Fleet Client Request Distribution Table */}
          <Section
            title="Fleet Client Request Distribution"
            subtitle="Network devices consuming the highest query volume and block activity"
            action={
              <button
                onClick={() => navigate('/clients')}
                className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                <span>View Full Device Fleet</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                    <th className="py-2.5 px-4">Rank</th>
                    <th className="py-2.5 px-4">Client Endpoint</th>
                    <th className="py-2.5 px-4">Traffic Share</th>
                    <th className="py-2.5 px-4 text-right">Total Queries</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {clientBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-xs text-[var(--text-tertiary)]">
                        No client telemetry available.
                      </td>
                    </tr>
                  ) : (
                    clientBreakdown.map(client => (
                      <tr key={client.ip} className="hover:bg-[var(--bg-hover)] transition-colors">
                        <td className="py-3 px-4 font-mono text-[var(--text-tertiary)] font-bold text-xs">
                          #{client.rank}
                        </td>

                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div>
                              <div className="font-semibold text-[var(--text-primary)] tracking-tight">
                                {client.name || client.ip}
                              </div>
                              {client.name && (
                                <div className="text-[10px] font-mono text-[var(--text-tertiary)]">
                                  {client.ip}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4 min-w-[160px]">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-tertiary)]">
                              <span>{client.sharePct}% network load</span>
                            </div>
                            <div className="w-full h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[var(--text-primary)] transition-all duration-300"
                                style={{ width: `${Math.max(client.sharePct, 2)}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4 text-right font-mono font-bold text-[var(--text-primary)] text-xs">
                          {client.count.toLocaleString()}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => navigate(`/clients/${encodeURIComponent(client.ip)}`)}
                            className="secondary-btn !min-h-[28px] !text-[11px] !py-1 !px-2.5 font-medium cursor-pointer"
                          >
                            Inspect Client
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}
