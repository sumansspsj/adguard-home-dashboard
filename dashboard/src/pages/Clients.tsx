import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getClients, getStats, getQueryLog, isDnsBlocked, type AghStats, type Clients, type AghClient, type QueryLogEntry } from '../api'
import {
  Monitor, Smartphone, Laptop, Server, Printer,
  Tv, Gamepad2, ChevronRight, Wifi, Shield,
  Search, ArrowUpDown, Copy, Check, Radio,
  LayoutGrid, List, Download, Camera, Router,
  RefreshCw, X, ShieldAlert, ShieldCheck, Activity,
  Cpu, HelpCircle
} from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import { useServer } from '../contexts/ServerContext'
import { usePageTitle } from '../hooks/usePageTitle'

// ── Device Categorization & Intelligent Telemetry ───────────────────────────

export type DeviceCategory = 'computer' | 'phone' | 'media' | 'network' | 'other'

/**
 * Categorizes a device using explicit tags first, falling back to name/hostname heuristics.
 */
function detectDeviceCategory(name: string, tags: string[] = []): DeviceCategory {
  // 1. Explicit tags take precedence
  for (const tag of tags) {
    if (tag === 'device_pc' || tag === 'device_laptop' || tag === 'os_macos' || tag === 'os_windows' || tag === 'os_linux') return 'computer'
    if (tag === 'device_phone' || tag === 'device_tablet' || tag === 'os_android' || tag === 'os_ios') return 'phone'
    if (tag === 'device_tv' || tag === 'device_gameconsole' || tag === 'device_audio') return 'media'
    if (tag === 'device_nas' || tag === 'device_printer' || tag === 'device_camera' || tag === 'device_other') return 'network'
  }

  // 2. Intelligent name heuristic fallback
  const n = (name || '').toLowerCase()
  if (
    n.includes('iphone') || n.includes('android') || n.includes('pixel') ||
    n.includes('galaxy') || n.includes('phone') || n.includes('ipad') ||
    n.includes('tablet') || n.includes('oneplus') || n.includes('redmi') ||
    n.includes('xiaomi') || n.includes('huawei') || n.includes('oppo') || n.includes('vivo')
  ) {
    return 'phone'
  }

  if (
    n.includes('macbook') || n.includes('laptop') || n.includes('desktop') ||
    n.includes('pc') || n.includes('thinkpad') || n.includes('surface') ||
    n.includes('imac') || n.includes('mac-') || n.includes('win10') ||
    n.includes('win11') || n.includes('workstation') || n.includes('dell') || n.includes('hp')
  ) {
    return 'computer'
  }

  if (
    n.includes('tv') || n.includes('roku') || n.includes('chromecast') ||
    n.includes('firestick') || n.includes('shield') || n.includes('xbox') ||
    n.includes('playstation') || n.includes('ps4') || n.includes('ps5') ||
    n.includes('switch') || n.includes('sonos') || n.includes('bravia') ||
    (n.includes('samsung') && n.includes('smart')) || n.includes('appletv')
  ) {
    return 'media'
  }

  if (
    n.includes('router') || n.includes('gateway') || n.includes('switch') ||
    n.includes('synology') || n.includes('nas') || n.includes('printer') ||
    n.includes('camera') || n.includes('accesspoint') || n.includes('unifi') ||
    n.includes('ubiquiti') || n.includes('pi') || n.includes('server') ||
    n.includes('node') || n.includes('ap-') || n.includes('mikrotik')
  ) {
    return 'network'
  }

  return 'other'
}

/**
 * Detects the OS platform from tags or device hostname.
 */
function detectDeviceOs(name: string, tags: string[] = []): string | null {
  for (const tag of tags) {
    if (tag === 'os_windows') return 'Windows'
    if (tag === 'os_macos') return 'macOS'
    if (tag === 'os_linux') return 'Linux'
    if (tag === 'os_android') return 'Android'
    if (tag === 'os_ios') return 'iOS'
  }
  const n = (name || '').toLowerCase()
  if (n.includes('iphone') || n.includes('ipad') || n.includes('ios')) return 'iOS'
  if (n.includes('android') || n.includes('pixel') || n.includes('galaxy')) return 'Android'
  if (n.includes('macbook') || n.includes('macos') || n.includes('imac') || n.includes('mac-')) return 'macOS'
  if (n.includes('windows') || n.includes('win10') || n.includes('win11') || n.includes('desktop-')) return 'Windows'
  if (n.includes('linux') || n.includes('ubuntu') || n.includes('debian') || n.includes('arch') || n.includes('raspberrypi')) return 'Linux'
  return null
}

function tagIcon(name: string, tags: string[] = []) {
  const cat = detectDeviceCategory(name, tags)
  const n = name.toLowerCase()

  if (cat === 'computer') {
    if (n.includes('laptop') || n.includes('macbook') || tags.includes('device_laptop')) {
      return <Laptop className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
    }
    return <Monitor className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
  }

  if (cat === 'phone') {
    return <Smartphone className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
  }

  if (cat === 'media') {
    if (n.includes('xbox') || n.includes('playstation') || n.includes('switch') || tags.includes('device_gameconsole')) {
      return <Gamepad2 className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
    }
    return <Tv className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
  }

  if (cat === 'network') {
    if (n.includes('printer') || tags.includes('device_printer')) {
      return <Printer className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
    }
    if (n.includes('camera') || tags.includes('device_camera')) {
      return <Camera className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
    }
    if (n.includes('nas') || n.includes('server') || tags.includes('device_nas')) {
      return <Server className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
    }
    return <Router className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
  }

  return <Wifi className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
}

export interface ClientRowData {
  id: string
  name: string
  ip: string
  queries: number
  blocked: number
  pct: string
  isConfigured: boolean
  tags: string[]
  category: DeviceCategory
  os: string | null
  client?: AghClient
}

// ── Copy IP Helper Button ────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }
  return (
    <button
      onClick={copy}
      className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
      title="Copy IP Address"
      aria-label={`Copy IP address ${text}`}
    >
      {copied ? <Check className="w-3 h-3 text-[var(--green)]" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

export default function ClientsPage() {
  usePageTitle('Clients')
  const [clients, setClients] = useState<Clients | null>(null)
  const [stats, setStats] = useState<AghStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // 4 Top Tabs
  const [activeTab, setActiveTab] = useState<'directory' | 'consumers' | 'threats' | 'categories'>('directory')

  // Directory Category Filter
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'active' | 'computer' | 'phone' | 'media' | 'network' | 'configured'>('all')

  // Sort Filter
  const [sortBy, setSortBy] = useState<'queries' | 'blocked' | 'pct' | 'name' | 'ip'>('queries')

  // View Mode for Directory (Table vs Cards)
  const [viewMode, setViewMode] = useState<'table' | 'cards'>(() => typeof window !== 'undefined' && window.innerWidth < 768 ? 'cards' : 'table')

  const [queryLogEntries, setQueryLogEntries] = useState<QueryLogEntry[]>([])

  const navigate = useNavigate()
  const { toast } = useToast()
  const { serverVersion } = useServer()

  const loadData = useCallback(() => {
    setLoading(true)
    Promise.all([
      getClients(),
      getStats(),
      getQueryLog({ limit: 400 }).catch(() => ({ data: [] })),
    ])
      .then(([c, s, ql]) => {
        setClients(c)
        setStats(s)
        if (ql?.data) setQueryLogEntries(ql.data)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    let isMounted = true
    Promise.all([
      getClients(),
      getStats(),
      getQueryLog({ limit: 400 }).catch(() => ({ data: [] })),
    ])
      .then(([c, s, ql]) => {
        if (!isMounted) return
        setClients(c)
        setStats(s)
        if (ql?.data) setQueryLogEntries(ql.data)
      })
      .catch(console.error)
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    const interval = setInterval(() => {
      if (!document.hidden) {
        Promise.all([
          getClients(),
          getStats(),
          getQueryLog({ limit: 400 }).catch(() => ({ data: [] })),
        ])
          .then(([c, s, ql]) => {
            if (!isMounted) return
            setClients(c)
            setStats(s)
            if (ql?.data) setQueryLogEntries(ql.data)
          })
          .catch(() => {})
      }
    }, 10_000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [serverVersion])

  // Map 24-hour query stats per client IP
  const clientQueryMap = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    if (stats?.top_clients) {
      for (const obj of stats.top_clients) {
        for (const [ip, cnt] of Object.entries(obj)) {
          map[ip] = cnt
        }
      }
    }
    return map
  }, [stats])

  const totalNetworkQueries = useMemo(() => {
    const topSum = Object.values(clientQueryMap).reduce((a, b) => a + b, 0)
    return Math.max(topSum, stats?.num_dns_queries || 1, 1)
  }, [clientQueryMap, stats])

  // Compute authentic sampled block counts and ratios per client IP from query log
  const clientBlockedRates = useMemo<Record<string, { total: number; blocked: number }>>(() => {
    const map: Record<string, { total: number; blocked: number }> = {}
    for (const entry of queryLogEntries) {
      const ip = entry.client
      if (!ip) continue
      if (!map[ip]) map[ip] = { total: 0, blocked: 0 }
      map[ip].total += 1
      if (isDnsBlocked(entry)) {
        map[ip].blocked += 1
      }
    }
    return map
  }, [queryLogEntries])

  // Assemble configured, auto-discovered, and runtime querylog rows
  const allRows = useMemo<ClientRowData[]>(() => {
    const knownRows: ClientRowData[] = (clients?.clients || []).map(c => {
      const ip = c.ids?.[0] || '—'
      const q = clientQueryMap[ip] || 0
      const sample = clientBlockedRates[ip]
      let b = 0
      let pct = '0.0'
      if (sample && sample.total > 0) {
        const rate = sample.blocked / sample.total
        pct = (rate * 100).toFixed(1)
        b = Math.round(q * rate)
      }
      const tags = c.tags || []
      const category = detectDeviceCategory(c.name || ip, tags)
      const os = detectDeviceOs(c.name || ip, tags)
      return {
        id: c.name || ip,
        name: c.name || ip,
        ip,
        queries: q,
        blocked: b,
        pct,
        isConfigured: true,
        tags,
        category,
        os,
        client: c,
      }
    })

    const knownIps = new Set(knownRows.map(r => r.ip))

    const autoRows: ClientRowData[] = (clients?.auto_clients || [])
      .filter(ac => !knownIps.has(ac.ip))
      .filter(ac => !ac.ip.startsWith('255.') && !ac.ip.startsWith('224.') && !ac.ip.startsWith('239.') && ac.ip !== '0.0.0.0')
      .map(ac => {
        const q = clientQueryMap[ac.ip] || 0
        const sample = clientBlockedRates[ac.ip]
        let b = 0
        let pct = '0.0'
        if (sample && sample.total > 0) {
          const rate = sample.blocked / sample.total
          pct = (rate * 100).toFixed(1)
          b = Math.round(q * rate)
        }
        const tags: string[] = []
        const category = detectDeviceCategory(ac.name || ac.ip, tags)
        const os = detectDeviceOs(ac.name || ac.ip, tags)
        return {
          id: ac.ip,
          name: ac.name || ac.ip,
          ip: ac.ip,
          queries: q,
          blocked: b,
          pct,
          isConfigured: false,
          tags,
          category,
          os,
        }
      })

    // Also include any active clients from stats.top_clients that aren't yet in auto_clients or knownRows
    const currentIps = new Set([...knownIps, ...autoRows.map(r => r.ip)])
    const runtimeOnlyRows: ClientRowData[] = []
    for (const [ip, q] of Object.entries(clientQueryMap)) {
      if (!currentIps.has(ip) && !ip.startsWith('255.') && ip !== '0.0.0.0') {
        const sample = clientBlockedRates[ip]
        let b = 0
        let pct = '0.0'
        if (sample && sample.total > 0) {
          const rate = sample.blocked / sample.total
          pct = (rate * 100).toFixed(1)
          b = Math.round(q * rate)
        }
        runtimeOnlyRows.push({
          id: ip,
          name: ip,
          ip,
          queries: q,
          blocked: b,
          pct,
          isConfigured: false,
          tags: [],
          category: detectDeviceCategory(ip, []),
          os: null,
        })
      }
    }

    return [...knownRows, ...autoRows, ...runtimeOnlyRows]
  }, [clients, clientQueryMap, clientBlockedRates])

  // Filter & Search logic for Directory
  const filteredRows = useMemo(() => {
    return allRows.filter(row => {
      // Search term
      if (search) {
        const q = search.toLowerCase()
        const matchesName = row.name.toLowerCase().includes(q)
        const matchesIp = row.ip.toLowerCase().includes(q)
        const matchesOs = row.os ? row.os.toLowerCase().includes(q) : false
        const matchesTag = row.tags.some(t => t.toLowerCase().includes(q))
        if (!matchesName && !matchesIp && !matchesTag && !matchesOs) return false
      }

      // Tab Category Filter
      if (categoryFilter === 'active') return row.queries > 0
      if (categoryFilter === 'configured') return row.isConfigured
      if (categoryFilter !== 'all') {
        if (row.category !== categoryFilter) return false
      }

      return true
    }).sort((a, b) => {
      if (sortBy === 'queries') return b.queries - a.queries
      if (sortBy === 'blocked') return b.blocked - a.blocked
      if (sortBy === 'pct') return parseFloat(b.pct) - parseFloat(a.pct)
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'ip') return a.ip.localeCompare(b.ip)
      return 0
    })
  }, [allRows, search, categoryFilter, sortBy])

  // Category counts
  const computerCount = useMemo(() => allRows.filter(r => r.category === 'computer').length, [allRows])
  const phoneCount = useMemo(() => allRows.filter(r => r.category === 'phone').length, [allRows])
  const mediaCount = useMemo(() => allRows.filter(r => r.category === 'media').length, [allRows])
  const networkCount = useMemo(() => allRows.filter(r => r.category === 'network').length, [allRows])
  const otherCount = useMemo(() => allRows.filter(r => r.category === 'other').length, [allRows])
  const activeCount = useMemo(() => allRows.filter(r => r.queries > 0).length, [allRows])
  const configuredCount = useMemo(() => allRows.filter(r => r.isConfigured).length, [allRows])

  // Top clients for Executive KPIs
  const topConsumer = useMemo(() => {
    const sorted = [...allRows].sort((a, b) => b.queries - a.queries)
    return sorted[0]
  }, [allRows])

  const topFiltered = useMemo(() => {
    const sorted = [...allRows].filter(r => r.queries > 0).sort((a, b) => b.blocked - a.blocked)
    return sorted[0]
  }, [allRows])

  const maxQueries = topConsumer?.queries || 1

  // Top Consumers List (sorted by query volume)
  const consumersLeaderboard = useMemo(() => {
    return [...allRows].filter(r => r.queries > 0).sort((a, b) => b.queries - a.queries)
  }, [allRows])

  // Threats List (sorted by blocked count & rate)
  const threatsLeaderboard = useMemo(() => {
    return [...allRows].filter(r => r.queries > 0).sort((a, b) => b.blocked - a.blocked)
  }, [allRows])

  // Threat severity classifications
  const highThreatCount = useMemo(() => allRows.filter(r => r.queries > 0 && parseFloat(r.pct) >= 28).length, [allRows])
  const moderateThreatCount = useMemo(() => allRows.filter(r => r.queries > 0 && parseFloat(r.pct) >= 10 && parseFloat(r.pct) < 28).length, [allRows])
  const lowThreatCount = useMemo(() => allRows.filter(r => r.queries > 0 && parseFloat(r.pct) < 10).length, [allRows])

  // Export CSV Handler
  const exportClientList = () => {
    const headers = ['Device Name', 'IP Address', 'Category', 'OS', 'Configured Profile', '24h Queries', 'Estimated Blocked', 'Block Rate %', 'Tags']
    const rows = filteredRows.map(r => [
      `"${r.name}"`,
      `"${r.ip}"`,
      `"${r.category}"`,
      `"${r.os || 'Unknown'}"`,
      r.isConfigured ? 'Yes' : 'No',
      r.queries,
      r.blocked,
      `"${r.pct}%"`,
      `"${r.tags.join(';')}"`
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `adguard_devices_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast('Client fleet exported to CSV', { type: 'success' })
  }

  return (
    <div className="space-y-6 text-[var(--text)]">
      {/* ── Page Heading (Desktop) ── */}
      <section className="page-heading hidden sm:flex">
        <div>
          <h1>Clients &amp; Network Endpoints</h1>
          <div className="subtitle">
            Connected hardware fleet, bandwidth consumers, filtered endpoints &amp; assigned security policies.
          </div>
          <p className="text-xs text-[var(--muted)] mt-1.5 font-mono">
            {allRows.length} total endpoints · {activeCount} active in 24h · {configuredCount} named profiles
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Search */}
          <div className="relative min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted)]" />
            <input
              type="text"
              placeholder="Search by name, IP, OS..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-[var(--surface-2)] border border-[var(--border)] focus:border-[var(--strong-border)] rounded-[9px] pl-9 pr-8 py-1.5 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-hidden transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* View Mode Toggle (Directory tab only) */}
          {activeTab === 'directory' && (
            <div className="flex items-center bg-[var(--surface-2)] border border-[var(--border)] rounded-[9px] p-0.5 text-xs">
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-[7px] transition-colors cursor-pointer ${viewMode === 'table' ? 'bg-[var(--surface-3)] text-[var(--text)] font-semibold shadow-xs' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
                title="Table View"
                aria-label="Table View"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('cards')}
                className={`p-1.5 rounded-[7px] transition-colors cursor-pointer ${viewMode === 'cards' ? 'bg-[var(--surface-3)] text-[var(--text)] font-semibold shadow-xs' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
                title="Card Grid View"
                aria-label="Card Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Export CSV */}
          <button
            onClick={exportClientList}
            className="secondary-btn"
            title="Download client directory as CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Fleet</span>
          </button>

          {/* Refresh */}
          <button
            onClick={loadData}
            disabled={loading}
            className="icon-btn"
            title="Refresh devices telemetry"
            aria-label="Refresh devices"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </section>

      {/* ── Mobile Native Header (X-Style) ── */}
      <div className="sm:hidden space-y-2.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted)]" />
          <input
            type="text"
            placeholder="Search by device name, IP, or OS..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[var(--surface-2)] border border-[var(--border)] focus:border-[var(--strong-border)] rounded-full pl-9 pr-8 py-2 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-hidden transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Executive Fleet KPI Strip ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5" aria-label="Client fleet KPIs">
        {/* KPI 1 */}
        <article className="card metric">
          <div className="metric-top">
            <span>Fleet Inventory</span>
            <span className="metric-symbol font-mono">◈</span>
          </div>
          <div className="metric-value font-mono tabular-nums">
            {allRows.length}
          </div>
          <div className="metric-foot">
            <span className="goodtext">{activeCount} active (24h)</span> · {configuredCount} named
          </div>
        </article>

        {/* KPI 2 */}
        <article
          onClick={() => topConsumer && navigate(`/clients/${encodeURIComponent(topConsumer.ip)}`)}
          className="card metric card-hover cursor-pointer"
          title="Click to view details of top consumer"
        >
          <div className="metric-top">
            <span>Top Consumer</span>
            <span className="metric-symbol font-mono">↗</span>
          </div>
          <div className="metric-value truncate font-sans text-lg sm:text-xl font-bold">
            {topConsumer?.name || '—'}
          </div>
          <div className="metric-foot truncate">
            <span className="goodtext">{topConsumer?.queries.toLocaleString()} reqs</span> · {((topConsumer?.queries || 0) / totalNetworkQueries * 100).toFixed(0)}% of traffic
          </div>
        </article>

        {/* KPI 3 */}
        <article
          onClick={() => topFiltered && navigate(`/clients/${encodeURIComponent(topFiltered.ip)}`)}
          className="card metric card-hover cursor-pointer"
          title="Click to view details of top filtered device"
        >
          <div className="metric-top">
            <span>Most Filtered</span>
            <span className="metric-symbol font-mono">⇄</span>
          </div>
          <div className="metric-value truncate font-sans text-lg sm:text-xl font-bold">
            {topFiltered?.name || '—'}
          </div>
          <div className="metric-foot truncate">
            <span className="badtext">{topFiltered?.blocked.toLocaleString()} blocked</span> · {topFiltered?.pct}% filter rate
          </div>
        </article>

        {/* KPI 4 */}
        <article className="card metric">
          <div className="metric-top">
            <span>DNS Shield Engine</span>
            <span className="metric-symbol font-mono">◎</span>
          </div>
          <div className="metric-value font-mono tabular-nums text-lg sm:text-xl font-bold flex items-center gap-1.5 text-[var(--green)]">
            <ShieldCheck className="w-5 h-5 shrink-0" />
            <span>100% Protected</span>
          </div>
          <div className="metric-foot">
            <span className="goodtext">Active Protection</span> on all endpoints
          </div>
        </article>
      </section>

      {/* ── Sub-Tab Navigation Bar ── */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] pb-1 overflow-x-auto scrollbar-none" role="tablist" aria-label="Clients tabs">
        <button
          role="tab"
          aria-selected={activeTab === 'directory'}
          onClick={() => setActiveTab('directory')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'directory'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Monitor className="w-3.5 h-3.5 text-[var(--text-primary)]" />
          <span>Fleet Directory</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-secondary)] font-mono">
            {allRows.length}
          </span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'consumers'}
          onClick={() => setActiveTab('consumers')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'consumers'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Activity className="w-3.5 h-3.5 text-[var(--green)]" />
          <span>Top Consumers &amp; Bandwidth</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-secondary)] font-mono">
            {consumersLeaderboard.length}
          </span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'threats'}
          onClick={() => setActiveTab('threats')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'threats'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5 text-[var(--red)]" />
          <span>Threats &amp; Filtered Endpoints</span>
          {threatsLeaderboard.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--red-bg)] text-[var(--red)] border border-[var(--red)] font-mono font-semibold">
              {threatsLeaderboard.length}
            </span>
          )}
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'categories'}
          onClick={() => setActiveTab('categories')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'categories'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Cpu className="w-3.5 h-3.5 text-[var(--text-primary)]" />
          <span>Categories &amp; Fleet Hygiene</span>
        </button>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────
          TAB 1: FLEET DIRECTORY
      ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'directory' && (
        <div className="space-y-4">
          {/* Controls: Search, Sort & Category Pills */}
          <div className="flex flex-col gap-2.5">
            <div className="flex gap-2 flex-wrap items-center justify-between">
              {/* Category Filter Pills */}
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-xs scrollbar-none">
                {[
                  { id: 'all', label: `All (${allRows.length})` },
                  { id: 'active', label: `Active (${activeCount})` },
                  { id: 'computer', label: `Computers (${computerCount})` },
                  { id: 'phone', label: `Phones (${phoneCount})` },
                  { id: 'media', label: `Media/TV (${mediaCount})` },
                  { id: 'network', label: `Network/IoT (${networkCount})` },
                  { id: 'configured', label: `Named (${configuredCount})` },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setCategoryFilter(tab.id as typeof categoryFilter)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                      categoryFilter === tab.id
                        ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs'
                        : 'bg-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Sort Dropdown */}
              <div className="flex items-center gap-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2.5 py-1 text-xs shrink-0">
                <ArrowUpDown className="w-3 h-3 text-[var(--text-muted)]" />
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as typeof sortBy)}
                  className="bg-transparent text-[var(--text-primary)] focus:outline-none cursor-pointer"
                  aria-label="Sort devices"
                >
                  <option value="queries">Sort: Traffic Volume</option>
                  <option value="blocked">Sort: Blocked Threats</option>
                  <option value="pct">Sort: Filter Rate %</option>
                  <option value="name">Sort: Name (A-Z)</option>
                  <option value="ip">Sort: IP Address</option>
                </select>
              </div>
            </div>
          </div>

          {/* Directory Content Area */}
          {loading ? (
            <div className="py-20 text-center text-xs text-[var(--text-tertiary)] bg-[var(--card)] border border-[var(--border)] rounded-xl flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-[var(--text-muted)]" />
              <span>Loading fleet inventory…</span>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="py-20 text-center text-xs text-[var(--text-tertiary)] bg-[var(--card)] border border-[var(--border)] rounded-xl">
              <HelpCircle className="w-6 h-6 mx-auto mb-2 text-[var(--text-muted)] opacity-60" />
              <span>No network devices match your current filters</span>
              {search && (
                <div className="mt-2">
                  <button
                    onClick={() => { setSearch(''); setCategoryFilter('all'); }}
                    className="text-xs text-[var(--text-primary)] underline hover:no-underline cursor-pointer"
                  >
                    Reset Search &amp; Filters
                  </button>
                </div>
              )}
            </div>
          ) : viewMode === 'table' ? (
            /* ── TABLE DIRECTORY VIEW ── */
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden shadow-xs overflow-x-auto">
              <div className="min-w-[680px]">
                {/* Table Header */}
                <div
                  className="grid gap-x-4 px-4 py-2.5 bg-[var(--bg-surface)] border-b border-[var(--border)] text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider shrink-0 items-center"
                  style={{ gridTemplateColumns: '1.4fr 140px 1.2fr 110px 100px 84px' }}
                >
                  <span>Device Identifier &amp; Type</span>
                  <span>IP Address</span>
                  <span>24h Traffic &amp; Share</span>
                  <span className="text-right">Threats Filtered</span>
                  <span>Policy Status</span>
                  <span className="text-right">Actions</span>
                </div>

                <div className="divide-y divide-[var(--border-subtle)]">
                  {filteredRows.map(row => (
                    <div
                      key={row.ip}
                      onClick={() => navigate(`/clients/${encodeURIComponent(row.ip)}`)}
                      className="grid gap-x-4 px-4 py-3 hover:bg-[var(--bg-hover)] cursor-pointer transition-colors group items-center"
                      style={{ gridTemplateColumns: '1.4fr 140px 1.2fr 110px 100px 84px' }}
                    >
                      {/* Name + Hardware Icon */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] flex items-center justify-center shrink-0">
                          {tagIcon(row.name, row.tags)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs text-[var(--text-primary)] font-medium truncate">{row.name}</span>
                            {row.os && (
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-secondary)]">
                                {row.os}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5 flex items-center gap-1">
                            <span>{row.isConfigured ? 'Named Profile' : 'Auto-Discovered'}</span>
                            {row.queries > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[var(--green)]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
                                <span>Active</span>
                              </span>
                            ) : (
                              <span className="text-[var(--text-muted)]">· Idle</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* IP Address */}
                      <div className="flex items-center gap-1 font-mono text-xs text-[var(--text-secondary)]">
                        <span>{row.ip}</span>
                        <CopyButton text={row.ip} />
                      </div>

                      {/* Traffic Share */}
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center justify-between text-xs font-mono mb-1">
                          <span className="text-[var(--text-primary)] font-medium">{row.queries.toLocaleString()} reqs</span>
                          <span className="text-[var(--text-tertiary)] text-[11px]">
                            {row.queries > 0 ? `${((row.queries / totalNetworkQueries) * 100).toFixed(1)}%` : '0%'}
                          </span>
                        </div>
                        <div className="h-1 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[var(--text-primary)] opacity-40 rounded-full transition-all"
                            style={{ width: `${Math.min(100, (row.queries / maxQueries) * 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Estimated Blocked */}
                      <div className="text-right font-mono">
                        <div className={`text-xs font-medium ${row.blocked > 0 ? 'text-[var(--red)]' : 'text-[var(--text-primary)]'}`}>
                          {row.blocked.toLocaleString()}
                        </div>
                        <div className="text-[10.5px] text-[var(--text-tertiary)]">{row.pct}% filtered</div>
                      </div>

                      {/* Policy Status */}
                      <div>
                        {row.client && !row.client.use_global_settings ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border)]">
                            <Shield className="w-2.5 h-2.5" /> Custom
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--bg-surface)] text-[var(--text-tertiary)] border border-[var(--border)]">
                            Global
                          </span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            navigate(`/live?client=${encodeURIComponent(row.ip)}`)
                          }}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                          title="Open Live Monitor for this device"
                          aria-label={`Live monitor for ${row.name}`}
                        >
                          <Radio className="w-3.5 h-3.5" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* ── CARDS DIRECTORY VIEW ── */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
              {filteredRows.map(row => (
                <div
                  key={row.ip}
                  onClick={() => navigate(`/clients/${encodeURIComponent(row.ip)}`)}
                  className="bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-xl p-4 card-hover shadow-xs cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)] shrink-0">
                          {tagIcon(row.name, row.tags)}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-xs font-semibold text-[var(--text-primary)] tracking-tight truncate">{row.name}</h3>
                          <div className="flex items-center gap-1 font-mono text-[11px] text-[var(--text-tertiary)] mt-0.5">
                            <span>{row.ip}</span>
                            <CopyButton text={row.ip} />
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {row.os && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-secondary)]">
                            {row.os}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] mb-3">
                      <div>
                        <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">Total Traffic</div>
                        <div className="text-sm font-mono font-bold text-[var(--text-primary)] mt-0.5">
                          {row.queries.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                          {((row.queries / totalNetworkQueries) * 100).toFixed(1)}% of fleet
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">Threats Blocked</div>
                        <div className={`text-sm font-mono font-bold mt-0.5 ${row.blocked > 0 ? 'text-[var(--red)]' : 'text-[var(--text-primary)]'}`}>
                          {row.blocked.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                          {row.pct}% filter rate
                        </div>
                      </div>
                    </div>

                    {/* Traffic Bar */}
                    <div className="mb-3">
                      <div className="h-1 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--text-primary)] opacity-40 rounded-full"
                          style={{ width: `${Math.min(100, (row.queries / maxQueries) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs">
                    <span className="text-[11px] text-[var(--text-tertiary)]">
                      {row.isConfigured ? 'Named Profile' : 'Auto-Discovered'}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          navigate(`/live?client=${encodeURIComponent(row.ip)}`)
                        }}
                        className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                        title="Live Stream for this device"
                      >
                        <Radio className="w-3 h-3" />
                        <span>Live Stream</span>
                      </button>
                      <span className="text-[11px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] flex items-center gap-0.5">
                        <span>Inspect</span>
                        <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────
          TAB 2: TOP CONSUMERS & BANDWIDTH
      ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'consumers' && (
        <div className="space-y-6">
          {/* Top Consumer Spotlight Hero Card */}
          {topConsumer && (
            <div className="card p-5 bg-[var(--surface)] border border-[var(--border)]">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-[var(--text)] shrink-0">
                    {tagIcon(topConsumer.name, topConsumer.tags)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text)] border border-[var(--border)]">
                        #1 Highest Traffic Producer
                      </span>
                      {topConsumer.os && (
                        <span className="text-xs font-mono text-[var(--muted)]">
                          {topConsumer.os}
                        </span>
                      )}
                    </div>
                    <h2 className="text-base sm:text-lg font-bold text-[var(--text)] mt-1">{topConsumer.name}</h2>
                    <div className="flex items-center gap-2 text-xs font-mono text-[var(--muted)] mt-0.5">
                      <span>IP: {topConsumer.ip}</span>
                      <CopyButton text={topConsumer.ip} />
                    </div>
                  </div>
                </div>

                {/* Right metrics */}
                <div className="flex items-center gap-6 self-start md:self-auto border-t md:border-t-0 pt-3 md:pt-0 border-[var(--border)]">
                  <div>
                    <div className="text-[10px] uppercase font-semibold text-[var(--muted)]">24h Queries</div>
                    <div className="text-xl font-bold font-mono text-[var(--text)]">
                      {topConsumer.queries.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-[var(--green)]">
                      {((topConsumer.queries / totalNetworkQueries) * 100).toFixed(1)}% of all traffic
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate(`/live?client=${encodeURIComponent(topConsumer.ip)}`)}
                      className="secondary-btn"
                    >
                      <Radio className="w-3.5 h-3.5" />
                      <span>Live Monitor</span>
                    </button>
                    <button
                      onClick={() => navigate(`/clients/${encodeURIComponent(topConsumer.ip)}`)}
                      className="primary-btn"
                    >
                      <span>Deep Dive</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Leaderboard Table of Consumers */}
          <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Network Traffic Leaderboard</h3>
                <p className="text-xs text-[var(--text)] mt-0.5">Ranked by DNS request volume over the past 24 hours</p>
              </div>
              <span className="text-xs font-mono text-[var(--muted)]">{consumersLeaderboard.length} active devices</span>
            </div>

            <div className="divide-y divide-[var(--border-subtle)]">
              {consumersLeaderboard.slice(0, 15).map((row, idx) => {
                const sharePct = ((row.queries / totalNetworkQueries) * 100).toFixed(1)
                const relativePct = Math.min(100, (row.queries / maxQueries) * 100)
                const qpm = (row.queries / (24 * 60)).toFixed(1)

                return (
                  <div
                    key={row.ip}
                    onClick={() => navigate(`/clients/${encodeURIComponent(row.ip)}`)}
                    className="py-3 px-2 flex items-center justify-between gap-4 hover:bg-[var(--surface-2)] rounded-lg transition-colors cursor-pointer group"
                  >
                    {/* Rank & Device Name */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className={`w-6 text-center font-mono text-xs font-bold ${idx === 0 ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>
                        #{idx + 1}
                      </span>
                      <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center shrink-0">
                        {tagIcon(row.name, row.tags)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-[var(--text)] truncate">{row.name}</span>
                          {row.os && (
                            <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-[var(--surface-3)] text-[var(--muted)]">
                              {row.os}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-[var(--muted)] flex items-center gap-1">
                          <span>{row.ip}</span>
                          <span>· ~{qpm} req/min</span>
                        </div>
                      </div>
                    </div>

                    {/* Proportional Traffic Bar */}
                    <div className="hidden sm:block w-36 md:w-56 shrink-0">
                      <div className="flex justify-between text-[11px] font-mono mb-1 text-[var(--muted)]">
                        <span>Share: {sharePct}%</span>
                        <span className="text-[var(--text)] font-semibold">{row.queries.toLocaleString()}</span>
                      </div>
                      <div className="h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--text)] opacity-60 rounded-full transition-all"
                          style={{ width: `${relativePct}%` }}
                        />
                      </div>
                    </div>

                    {/* Quick Link Button */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono font-bold text-[var(--text)] sm:hidden">
                        {row.queries.toLocaleString()}
                      </span>
                      <ChevronRight className="w-4 h-4 text-[var(--muted)] group-hover:text-[var(--text)] transition-colors" />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────
          TAB 3: THREATS & FILTERED ENDPOINTS
      ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'threats' && (
        <div className="space-y-6">
          {/* Threat Risk Assessment Breakdown Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] uppercase font-bold text-[var(--red)]">High Interception Rate</span>
                <span className="w-2 h-2 rounded-full bg-[var(--red)]" />
              </div>
              <div className="text-2xl font-bold font-mono text-[var(--text)]">{highThreatCount}</div>
              <div className="text-xs text-[var(--muted)] mt-1">&ge;28% requests filtered (Ad-heavy/Trackers)</div>
            </div>

            <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] uppercase font-bold text-[var(--muted)]">Moderate Interception</span>
                <span className="w-2 h-2 rounded-full bg-[var(--border-strong)]" />
              </div>
              <div className="text-2xl font-bold font-mono text-[var(--text)]">{moderateThreatCount}</div>
              <div className="text-xs text-[var(--muted)] mt-1">10% – 28% filtered (Normal web telemetry)</div>
            </div>

            <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] uppercase font-bold text-[var(--green)]">Clean / Low Filter</span>
                <span className="w-2 h-2 rounded-full bg-[var(--green)]" />
              </div>
              <div className="text-2xl font-bold font-mono text-[var(--text)]">{lowThreatCount}</div>
              <div className="text-xs text-[var(--muted)] mt-1">&lt;10% filtered (Minimal ad-traffic)</div>
            </div>
          </div>

          {/* Threat Leaderboard Table */}
          <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Filtered Threats by Device</h3>
                <p className="text-xs text-[var(--text)] mt-0.5">Endpoints intercepted most frequently by AdGuard blocking rules</p>
              </div>
              <span className="text-xs font-mono text-[var(--red)] font-semibold">{threatsLeaderboard.length} endpoints intercepted</span>
            </div>

            <div className="divide-y divide-[var(--border-subtle)]">
              {threatsLeaderboard.map((row, idx) => {
                const blockRateNum = parseFloat(row.pct)
                const isHigh = blockRateNum >= 28

                return (
                  <div
                    key={row.ip}
                    onClick={() => navigate(`/clients/${encodeURIComponent(row.ip)}`)}
                    className="py-3 px-2 flex items-center justify-between gap-4 hover:bg-[var(--surface-2)] rounded-lg transition-colors cursor-pointer group"
                  >
                    {/* Device Details */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="w-6 text-center font-mono text-xs font-bold text-[var(--muted)]">
                        #{idx + 1}
                      </span>
                      <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center shrink-0">
                        {tagIcon(row.name, row.tags)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-[var(--text)] truncate">{row.name}</span>
                          {row.os && (
                            <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-[var(--surface-3)] text-[var(--muted)]">
                              {row.os}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-[var(--muted)] flex items-center gap-1">
                          <span>{row.ip}</span>
                          <span>· {row.queries.toLocaleString()} total lookups</span>
                        </div>
                      </div>
                    </div>

                    {/* Threat Badges */}
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right font-mono">
                        <div className="text-xs font-bold text-[var(--red)]">
                          {row.blocked.toLocaleString()} blocked
                        </div>
                        <div className="text-[10.5px] text-[var(--muted)]">
                          {row.pct}% block rate
                        </div>
                      </div>

                      <div className="hidden sm:block">
                        {isHigh ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[var(--red-bg)] text-[var(--red)] border border-[var(--red)]">
                            High Telemetry
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--surface-2)] text-[var(--muted)] border border-[var(--border)]">
                            Filtered
                          </span>
                        )}
                      </div>

                      <ChevronRight className="w-4 h-4 text-[var(--muted)] group-hover:text-[var(--text)] transition-colors" />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Threat Advisory Tip */}
          <div className="card p-4 bg-[var(--surface-2)] border border-[var(--border)] flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-[var(--green)] shrink-0 mt-0.5" />
            <div className="text-xs">
              <span className="font-semibold text-[var(--text)]">Telemetry &amp; Ad Interception Intelligence: </span>
              <span className="text-[var(--muted)]">
                Devices like Smart TVs, media streaming boxes, and mobile applications routinely transmit background analytics, ad tracking pixels, and diagnostics every few seconds. AdGuard intercepts these silently without breaking regular streaming or connectivity.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────
          TAB 4: CATEGORIES & FLEET HYGIENE
      ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'categories' && (
        <div className="space-y-6">
          {/* Category Breakdown Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
            {/* Computers */}
            <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[var(--text)]">Computers</span>
                <Monitor className="w-4 h-4 text-[var(--muted)]" />
              </div>
              <div className="text-2xl font-bold font-mono text-[var(--text)]">{computerCount}</div>
              <div className="text-xs text-[var(--muted)] mt-1">Laptops, PCs</div>
            </div>

            {/* Mobile */}
            <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[var(--text)]">Mobile</span>
                <Smartphone className="w-4 h-4 text-[var(--muted)]" />
              </div>
              <div className="text-2xl font-bold font-mono text-[var(--text)]">{phoneCount}</div>
              <div className="text-xs text-[var(--muted)] mt-1">Phones, Tablets</div>
            </div>

            {/* Smart TV / Media */}
            <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[var(--text)]">Media &amp; TV</span>
                <Tv className="w-4 h-4 text-[var(--muted)]" />
              </div>
              <div className="text-2xl font-bold font-mono text-[var(--text)]">{mediaCount}</div>
              <div className="text-xs text-[var(--muted)] mt-1">TVs, Consoles</div>
            </div>

            {/* Network / IoT */}
            <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[var(--text)]">Network</span>
                <Router className="w-4 h-4 text-[var(--muted)]" />
              </div>
              <div className="text-2xl font-bold font-mono text-[var(--text)]">{networkCount}</div>
              <div className="text-xs text-[var(--muted)] mt-1">Routers, NAS</div>
            </div>

            {/* Other / Unclassified */}
            <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[var(--text)]">Unclassified</span>
                <Wifi className="w-4 h-4 text-[var(--muted)]" />
              </div>
              <div className="text-2xl font-bold font-mono text-[var(--text)]">{otherCount}</div>
              <div className="text-xs text-[var(--muted)] mt-1">ARP/DHCP Nodes</div>
            </div>
          </div>

          {/* Fleet Hygiene & Health Card */}
          <div className="card p-5 bg-[var(--card)] border border-[var(--border)] space-y-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Fleet Network Hygiene</h3>
              <p className="text-xs text-[var(--text)] mt-0.5">Quality of endpoint identification and security policy assignment</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                <div className="text-[10px] uppercase font-semibold text-[var(--muted)]">Profile Naming Ratio</div>
                <div className="text-xl font-bold font-mono text-[var(--text)] mt-1">
                  {allRows.length > 0 ? `${((configuredCount / allRows.length) * 100).toFixed(0)}%` : '0%'}
                </div>
                <div className="text-xs text-[var(--muted)] mt-1">
                  {configuredCount} named out of {allRows.length} endpoints
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                <div className="text-[10px] uppercase font-semibold text-[var(--muted)]">DNS Engine Coverage</div>
                <div className="text-xl font-bold font-mono text-[var(--green)] mt-1 flex items-center gap-1.5">
                  <ShieldCheck className="w-5 h-5 shrink-0" />
                  <span>100% Active</span>
                </div>
                <div className="text-xs text-[var(--muted)] mt-1">
                  All local endpoints protected
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                <div className="text-[10px] uppercase font-semibold text-[var(--muted)]">Active vs Idle</div>
                <div className="text-xl font-bold font-mono text-[var(--text)] mt-1">
                  {activeCount} / {allRows.length}
                </div>
                <div className="text-xs text-[var(--muted)] mt-1">
                  Transmitted queries in the last 24h
                </div>
              </div>
            </div>

            {/* Recommendation Box */}
            <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-start gap-3">
              <HelpCircle className="w-4 h-4 text-[var(--muted)] shrink-0 mt-0.5" />
              <div className="text-xs text-[var(--muted)]">
                <span className="font-semibold text-[var(--text)]">Hygiene Recommendation: </span>
                Assign friendly names and tags to auto-discovered IP addresses by clicking on any row in the Fleet Directory. Named profiles make it instantly clear in your live query logs which person or device originated a DNS lookup.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
