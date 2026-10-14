import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  getStatus, getFiltering, getDnsInfo, deleteServer, testServerConnection,
  getBackendBaseUrl, getUserRules, addRulesBatch, getBlockedServicesList,
  updateBlockedServices, getSecurityPolicies, toggleSafebrowsing,
  toggleParental, updateSafeSearch,
  getStatsConfig, updateStatsConfig, getQueryLogConfig, updateQueryLogConfig,
  type AghStatus, type FilteringStatus, type AghServerConfig
} from '../api'
import {
  Server, Globe, Shield, CheckCircle2, XCircle, ExternalLink, RefreshCw,
  AlertTriangle, Plus, Trash2, Edit3, Wifi, Check, Loader2, Radio,
  Smartphone, Moon, Download, Copy, Sliders,
  Search, X, Clock, Upload, Archive, Sparkles
} from 'lucide-react'
import AIReport from './AIReport'
import { useServer } from '../contexts/ServerContext'
import { useToast } from '../contexts/ToastContext'
import { usePageTitle } from '../hooks/usePageTitle'

interface DnsInfo {
  upstream_dns: string[]
  bootstrap_dns: string[]
  upstream_mode: string
  fallback_dns: string[]
  dnssec_enabled: boolean
  cache_size: number
  cache_ttl_min: number
  cache_ttl_max: number
  cache_optimistic: boolean
  resolve_clients: boolean
  use_private_ptr_resolvers: boolean
}

function UpstreamBadge({ url }: { url: string }) {
  let label = url
  let type = 'DNS'
  if (url.includes('cloudflare')) { label = 'Cloudflare'; type = 'DoH' }
  else if (url.includes('google')) { label = 'Google'; type = 'DoH' }
  else if (url.includes('quad9')) { label = 'Quad9'; type = 'DoH' }
  else if (url.includes('adguard')) { label = 'AdGuard'; type = 'DoH' }
  else if (url.startsWith('https://')) { type = 'DoH' }
  else if (url.startsWith('tls://')) { label = url.replace('tls://', ''); type = 'DoT' }
  else if (url.startsWith('quic://')) { label = url.replace('quic://', ''); type = 'DoQ' }

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-2 h-2 rounded-full bg-[var(--green)] shrink-0" />
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[var(--text)] flex items-center gap-2">
            <span>{label}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface-3)] text-[var(--muted)] border border-[var(--border)]">
              {type}
            </span>
          </div>
          <div className="text-[11px] font-mono text-[var(--muted)] truncate mt-0.5">{url}</div>
        </div>
      </div>
      <button
        onClick={() => {
          navigator.clipboard.writeText(url)
        }}
        className="p-1.5 rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors cursor-pointer shrink-0"
        title="Copy Upstream Address"
        aria-label={`Copy address ${url}`}
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function DetailRow({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-start justify-between px-4 py-2.5 border-b border-[var(--border-subtle)] last:border-0 gap-4">
      <div>
        <div className="text-xs font-medium text-[var(--text)]">{label}</div>
        {sub && <div className="text-[10.5px] text-[var(--muted)] mt-0.5">{sub}</div>}
      </div>
      <div className="text-xs font-mono text-right text-[var(--text)] shrink-0 break-all">{value}</div>
    </div>
  )
}

export default function SettingsPage() {
  usePageTitle('Settings')
  const { servers, activeServer, switchActiveServer, openServerModal, refreshServers, serverVersion } = useServer()
  const { toast } = useToast()

  // Top Sub-Tabs
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get('tab') as 'nodes' | 'dns' | 'filters' | 'system' | 'intelligence' | null
  const [activeTab, setActiveTab] = useState<'nodes' | 'dns' | 'filters' | 'system' | 'intelligence'>(
    tabFromUrl && ['nodes', 'dns', 'filters', 'system', 'intelligence'].includes(tabFromUrl) ? tabFromUrl : 'nodes'
  )

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && ['nodes', 'dns', 'filters', 'system', 'intelligence'].includes(tab)) {
      setActiveTab(tab as any)
    }
  }, [searchParams])

  const handleTabChange = (tab: 'nodes' | 'dns' | 'filters' | 'system' | 'intelligence') => {
    setActiveTab(tab)
    if (tab === 'nodes') {
      setSearchParams({})
    } else {
      setSearchParams({ tab })
    }
  }

  // Blocklist Filter Search
  const [listSearch, setListSearch] = useState('')

  const [status, setStatus] = useState<AghStatus | null>(null)
  const [filtering, setFiltering] = useState<FilteringStatus | null>(null)
  const [dnsInfo, setDnsInfo] = useState<DnsInfo | null>(null)
  const [statsInterval, setStatsInterval] = useState<number>(1)
  const [querylogInterval, setQuerylogInterval] = useState<number>(90)
  const [updatingStatsInterval, setUpdatingStatsInterval] = useState(false)
  const [updatingQuerylogInterval, setUpdatingQuerylogInterval] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [pings, setPings] = useState<Record<string, { loading?: boolean; latencyMs?: number; version?: string; error?: string }>>({})

  const loadAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true)
      setError(null)
    }
    try {
      const [s, f, d, sc, qc] = await Promise.all([
        getStatus(),
        getFiltering(),
        getDnsInfo(),
        getStatsConfig().catch(() => null),
        getQueryLogConfig().catch(() => null),
      ])
      setStatus(s)
      setFiltering(f)
      setDnsInfo(d as DnsInfo)
      if (sc?.interval) setStatsInterval(sc.interval)
      if (qc?.interval) setQuerylogInterval(qc.interval)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load configuration parameters')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const handleUpdateStatsInterval = async (val: number) => {
    setUpdatingStatsInterval(true)
    try {
      await updateStatsConfig(val)
      setStatsInterval(val)
      toast(`Statistics window updated to ${val === 1 ? '24 Hours' : `${val} Days`}`, { type: 'success' })
    } catch {
      toast('Failed to update statistics interval', { type: 'error' })
    } finally {
      setUpdatingStatsInterval(false)
    }
  }

  const handleUpdateQuerylogInterval = async (val: number) => {
    setUpdatingQuerylogInterval(true)
    try {
      await updateQueryLogConfig(val)
      setQuerylogInterval(val)
      toast(`Query log retention updated to ${val === 1 ? '24 Hours' : `${val} Days`}`, { type: 'success' })
    } catch {
      toast('Failed to update query log retention', { type: 'error' })
    } finally {
      setUpdatingQuerylogInterval(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [loadAll, serverVersion])

  const handleTestNode = async (srv: AghServerConfig) => {
    setPings(prev => ({ ...prev, [srv.id]: { loading: true } }))
    try {
      const res = await testServerConnection({ host: srv.host, username: srv.username })
      if (res.ok) {
        setPings(prev => ({
          ...prev,
          [srv.id]: {
            loading: false,
            latencyMs: res.latencyMs,
            version: res.data?.version,
          },
        }))
      } else {
        setPings(prev => ({
          ...prev,
          [srv.id]: {
            loading: false,
            error: res.error || 'Connection failed',
          },
        }))
      }
    } catch (err: unknown) {
      setPings(prev => ({
        ...prev,
        [srv.id]: {
          loading: false,
          error: err instanceof Error ? err.message : 'Error',
        },
      }))
    }
  }

  const handleTestAllNodes = async () => {
    toast('Probing all cluster nodes...', { type: 'success' })
    for (const srv of servers) {
      handleTestNode(srv)
    }
  }

  const handleDelete = async (srv: AghServerConfig) => {
    if (servers.length <= 1) {
      toast('Cannot remove the only configured server.', { type: 'error' })
      return
    }
    if (!window.confirm(`Are you sure you want to remove cluster node "${srv.name}" (${srv.host})?`)) {
      return
    }
    try {
      await deleteServer(srv.id)
      toast(`Server node "${srv.name}" removed`, { type: 'success' })
      await refreshServers()
      await loadAll(true)
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to delete server node', { type: 'error' })
    }
  }

  // Derive reliable AGH portal URL
  const aghAdminUrl = useMemo(() => {
    if (activeServer?.host) {
      return activeServer.host
    }
    if (status) {
      const bindIp = status.dns_addresses?.[0]?.replace(/^::$/, '127.0.0.1') || '127.0.0.1'
      return `http://${bindIp}:${status.http_port ?? 80}`
    }
    return null
  }, [activeServer, status])

  const totalRules = filtering?.filters?.reduce((a, f) => a + (f.rules_count || 0), 0) ?? 0

  // Filtered blocklists
  const filteredBlocklists = useMemo(() => {
    if (!filtering?.filters) return []
    if (!listSearch.trim()) return filtering.filters
    const q = listSearch.toLowerCase()
    return filtering.filters.filter(f => f.name.toLowerCase().includes(q) || f.url.toLowerCase().includes(q))
  }, [filtering, listSearch])

  // Diagnostic export
  const handleExportDiagnostics = useCallback(() => {
    const now = new Date()
    const payload = {
      timestamp: now.toISOString(),
      activeServer,
      servers: servers.map(s => ({ id: s.id, name: s.name, host: s.host, username: s.username })),
      status,
      filtering: {
        enabled: filtering?.enabled,
        interval: filtering?.interval,
        totalRules,
        filtersCount: filtering?.filters?.length,
        userRulesCount: filtering?.user_rules?.length,
      },
      dns: dnsInfo,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `adguard_settings_${now.toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('Diagnostics JSON exported', { type: 'success' })
  }, [activeServer, servers, status, filtering, totalRules, dnsInfo, toast])

  const handleCopyDiagnostics = useCallback(() => {
    const now = new Date()
    const summary = `=== AdGuard Home Diagnostic Summary ===
Software Version: v${status?.version || 'Unknown'}
Running Status: ${status?.running ? 'Running' : 'Stopped'}
Active Node: ${activeServer?.name || 'Local'} (${activeServer?.host || 'default'})
DNS Port: ${status?.dns_port || 53} | HTTP Port: ${status?.http_port || 80}
Total Compiled Rules: ${totalRules.toLocaleString()} across ${filtering?.filters?.length || 0} blocklists
Upstream Resolvers: ${(dnsInfo?.upstream_dns || []).join(', ') || 'Default'}
Upstream Mode: ${dnsInfo?.upstream_mode || 'parallel'}
DNSSEC Validation: ${dnsInfo?.dnssec_enabled ? 'Enabled' : 'Disabled'}
Optimistic Cache: ${dnsInfo?.cache_optimistic ? 'Enabled' : 'Disabled'}
Generated: ${now.toLocaleString()}`

    navigator.clipboard.writeText(summary).then(() => {
      toast('Diagnostic summary copied to clipboard', { type: 'success' })
    })
  }, [status, activeServer, totalRules, filtering, dnsInfo, toast])

  // Full Configuration Backup Export
  const handleExportFullBackup = async () => {
    try {
      toast('Generating full configuration snapshot...', { type: 'info' })
      const [rules, blocked, policies, flt] = await Promise.all([
        getUserRules().catch(() => []),
        getBlockedServicesList().catch(() => []),
        getSecurityPolicies().catch(() => null),
        getFiltering().catch(() => null),
      ])

      const backupData = {
        app: 'AdGuard-Home-Obsidian-Dashboard',
        version: '1.0',
        timestamp: new Date().toISOString(),
        serverHost: activeServer?.host || 'localhost',
        userRules: rules,
        blockedServices: blocked,
        securityPolicies: policies,
        filterLists: flt?.filters || [],
      }

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `adguard-config-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast('Full configuration snapshot downloaded', { type: 'success' })
    } catch {
      toast('Failed to generate configuration backup', { type: 'error' })
    }
  }

  // Restore Modal State & File Input Ref
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [restoreModalData, setRestoreModalData] = useState<{
    userRules?: string[]
    blockedServices?: string[]
    securityPolicies?: Record<string, unknown>
  } | null>(null)
  const [restoring, setRestoring] = useState(false)

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string)
        if (!json || typeof json !== 'object') throw new Error('Invalid JSON')
        setRestoreModalData({
          userRules: Array.isArray(json.userRules) ? json.userRules : undefined,
          blockedServices: Array.isArray(json.blockedServices) ? json.blockedServices : undefined,
          securityPolicies: json.securityPolicies,
        })
      } catch {
        toast('Selected file is not a valid AdGuard backup JSON', { type: 'error' })
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleConfirmRestore = async () => {
    if (!restoreModalData) return
    setRestoring(true)
    try {
      // 1. User rules (Atomic batch restore)
      if (restoreModalData.userRules?.length) {
        await addRulesBatch(restoreModalData.userRules).catch(() => {})
      }

      // 2. Blocked services
      if (restoreModalData.blockedServices?.length) {
        await updateBlockedServices(restoreModalData.blockedServices).catch(() => {})
      }

      // 3. Security policies
      if (restoreModalData.securityPolicies) {
        const sp = restoreModalData.securityPolicies as {
          safebrowsing?: { enabled?: boolean }
          parental?: { enabled?: boolean }
          safesearch?: { enabled?: boolean }
        }
        if (typeof sp.safebrowsing?.enabled === 'boolean') {
          await toggleSafebrowsing(sp.safebrowsing.enabled).catch(() => {})
        }
        if (typeof sp.parental?.enabled === 'boolean') {
          await toggleParental(sp.parental.enabled).catch(() => {})
        }
        if (sp.safesearch) {
          await updateSafeSearch(sp.safesearch).catch(() => {})
        }
      }

      toast('Configuration backup restored successfully', { type: 'success' })
      setRestoreModalData(null)
      loadAll(true)
    } catch {
      toast('Failed to restore some configuration parameters', { type: 'error' })
    } finally {
      setRestoring(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 text-[var(--text)]">
        <div className="h-8 w-64 skeleton-shimmer rounded-[9px]" />
        <div className="grid gap-4 lg:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card h-48 skeleton-shimmer" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 text-[var(--text)]">
      {/* ── Page Heading (Desktop) ── */}
      <section className="page-heading hidden sm:flex">
        <div>
          <h1>Settings &amp; Cluster Architecture</h1>
          <div className="subtitle">
            AdGuard Home runtime subsystem, cluster node registry, upstream resolvers &amp; appearance preferences.
          </div>
          <p className="text-xs text-[var(--muted)] mt-1.5 font-mono">
            Active: {activeServer?.name || 'Local Instance'} ({activeServer?.host || 'default'}) · v{status?.version || '—'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {aghAdminUrl && (
            <a
              href={aghAdminUrl}
              target="_blank"
              rel="noreferrer"
              className="secondary-btn"
              title="Open official AdGuard Home administrative interface"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Native AGH Portal</span>
            </a>
          )}

          <button
            onClick={handleTestAllNodes}
            className="secondary-btn"
            title="Probe latency across all configured cluster nodes"
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>Test All Nodes</span>
          </button>

          <button
            onClick={() => loadAll(true)}
            disabled={refreshing}
            className="icon-btn"
            title="Refresh parameters"
            aria-label="Refresh configuration"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </section>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 px-4 py-3 bg-[var(--surface)] border border-[var(--red)] rounded-xl text-xs text-[var(--text)]">
          <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--red)]" />
          <span className="flex-1">{error}</span>
          <button onClick={() => loadAll(true)} className="secondary-btn py-1 px-2.5 text-xs font-medium cursor-pointer">
            Retry
          </button>
        </div>
      )}

      {/* ── Executive Settings KPI Strip ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5" aria-label="Settings KPIs">
        {/* KPI 1: Active Cluster Node */}
        <article className="card metric">
          <div className="metric-top">
            <span>Active Cluster Node</span>
            <span className="metric-symbol font-mono">◈</span>
          </div>
          <div className="metric-value font-mono tabular-nums text-base sm:text-lg font-bold truncate">
            {activeServer?.name || 'Primary Node'}
          </div>
          <div className="metric-foot truncate">
            <span className="goodtext">● Connected</span> · {servers.length} configured
          </div>
        </article>

        {/* KPI 2: Protection Engine Status */}
        <article className="card metric">
          <div className="metric-top">
            <span>DNS Engine State</span>
            <span className="metric-symbol font-mono">◎</span>
          </div>
          <div className="metric-value font-mono tabular-nums text-base sm:text-lg font-bold flex items-center gap-1.5">
            {status?.running ? (
              <span className="text-[var(--green)] flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>Running</span>
              </span>
            ) : (
              <span className="text-[var(--red)] flex items-center gap-1.5">
                <XCircle className="w-4 h-4" />
                <span>Stopped</span>
              </span>
            )}
          </div>
          <div className="metric-foot">
            <span className="goodtext">v{status?.version || '—'}</span> · Port {status?.dns_port || 53}
          </div>
        </article>

        {/* KPI 3: Compiled Filter Rules */}
        <article className="card metric">
          <div className="metric-top">
            <span>Filter Rules</span>
            <span className="metric-symbol font-mono">⇄</span>
          </div>
          <div className="metric-value font-mono tabular-nums text-base sm:text-lg font-bold">
            {totalRules.toLocaleString()}
          </div>
          <div className="metric-foot">
            <span className="goodtext">{filtering?.filters?.length || 0} lists</span> · auto-updated
          </div>
        </article>

        {/* KPI 4: Upstream Resolvers */}
        <article className="card metric">
          <div className="metric-top">
            <span>Upstream Resolvers</span>
            <span className="metric-symbol font-mono">↗</span>
          </div>
          <div className="metric-value font-mono tabular-nums text-base sm:text-lg font-bold">
            {dnsInfo?.upstream_dns?.length || 0} Servers
          </div>
          <div className="metric-foot capitalize">
            Mode: {dnsInfo?.upstream_mode || 'Parallel'}
          </div>
        </article>
      </section>

      {/* ── Sub-Tab Navigation Bar ── */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] pb-1 overflow-x-auto scrollbar-none" role="tablist" aria-label="Settings tabs">
        <button
          role="tab"
          aria-selected={activeTab === 'nodes'}
          onClick={() => handleTabChange('nodes')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'nodes'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs font-semibold'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Server className="w-3.5 h-3.5 text-[var(--text-primary)]" />
          <span>Nodes &amp; Gateway</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--muted)] font-mono">
            {servers.length}
          </span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'dns'}
          onClick={() => handleTabChange('dns')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'dns'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs font-semibold'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Globe className="w-3.5 h-3.5 text-[var(--green)]" />
          <span>DNS &amp; Upstreams</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--muted)] font-mono">
            {dnsInfo?.upstream_dns?.length || 0}
          </span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'filters'}
          onClick={() => handleTabChange('filters')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'filters'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs font-semibold'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Shield className="w-3.5 h-3.5 text-[var(--red)]" />
          <span>Filtering &amp; Subscriptions</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--muted)] font-mono">
            {filtering?.filters?.length || 0}
          </span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'system'}
          onClick={() => handleTabChange('system')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'system'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs font-semibold'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Sliders className="w-3.5 h-3.5 text-[var(--text-primary)]" />
          <span>System &amp; Backups</span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'intelligence'}
          onClick={() => handleTabChange('intelligence')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'intelligence'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs font-semibold'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-[var(--text-primary)]" />
          <span>AI Intelligence</span>
        </button>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────
          TAB 1: NODES & GATEWAY
      ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'nodes' && (
        <div className="space-y-6">
          {/* AdGuard Home Instances Cluster Management */}
          <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
            <div className="flex items-center justify-between pb-3.5 border-b border-[var(--border)] flex-wrap gap-2">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">AdGuard Home Cluster Nodes</h2>
                <p className="text-xs text-[var(--text)] mt-0.5">Switch between primary routers, secondary DNS servers, or cloud VPS instances</p>
              </div>
              <button
                type="button"
                onClick={() => openServerModal()}
                className="primary-btn text-xs py-1.5 px-3 flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Connect Node</span>
              </button>
            </div>

            <div className="divide-y divide-[var(--border-subtle)] mt-1">
              {servers.map((srv) => {
                const isActive = activeServer?.id === srv.id
                const ping = pings[srv.id]

                return (
                  <div
                    key={srv.id}
                    className={`py-4 px-2 flex flex-col md:flex-row md:items-center justify-between gap-3.5 transition-colors rounded-lg ${
                      isActive ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]/40'
                    }`}
                  >
                    {/* Server Info */}
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`mt-0.5 w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${
                        isActive
                          ? 'border-[var(--green)] bg-[var(--green-bg)] text-[var(--green)]'
                          : 'border-[var(--border)] bg-[var(--surface-3)] text-[var(--muted)]'
                      }`}>
                        <Server className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-[var(--text)]">
                            {srv.name}
                          </span>
                          {isActive ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[var(--green-bg)] text-[var(--green)] border border-[var(--green)]">
                              <Check className="w-3 h-3" />
                              Active Node
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono text-[var(--muted)] border border-[var(--border)] bg-[var(--surface)]">
                              Standby
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-[var(--muted)] font-mono mt-1 flex-wrap">
                          <span>{srv.host}</span>
                          {srv.username && <span>User: {srv.username}</span>}
                          {srv.hasPassword && <span className="opacity-80">Encrypted Auth</span>}
                        </div>

                        {/* Ping Feedback */}
                        {ping && (
                          <div className="mt-1.5 text-xs">
                            {ping.loading && (
                              <span className="inline-flex items-center gap-1.5 text-[var(--muted)]">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Pinging node...
                              </span>
                            )}
                            {!ping.loading && ping.latencyMs !== undefined && (
                              <span className="inline-flex items-center gap-1.5 goodtext font-mono text-[11px] font-medium">
                                <Wifi className="w-3 h-3 text-[var(--green)]" />
                                Connected ({ping.latencyMs}ms{ping.version ? ` • ${ping.version}` : ''})
                              </span>
                            )}
                            {!ping.loading && ping.error && (
                              <span className="inline-flex items-center gap-1 badtext text-[11px]">
                                <AlertTriangle className="w-3 h-3 text-[var(--red)]" />
                                {ping.error}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                      <button
                        type="button"
                        onClick={() => handleTestNode(srv)}
                        disabled={ping?.loading}
                        className="secondary-btn text-xs py-1 px-2.5 flex items-center gap-1 cursor-pointer"
                        title="Test connection to node"
                      >
                        <Wifi className="w-3 h-3" />
                        <span>Test</span>
                      </button>

                      {!isActive && (
                        <button
                          type="button"
                          onClick={() => switchActiveServer(srv.id)}
                          className="primary-btn text-xs py-1 px-3 flex items-center gap-1 cursor-pointer"
                          title="Switch active AdGuard Home instance"
                        >
                          <Radio className="w-3 h-3" />
                          <span>Switch Active</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => openServerModal(srv)}
                        className="secondary-btn text-xs py-1 px-2.5 flex items-center gap-1 cursor-pointer"
                        title="Edit node configuration"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Edit</span>
                      </button>

                      {servers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDelete(srv)}
                          className="icon-btn text-[var(--muted)] hover:text-[var(--red)] hover:bg-[var(--surface-3)]"
                          title="Remove this server node"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Gateway Endpoint Panel */}
          <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
            <div className="flex items-center justify-between pb-3.5 border-b border-[var(--border)] flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-[var(--text)]" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                  Dashboard Gateway Target (LAN / Web)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('agh:open-backend-modal'))}
                className="secondary-btn text-xs py-1 px-2.5 cursor-pointer"
              >
                <span>Configure Endpoint</span>
              </button>
            </div>
            <div className="pt-3 text-xs space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-[var(--text)]">Active Gateway:</span>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)]">
                  {getBackendBaseUrl() || '(Default: Same Host / Origin)'}
                </span>
              </div>
              <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                When using this dashboard from other computers, phones, or tablets on your home network, point the gateway to your host PC IP address (e.g. <code className="px-1 py-0.2 rounded bg-[var(--surface-2)] border border-[var(--border)] font-mono">http://192.168.1.15:8080</code>).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────
          TAB 2: DNS & UPSTREAMS
      ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'dns' && (
        <div className="space-y-6">
          {/* Configured Upstreams Card */}
          <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Configured Upstream Resolvers</h2>
                <p className="text-xs text-[var(--text)] mt-0.5">DNS-over-HTTPS (DoH) and DNS-over-TLS (DoT) servers handling outbound resolution</p>
              </div>
              <span className="text-xs font-mono text-[var(--muted)]">{dnsInfo?.upstream_dns?.length || 0} active</span>
            </div>

            <div className="space-y-2 mt-3">
              {(dnsInfo?.upstream_dns?.length || 0) === 0 ? (
                <div className="text-xs text-[var(--muted)] py-4 text-center">No upstream DNS servers configured</div>
              ) : (
                dnsInfo!.upstream_dns.map(u => <UpstreamBadge key={u} url={u} />)
              )}
            </div>
          </div>

          {/* Upstream Mode & Caching Parameters */}
          <div className="card bg-[var(--card)] border border-[var(--border)] overflow-hidden">
            <div className="px-4 py-3 bg-[var(--surface-2)] border-b border-[var(--border)]">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Routing Mode &amp; Cache Parameters</h2>
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              <DetailRow
                label="Upstream Query Mode"
                value={dnsInfo?.upstream_mode || 'Parallel'}
                sub="Determines how queries are dispatched across upstream resolvers"
              />
              <DetailRow
                label="DNSSEC Cryptographic Validation"
                value={
                  dnsInfo?.dnssec_enabled ? (
                    <span className="goodtext flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Enabled</span>
                  ) : (
                    <span className="text-[var(--muted)]">Disabled</span>
                  )
                }
                sub="Verifies cryptographic signatures on DNS records to prevent spoofing"
              />
              <DetailRow
                label="Optimistic Caching"
                value={
                  dnsInfo?.cache_optimistic ? (
                    <span className="goodtext flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Enabled</span>
                  ) : (
                    <span className="text-[var(--muted)]">Disabled</span>
                  )
                }
                sub="Returns expired cache entries immediately while refreshing in the background"
              />
              <DetailRow
                label="DNS Cache Size"
                value={dnsInfo?.cache_size ? `${(dnsInfo.cache_size / (1024 * 1024)).toFixed(0)} MB` : 'Default'}
                sub="Allocated memory for fast in-RAM DNS record caching"
              />
              <DetailRow
                label="Cache TTL Range"
                value={`${dnsInfo?.cache_ttl_min || 0}s min / ${dnsInfo?.cache_ttl_max || 86400}s max`}
                sub="Minimum and maximum lifespan constraints for cached responses"
              />
              {dnsInfo?.bootstrap_dns && dnsInfo.bootstrap_dns.length > 0 && (
                <DetailRow
                  label="Bootstrap DNS Resolvers"
                  value={dnsInfo.bootstrap_dns.join(', ')}
                  sub="Used to resolve DoH hostnames before secure connection is established"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────
          TAB 3: FILTERING & SUBSCRIPTIONS
      ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'filters' && (
        <div className="space-y-6">
          {/* Filtering Engine Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
              <div className="text-[10px] uppercase font-semibold text-[var(--muted)]">Filtering Engine</div>
              <div className="text-xl font-bold font-mono mt-1 flex items-center gap-1.5">
                {filtering?.enabled ? (
                  <span className="goodtext flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4 text-[var(--green)]" />
                    <span>Enabled</span>
                  </span>
                ) : (
                  <span className="badtext flex items-center gap-1">
                    <XCircle className="w-4 h-4 text-[var(--red)]" />
                    <span>Disabled</span>
                  </span>
                )}
              </div>
              <div className="text-xs text-[var(--muted)] mt-1">Interception engine operational</div>
            </div>

            <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
              <div className="text-[10px] uppercase font-semibold text-[var(--muted)]">Update Schedule</div>
              <div className="text-xl font-bold font-mono text-[var(--text)] mt-1">
                {filtering?.interval ? `Every ${filtering.interval}h` : 'Manual'}
              </div>
              <div className="text-xs text-[var(--muted)] mt-1">Automatic blocklist refresh interval</div>
            </div>

            <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
              <div className="text-[10px] uppercase font-semibold text-[var(--muted)]">Custom User Rules</div>
              <div className="text-xl font-bold font-mono text-[var(--text)] mt-1">
                {filtering?.user_rules?.length || 0}
              </div>
              <div className="text-xs text-[var(--muted)] mt-1">Custom allow / block rules active</div>
            </div>
          </div>

          {/* Subscribed Blocklists List */}
          <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 border-b border-[var(--border)] gap-2">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Subscribed Filter Blocklists</h2>
                <p className="text-xs text-[var(--text)] mt-0.5">Security feeds protecting your network from ads, trackers, and malicious domains</p>
              </div>

              {/* Search Blocklists */}
              <div className="relative min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted)]" />
                <input
                  type="text"
                  placeholder="Filter lists..."
                  value={listSearch}
                  onChange={e => setListSearch(e.target.value)}
                  className="w-full bg-[var(--surface-2)] border border-[var(--border)] focus:border-[var(--strong-border)] rounded-[7px] pl-8 pr-7 py-1 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-hidden transition-colors"
                />
                {listSearch && (
                  <button
                    onClick={() => setListSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="divide-y divide-[var(--border-subtle)] mt-1">
              {filteredBlocklists.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--muted)]">No filter lists match your search</div>
              ) : (
                filteredBlocklists.map(f => (
                  <div key={f.id} className="py-3 px-2 flex items-center justify-between gap-3 hover:bg-[var(--surface-2)] rounded-lg transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${f.enabled ? 'bg-[var(--green)]' : 'bg-[var(--border)]'}`} />
                      <div className="min-w-0">
                        <div className={`text-xs font-medium truncate ${f.enabled ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>
                          {f.name}
                        </div>
                        <div className="text-[10px] font-mono text-[var(--muted)] truncate mt-0.5">
                          {f.url}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-mono font-semibold text-[var(--text)]">
                        {f.rules_count?.toLocaleString()} rules
                      </span>
                      {f.last_updated && (
                        <span className="text-[10px] font-mono text-[var(--muted)] hidden md:inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(f.last_updated).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────
          TAB 4: SYSTEM & APPEARANCE
      ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'system' && (
        <div className="space-y-6">
          {/* Design System & Appearance */}
          <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
            <div className="pb-3 border-b border-[var(--border)]">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Visual Appearance &amp; Design System</h2>
              <p className="text-xs text-[var(--text)] mt-0.5">High-contrast monochrome dark system with semantic green and red status accents.</p>
            </div>

            <div className="pt-3">
              <div className="p-4 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[var(--surface-3)] border border-[var(--border)] flex items-center justify-center text-[var(--text)] shrink-0">
                    <Moon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[var(--text)]">Monochrome Dark Mode</span>
                      <span className="text-[10px] font-bold text-[var(--green)] px-1.5 py-0.2 rounded bg-[var(--green-bg)] border border-[var(--green)] font-mono">
                        ACTIVE SYSTEM
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--muted)] mt-0.5 font-mono">
                      #090909 pure canvas · #111111 surfaces · #4ADE80 green allowed · #F87171 red blocked
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-mono text-[var(--muted)]">OLED / Dark</span>
                </div>
              </div>
            </div>
          </div>

          {/* System Environment Specification */}
          <div className="card bg-[var(--card)] border border-[var(--border)] overflow-hidden">
            <div className="px-4 py-3 bg-[var(--surface-2)] border-b border-[var(--border)]">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">AdGuard Home System Environment</h2>
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              <DetailRow label="Software Version" value={`v${status?.version ?? '—'}`} />
              <DetailRow label="DNS Listening Port" value={status?.dns_port ?? 53} />
              <DetailRow label="Web Management Port" value={status?.http_port ?? 80} />
              <DetailRow label="Binding IP Addresses" value={status?.dns_addresses?.join(', ') ?? '0.0.0.0'} />
              <DetailRow label="Query Log Status" value={status?.querylog_enabled ? 'Active' : 'Disabled'} />
              <DetailRow label="System Language" value={status?.language ?? 'English'} />
            </div>
          </div>

          {/* Telemetry Retention & Timeframe Policies */}
          <div className="card p-4 bg-[var(--card)] border border-[var(--border)] space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-[var(--text)]" />
                  <span>Telemetry Retention &amp; Timeframe Policies</span>
                </h3>
                <p className="text-xs text-[var(--text)] mt-0.5">
                  Configure statistics accumulation windows independently from raw query log forensic retention.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Setting 1: Statistics Timeframe */}
              <div className="p-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--text)]">Statistics Aggregation Window</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text-2)] border border-[var(--border)]">
                    {statsInterval === 1 ? '24 Hours' : `${statsInterval} Days`}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                  Time window used to compute top requested domains, top blocked clients, and dashboard activity charts.
                </p>
                <div className="flex items-center gap-1.5 pt-1">
                  {[
                    { label: '24 Hours', val: 1 },
                    { label: '7 Days', val: 7 },
                    { label: '30 Days', val: 30 },
                    { label: '90 Days', val: 90 },
                  ].map(opt => (
                    <button
                      key={opt.val}
                      type="button"
                      disabled={updatingStatsInterval}
                      onClick={() => handleUpdateStatsInterval(opt.val)}
                      className={`flex-1 py-1.5 px-1.5 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer text-center ${
                        statsInterval === opt.val
                          ? 'bg-[var(--fg)] text-[var(--bg)] font-bold shadow-xs'
                          : 'bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)] border border-[var(--border)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Setting 2: Query Log Retention */}
              <div className="p-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--text)]">Query Log Forensic Retention</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--green-bg)] text-[var(--green)] border border-[var(--green)]/30 font-semibold">
                    {querylogInterval} Days
                  </span>
                </div>
                <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                  How long raw DNS queries are stored in AdGuard Home for real-time investigation and search.
                </p>
                <div className="flex items-center gap-1.5 pt-1">
                  {[
                    { label: '24 Hours', val: 1 },
                    { label: '7 Days', val: 7 },
                    { label: '30 Days', val: 30 },
                    { label: '90 Days', val: 90 },
                  ].map(opt => (
                    <button
                      key={opt.val}
                      type="button"
                      disabled={updatingQuerylogInterval}
                      onClick={() => handleUpdateQuerylogInterval(opt.val)}
                      className={`flex-1 py-1.5 px-1.5 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer text-center ${
                        querylogInterval === opt.val
                          ? 'bg-[var(--fg)] text-[var(--bg)] font-bold shadow-xs'
                          : 'bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)] border border-[var(--border)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex items-start gap-2 text-xs text-[var(--text-2)]">
              <CheckCircle2 className="w-4 h-4 text-[var(--green)] shrink-0 mt-0.5" />
              <span className="leading-relaxed">
                <strong>Completely Independent:</strong> Setting your statistics window to 24 Hours or 7 Days gives you clean, immediate daily dashboard charts while your Query Log preserves all 90 days of queries.
              </span>
            </div>
          </div>

          {/* Full Disaster Recovery & Backup / Restore */}
          <div className="card p-4 bg-[var(--card)] border border-[var(--border)] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1.5">
                  <Archive className="w-4 h-4 text-[var(--text)]" />
                  <span>Disaster Recovery &amp; Configuration Backup</span>
                </h3>
                <p className="text-xs text-[var(--text)] mt-0.5">
                  Export or restore all user firewall rules, blocked services, security engine states, and multi-server nodes.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelected}
                  accept=".json"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="secondary-btn text-xs"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Restore from JSON</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportFullBackup}
                  className="primary-btn text-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Full Backup</span>
                </button>
              </div>
            </div>
          </div>

          {/* System Diagnostics & Configuration Export */}
          <div className="card p-4 bg-[var(--card)] border border-[var(--border)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Diagnostics &amp; Configuration Export</h3>
                <p className="text-xs text-[var(--text)] mt-0.5">Download full JSON diagnostic telemetry or copy specs to clipboard</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyDiagnostics}
                  className="secondary-btn text-xs"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Specs</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportDiagnostics}
                  className="secondary-btn text-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export JSON</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 5: AI INTELLIGENCE & COPILOT ─────────────────────────────────── */}
      {activeTab === 'intelligence' && (
        <div className="pt-1">
          <AIReport />
        </div>
      )}

      {/* ── Restore Backup Confirmation Modal ── */}
      {restoreModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--strong-border)] rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[var(--green-bg)] border border-[var(--green)]/30 flex items-center justify-center text-[var(--green)] shrink-0">
                  <Archive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text)]">Restore Configuration Backup</h3>
                  <p className="text-[11px] text-[var(--muted)]">Apply settings to active AdGuard node</p>
                </div>
              </div>
              <button
                onClick={() => setRestoreModalData(null)}
                className="text-[var(--muted)] hover:text-[var(--text)] text-sm p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              Found the following parameters in your backup file:
            </p>

            <div className="p-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] space-y-2 text-xs font-mono">
              <div className="flex justify-between items-center">
                <span className="text-[var(--muted)]">Custom User Rules:</span>
                <span className="font-bold text-[var(--text)]">
                  {restoreModalData.userRules?.length ?? 0} rules
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--muted)]">Blocked Services:</span>
                <span className="font-bold text-[var(--text)]">
                  {restoreModalData.blockedServices?.length ?? 0} signatures
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--muted)]">Security Policies:</span>
                <span className="font-bold text-[var(--green)]">
                  {restoreModalData.securityPolicies ? 'Present' : 'Not configured'}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-[var(--muted)] leading-relaxed">
              Applying will merge and overwrite current rules on your AdGuard Home node.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRestoreModalData(null)}
                className="secondary-btn text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                disabled={restoring}
                className="primary-btn text-xs font-bold"
              >
                {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>{restoring ? 'Applying…' : 'Confirm & Restore'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
