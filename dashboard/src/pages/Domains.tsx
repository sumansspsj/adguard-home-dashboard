import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getStats,
  blockDomain,
  unblockDomain,
  checkHost,
  isDnsBlocked,
  type AghStats,
  type CheckHostResult
} from '../api'
import StatCard from '../components/StatCard'
import Section from '../components/Section'
import FaviconDomain from '../components/FaviconDomain'
import DomainDrawer from '../components/DomainDrawer'
import { useToast } from '../contexts/ToastContext'
import { useServer } from '../contexts/ServerContext'
import { ListSkeleton } from '../components/Skeleton'
import {
  Download, ShieldOff, Shield, Search, RefreshCw,
  Globe, Copy, Check, ChevronRight, ArrowUpDown,
  Sparkles, X, MapPin, Compass, ShieldAlert
} from 'lucide-react'
import { exportDomains } from '../utils/export'
import { usePageTitle } from '../hooks/usePageTitle'

function flattenTop(arr: Record<string, number>[] | undefined, n = 50): [string, number][] {
  if (!arr || !arr.length) return []
  return arr.flatMap(o => Object.entries(o) as [string, number][]).slice(0, n)
}

function getDomainTld(domain: string): string {
  const parts = domain.split('.')
  if (parts.length <= 1) return ''
  return '.' + parts.slice(-2).join('.')
}

// ── Geographic & Country Destination Intelligence Engine ─────────────────────
interface DomainGeoInfo {
  code: string
  country: string
  flag: string
  region: string
  org: string
  isLocal: boolean
}

function getDomainGeo(domain: string): DomainGeoInfo {
  if (!domain || typeof domain !== 'string') {
    return { code: 'GL', country: 'Global / Other', flag: '🌐', region: 'Global Internet', org: 'General Web', isLocal: false }
  }

  const d = domain.toLowerCase().trim()

  // 1. Local Network / Private Intranet (LAN)
  if (
    d.endsWith('.local') ||
    d.endsWith('.localdomain') ||
    d.endsWith('.lan') ||
    d.endsWith('.home') ||
    d.endsWith('.internal') ||
    d.endsWith('.corp') ||
    d === 'localhost' ||
    d.startsWith('wpad.') ||
    d.startsWith('router.')
  ) {
    return {
      code: 'LAN',
      country: 'Local Intranet (LAN)',
      flag: '🏠',
      region: 'Private Home Network',
      org: 'Local Router & Devices',
      isLocal: true,
    }
  }

  // 2. ccTLD Country Matching
  if (d.endsWith('.in') || d.includes('.co.in') || d.includes('.gov.in') || d.includes('.nic.in')) {
    return { code: 'IN', country: 'India', flag: '🇮🇳', region: 'Asia-Pacific', org: 'India Digital / ccTLD', isLocal: false }
  }
  if (d.endsWith('.uk') || d.endsWith('.co.uk') || d.endsWith('.org.uk')) {
    return { code: 'GB', country: 'United Kingdom', flag: '🇬🇧', region: 'Europe', org: 'Nominet UK', isLocal: false }
  }
  if (d.endsWith('.de')) {
    return { code: 'DE', country: 'Germany', flag: '🇩🇪', region: 'European Union (GDPR)', org: 'DENIC Germany', isLocal: false }
  }
  if (d.endsWith('.fr')) {
    return { code: 'FR', country: 'France', flag: '🇫🇷', region: 'European Union (GDPR)', org: 'AFNIC France', isLocal: false }
  }
  if (d.endsWith('.jp') || d.endsWith('.co.jp')) {
    return { code: 'JP', country: 'Japan', flag: '🇯🇵', region: 'Asia-Pacific', org: 'JPRS Japan', isLocal: false }
  }
  if (d.endsWith('.cn') || d.endsWith('.com.cn')) {
    return { code: 'CN', country: 'China', flag: '🇨🇳', region: 'Asia-Pacific', org: 'CNNIC China', isLocal: false }
  }
  if (d.endsWith('.ru')) {
    return { code: 'RU', country: 'Russia', flag: '🇷🇺', region: 'Eurasia', org: 'Russian Registry', isLocal: false }
  }
  if (d.endsWith('.ca')) {
    return { code: 'CA', country: 'Canada', flag: '🇨🇦', region: 'North America', org: 'CIRA Canada', isLocal: false }
  }
  if (d.endsWith('.au') || d.endsWith('.com.au')) {
    return { code: 'AU', country: 'Australia', flag: '🇦🇺', region: 'Oceania', org: 'auDA Australia', isLocal: false }
  }
  if (d.endsWith('.sg') || d.endsWith('.com.sg')) {
    return { code: 'SG', country: 'Singapore', flag: '🇸🇬', region: 'Asia-Pacific', org: 'SGNIC Singapore', isLocal: false }
  }
  if (d.endsWith('.nl')) {
    return { code: 'NL', country: 'Netherlands', flag: '🇳🇱', region: 'European Union (GDPR)', org: 'SIDN Netherlands', isLocal: false }
  }
  if (d.endsWith('.ie')) {
    return { code: 'IE', country: 'Ireland', flag: '🇮🇪', region: 'European Union (GDPR)', org: 'IEDR Ireland', isLocal: false }
  }
  if (d.endsWith('.se')) {
    return { code: 'SE', country: 'Sweden', flag: '🇸🇪', region: 'European Union (GDPR)', org: 'Swedish Registry', isLocal: false }
  }
  if (d.endsWith('.ch')) {
    return { code: 'CH', country: 'Switzerland', flag: '🇨🇭', region: 'Europe (Non-EU)', org: 'SWITCH Switzerland', isLocal: false }
  }
  if (d.endsWith('.br') || d.endsWith('.com.br')) {
    return { code: 'BR', country: 'Brazil', flag: '🇧🇷', region: 'South America', org: 'NIC.br', isLocal: false }
  }
  if (d.endsWith('.kr') || d.endsWith('.co.kr')) {
    return { code: 'KR', country: 'South Korea', flag: '🇰🇷', region: 'Asia-Pacific', org: 'KISA Korea', isLocal: false }
  }
  if (d.endsWith('.eu')) {
    return { code: 'EU', country: 'European Union', flag: '🇪🇺', region: 'European Union (GDPR)', org: 'EURid', isLocal: false }
  }

  // 3. Known Global Tech & CDN Infrastructure (where traffic terminates)
  if (d.includes('spotify') || d.includes('scdn.co')) {
    return { code: 'SE', country: 'Sweden', flag: '🇸🇪', region: 'European Union (GDPR)', org: 'Spotify AB', isLocal: false }
  }
  if (d.includes('telegram') || d.includes('t.me')) {
    return { code: 'DE', country: 'Germany', flag: '🇩🇪', region: 'European Union (GDPR)', org: 'Telegram EU (DE)', isLocal: false }
  }
  if (d.includes('tiktok') || d.includes('bytedance') || d.includes('byteoversea')) {
    return { code: 'SG', country: 'Singapore', flag: '🇸🇬', region: 'Asia-Pacific', org: 'ByteDance (Singapore)', isLocal: false }
  }
  if (d.includes('ovh.') || d.includes('ovhcloud')) {
    return { code: 'FR', country: 'France', flag: '🇫🇷', region: 'European Union (GDPR)', org: 'OVHcloud France', isLocal: false }
  }
  if (d.includes('hetzner')) {
    return { code: 'DE', country: 'Germany', flag: '🇩🇪', region: 'European Union (GDPR)', org: 'Hetzner Online Germany', isLocal: false }
  }
  if (
    d.includes('hotstar') || d.includes('jio.') || d.includes('airtel.') ||
    d.includes('flipkart') || d.includes('zerodha') || d.includes('swiggy') ||
    d.includes('zomato') || d.includes('razorpay') || d.includes('paytm')
  ) {
    return { code: 'IN', country: 'India', flag: '🇮🇳', region: 'Asia-Pacific', org: 'India Tech Ecosystem', isLocal: false }
  }

  // Major US Platforms & Hyperscale Infrastructure
  if (d.includes('google') || d.includes('gstatic') || d.includes('gvt1') || d.includes('googleapis') || d.includes('youtube') || d.includes('ggpht') || d.includes('android')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'Google Cloud (US)', isLocal: false }
  }
  if (d.includes('openai') || d.includes('chatgpt')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'OpenAI (US)', isLocal: false }
  }
  if (d.includes('apple') || d.includes('icloud') || d.includes('mzstatic') || d.includes('aaplimg')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'Apple Inc. (US)', isLocal: false }
  }
  if (d.includes('microsoft') || d.includes('azure') || d.includes('windows') || d.includes('live.com') || d.includes('bing') || d.includes('office') || d.includes('skype')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'Microsoft Redmond (US)', isLocal: false }
  }
  if (d.includes('amazon') || d.includes('amazonaws') || d.includes('cloudfront')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'Amazon AWS (US)', isLocal: false }
  }
  if (d.includes('cloudflare')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'Global Anycast Edge', org: 'Cloudflare (US Anycast)', isLocal: false }
  }
  if (d.includes('facebook') || d.includes('instagram') || d.includes('whatsapp') || d.includes('fbcdn') || d.includes('meta.com')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'Meta Platforms (US)', isLocal: false }
  }
  if (d.includes('tradingview')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'TradingView (US AWS)', isLocal: false }
  }
  if (d.includes('datadog') || d.includes('datadoghq')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'Datadog Cloud (US)', isLocal: false }
  }
  if (d.includes('sentry.io') || d.includes('sentry')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'Sentry Ingest (US)', isLocal: false }
  }
  if (d.includes('segment.io') || d.includes('segment.com')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'Twilio Segment (US)', isLocal: false }
  }
  if (d.includes('adobe') || d.includes('adobedc')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'Adobe Systems (US)', isLocal: false }
  }
  if (d.includes('launchdarkly')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'LaunchDarkly (US)', isLocal: false }
  }
  if (d.includes('github')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'GitHub / Microsoft (US)', isLocal: false }
  }
  if (d.includes('twitter') || d.includes('x.com') || d.includes('twimg')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'X Corp (US)', isLocal: false }
  }
  if (d.includes('brave.com') || d.includes('bravesoftware')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'Brave Software (US)', isLocal: false }
  }
  if (d.includes('netflix') || d.includes('nflxvideo')) {
    return { code: 'US', country: 'United States', flag: '🇺🇸', region: 'North America', org: 'Netflix CDN (US)', isLocal: false }
  }

  // Default fallback for general domains
  return {
    code: 'US',
    country: 'United States',
    flag: '🇺🇸',
    region: 'North America / Global Web',
    org: 'Global Web / US Origin',
    isLocal: false,
  }
}

export default function DomainsPage() {
  usePageTitle('Domains')
  const [stats, setStats] = useState<AghStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedDomain, setSelectedDomain] = useState<{ domain: string; blocked: boolean; count: number } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'allowed' | 'blocked'>('all')
  const [viewMode, setViewMode] = useState<'split' | 'table'>('split')
  const [sortBy, setSortBy] = useState<'volume' | 'alpha'>('volume')
  const [copiedDomain, setCopiedDomain] = useState<string | null>(null)

  // Top-Level Modern Page Tabs
  const [domainSection, setDomainSection] = useState<'directory' | 'country_destinations' | 'threats' | 'rule_tester'>('directory')

  // Country Filter Focus
  const [countryFilter, setCountryFilter] = useState<string | null>(null)

  // Live Rule Diagnostics / Test Input
  const [diagnosticInput, setDiagnosticInput] = useState('')
  const [diagnosticResult, setDiagnosticResult] = useState<CheckHostResult | null>(null)
  const [diagnosticLoading, setDiagnosticLoading] = useState(false)
  const [diagnosticTestedHost, setDiagnosticTestedHost] = useState('')

  const { toast } = useToast()
  const { serverVersion } = useServer()
  const navigate = useNavigate()

  const load = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    getStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => {
        setLoading(false)
        setRefreshing(false)
      })
  }, [])

  useEffect(() => {
    let isMounted = true
    getStats()
      .then(s => {
        if (isMounted) setStats(s)
      })
      .catch(console.error)
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    const interval = setInterval(() => {
      if (!document.hidden) {
        getStats()
          .then(s => {
            if (isMounted) setStats(s)
          })
          .catch(() => {})
      }
    }, 10_000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [serverVersion])

  const topQueried = useMemo(() => stats ? flattenTop(stats.top_queried_domains, 50) : [], [stats])
  const topBlocked = useMemo(() => stats ? flattenTop(stats.top_blocked_domains, 50) : [], [stats])
  const blockedSet = useMemo(() => new Set(topBlocked.map(([d]) => d)), [topBlocked])

  const maxQueried = topQueried[0]?.[1] || 1
  const maxBlocked = topBlocked[0]?.[1] || 1

  // Unified list of all unique domains
  const unifiedDomains = useMemo(() => {
    const map = new Map<string, { domain: string; count: number; blocked: boolean }>()

    topQueried.forEach(([d, count]) => {
      map.set(d, { domain: d, count, blocked: blockedSet.has(d) })
    })

    topBlocked.forEach(([d, count]) => {
      const existing = map.get(d)
      if (existing) {
        existing.blocked = true
        existing.count = Math.max(existing.count, count)
      } else {
        map.set(d, { domain: d, count, blocked: true })
      }
    })

    let list = Array.from(map.values())

    // Country Focus Filter
    if (countryFilter) {
      list = list.filter(item => getDomainGeo(item.domain).code === countryFilter)
    }

    // Tab filter
    if (activeTab === 'allowed') {
      list = list.filter(item => !item.blocked)
    } else if (activeTab === 'blocked') {
      list = list.filter(item => item.blocked)
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(item => item.domain.toLowerCase().includes(q))
    }

    // Sorting
    if (sortBy === 'volume') {
      list.sort((a, b) => b.count - a.count)
    } else {
      list.sort((a, b) => a.domain.localeCompare(b.domain))
    }

    return list
  }, [topQueried, topBlocked, blockedSet, activeTab, searchQuery, sortBy, countryFilter])

  // Split view filtered lists
  const filteredQueried = useMemo(() => {
    let list = topQueried
    if (countryFilter) {
      list = list.filter(([d]) => getDomainGeo(d).code === countryFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(([d]) => d.toLowerCase().includes(q))
    }
    if (sortBy === 'alpha') {
      list = [...list].sort((a, b) => a[0].localeCompare(b[0]))
    }
    return list
  }, [topQueried, searchQuery, sortBy, countryFilter])

  const filteredBlocked = useMemo(() => {
    let list = topBlocked
    if (countryFilter) {
      list = list.filter(([d]) => getDomainGeo(d).code === countryFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(([d]) => d.toLowerCase().includes(q))
    }
    if (sortBy === 'alpha') {
      list = [...list].sort((a, b) => a[0].localeCompare(b[0]))
    }
    return list
  }, [topBlocked, searchQuery, sortBy, countryFilter])

  // ── Country Destination Intelligence Aggregations ───────────────────────────
  const countryBreakdown = useMemo(() => {
    const map = new Map<string, {
      code: string
      country: string
      flag: string
      region: string
      orgs: Set<string>
      totalQueries: number
      allowedQueries: number
      blockedQueries: number
      domains: Set<string>
    }>()

    let grandTotal = 0

    // Combine queried and blocked domains to compute geographical terminating destination
    const allDomainEntries: [string, number, boolean][] = [
      ...topQueried.map(([d, c]): [string, number, boolean] => [d, c, blockedSet.has(d)]),
      ...topBlocked.filter(([d]) => !topQueried.some(([qd]) => qd === d)).map(([d, c]): [string, number, boolean] => [d, c, true])
    ]

    allDomainEntries.forEach(([domain, count, isBlocked]) => {
      const geo = getDomainGeo(domain)
      grandTotal += count

      if (!map.has(geo.code)) {
        map.set(geo.code, {
          code: geo.code,
          country: geo.country,
          flag: geo.flag,
          region: geo.region,
          orgs: new Set([geo.org]),
          totalQueries: 0,
          allowedQueries: 0,
          blockedQueries: 0,
          domains: new Set([domain]),
        })
      }

      const entry = map.get(geo.code)!
      entry.totalQueries += count
      if (isBlocked) {
        entry.blockedQueries += count
      } else {
        entry.allowedQueries += count
      }
      entry.orgs.add(geo.org)
      entry.domains.add(domain)
    })

    return Array.from(map.values())
      .map(entry => ({
        ...entry,
        sharePct: grandTotal > 0 ? Math.round((entry.totalQueries / grandTotal) * 1000) / 10 : 0,
        orgsList: Array.from(entry.orgs).slice(0, 3).join(', '),
        topDomainsList: Array.from(entry.domains).slice(0, 6),
      }))
      .sort((a, b) => b.totalQueries - a.totalQueries)
  }, [topQueried, topBlocked, blockedSet])

  // Top destination country
  const topCountry = countryBreakdown[0]

  // Top offender & KPIs
  const topOffender = topBlocked[0]
  const totalQueriedHits = topQueried.reduce((sum, [, c]) => sum + c, 0)
  const totalBlockedHits = topBlocked.reduce((sum, [, c]) => sum + c, 0)
  const topBlockRatio = totalQueriedHits + totalBlockedHits > 0
    ? Math.round((totalBlockedHits / (totalQueriedHits + totalBlockedHits)) * 100)
    : 0

  // Top-Level Domains Breakdown
  const tldBreakdown = useMemo(() => {
    const map: Record<string, number> = {}
    let total = 0
    unifiedDomains.forEach(item => {
      const tld = getDomainTld(item.domain) || '.other'
      map[tld] = (map[tld] || 0) + item.count
      total += item.count
    })
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tld, count]) => ({
        tld,
        count,
        pct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      }))
  }, [unifiedDomains])

  const handleBlock = async (domain: string) => {
    try {
      await blockDomain(domain)
      toast(`${domain} blocked`, {
        type: 'success',
        sub: 'Filter rule added to user rules',
        undoFn: () => handleUnblock(domain)
      })
      if (selectedDomain?.domain === domain) {
        setSelectedDomain(prev => prev ? { ...prev, blocked: true } : null)
      }
      load(true)
    } catch {
      toast('Failed to block domain', { type: 'error' })
    }
  }

  const handleUnblock = async (domain: string) => {
    try {
      await unblockDomain(domain)
      toast(`${domain} whitelisted`, {
        type: 'success',
        sub: 'Filter rule removed from user rules',
        undoFn: () => handleBlock(domain)
      })
      if (selectedDomain?.domain === domain) {
        setSelectedDomain(prev => prev ? { ...prev, blocked: false } : null)
      }
      load(true)
    } catch {
      toast('Failed to unblock domain', { type: 'error' })
    }
  }

  const handleCopy = (domain: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(domain).then(() => {
      setCopiedDomain(domain)
      setTimeout(() => setCopiedDomain(null), 1200)
    })
  }

  // Quick host rule tester
  const handleTestDiagnostic = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const target = diagnosticInput.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
    if (!target) return
    setDiagnosticLoading(true)
    try {
      const res = await checkHost(target)
      setDiagnosticResult(res)
      setDiagnosticTestedHost(target)
    } catch {
      toast('Failed to test domain against filter engine', { type: 'error' })
    } finally {
      setDiagnosticLoading(false)
    }
  }

  return (
    <div className="space-y-6 text-[var(--text)]">
      {/* ── Page Heading (Desktop) ── */}
      <section className="page-heading hidden sm:flex">
        <div>
          <h1>Domain Intelligence &amp; Destinations</h1>
          <div className="subtitle">
            Endpoint directory, geographic data destinations, whitelist/blocklist policies &amp; live rule diagnostics.
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Quick Search Input */}
          <div className="relative min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted)]" />
            <input
              type="text"
              placeholder="Search domains or TLDs..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-[var(--surface-2)] border border-[var(--border)] focus:border-[var(--strong-border)] rounded-[9px] pl-9 pr-8 py-1.5 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-hidden transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Export Dropdown */}
          <button
            onClick={() => exportDomains(topQueried, 'queried')}
            className="secondary-btn"
            title="Download domain telemetry"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          {/* Refresh */}
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="icon-btn"
            title="Refresh domains data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </section>

      {/* ── Mobile Native Controller (X-Style) ── */}
      <div className="sm:hidden space-y-2.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted)]" />
          <input
            type="text"
            placeholder="Search domain or TLD..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-[var(--surface-2)] border border-[var(--border)] focus:border-[var(--strong-border)] rounded-full pl-9 pr-8 py-2 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-hidden transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 3-pill quick mobile metrics */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-left">
            <div className="text-[10px] uppercase font-semibold text-[var(--muted)]">Unique</div>
            <div className="text-xs font-mono font-bold text-[var(--text)] truncate">
              {unifiedDomains.length}
            </div>
          </div>
          <div className="p-2 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-left">
            <div className="text-[10px] uppercase font-semibold text-[var(--red)] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
              Threats
            </div>
            <div className="text-xs font-mono font-bold text-[var(--red)] truncate">
              {topBlocked.length}
            </div>
          </div>
          <div className="p-2 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-left">
            <div className="text-[10px] uppercase font-semibold text-[var(--green)] flex items-center gap-1">
              <span>{topCountry?.flag || '🌐'}</span>
              Dest
            </div>
            <div className="text-xs font-mono font-bold text-[var(--green)] truncate">
              {topCountry?.country ? topCountry.country.split(' ')[0] : 'US'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Executive KPI Cards (Desktop) ── */}
      <section className="metrics hidden sm:grid grid-cols-2 lg:grid-cols-5 gap-3.5" aria-label="Domain directory key metrics">
        <StatCard
          label="Unique Endpoints"
          value={unifiedDomains.length}
          sub={`${totalQueriedHits.toLocaleString()} lookups sampled`}
          icon={<Globe className="w-3.5 h-3.5" />}
          loading={loading}
        />
        <StatCard
          label="Clean Traffic"
          value={totalQueriedHits.toLocaleString()}
          sub="Resolved without filters"
          icon={<Check className="w-3.5 h-3.5 text-[var(--green)]" />}
          accent="good"
          loading={loading}
        />
        <StatCard
          label="Blocked Threats"
          value={totalBlockedHits.toLocaleString()}
          sub={`${topBlockRatio}% of top lookups`}
          icon={<Shield className="w-3.5 h-3.5 text-[var(--red)]" />}
          accent="bad"
          loading={loading}
        />
        <StatCard
          label="Top Data Destination"
          value={topCountry ? `${topCountry.flag} ${topCountry.country.split(' ')[0]}` : '🇺🇸 United States'}
          sub={topCountry ? `${topCountry.sharePct}% of total network queries` : '85% US-bound traffic'}
          icon={<MapPin className="w-3.5 h-3.5 text-[var(--green)]" />}
          accent="good"
          loading={loading}
          onClick={() => {
            setDomainSection('country_destinations')
          }}
        />
        <StatCard
          label="Top Threat Offender"
          value={topOffender ? (topOffender[0].length > 18 ? topOffender[0].slice(0, 16) + '…' : topOffender[0]) : 'None'}
          sub={topOffender ? `${topOffender[1].toLocaleString()} hits intercepted` : 'Zero threats'}
          icon={<ShieldOff className="w-3.5 h-3.5 text-[var(--red)]" />}
          accent="bad"
          loading={loading}
          onClick={() => topOffender && setSelectedDomain({ domain: topOffender[0], blocked: true, count: topOffender[1] })}
        />
      </section>

      {/* ── Modern Navigation Tabs Bar ────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] pb-1 overflow-x-auto scrollbar-none" role="tablist" aria-label="Domain intelligence sections">
        <button
          role="tab"
          aria-selected={domainSection === 'directory'}
          onClick={() => setDomainSection('directory')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            domainSection === 'directory'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Globe className="w-3.5 h-3.5 text-[var(--text-primary)]" />
          <span>Domain Directory</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-mono">
            {unifiedDomains.length}
          </span>
        </button>

        <button
          role="tab"
          aria-selected={domainSection === 'country_destinations'}
          onClick={() => setDomainSection('country_destinations')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            domainSection === 'country_destinations'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Compass className="w-3.5 h-3.5 text-[var(--green)]" />
          <span>Country Destinations</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--green-bg)] text-[var(--green)] border border-[color-mix(in_srgb,var(--green)_30%,var(--border))] font-mono font-semibold">
            {topCountry?.flag || '🌐'} {countryBreakdown.length} Countries
          </span>
        </button>

        <button
          role="tab"
          aria-selected={domainSection === 'threats'}
          onClick={() => setDomainSection('threats')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            domainSection === 'threats'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5 text-[var(--red)]" />
          <span>Blocked Threats</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--red-bg)] text-[var(--red)] border border-[color-mix(in_srgb,var(--red)_30%,var(--border))] font-mono font-semibold">
            {topBlocked.length} Blocked
          </span>
        </button>

        <button
          role="tab"
          aria-selected={domainSection === 'rule_tester'}
          onClick={() => setDomainSection('rule_tester')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            domainSection === 'rule_tester'
              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-xs'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-[var(--text-primary)]" />
          <span>Rule Diagnostic Sandbox</span>
        </button>
      </div>

      {/* ── Active Country Filter Notification (if filtered) ── */}
      {countryFilter && (
        <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-3 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-[var(--green)]" />
            <span>
              Filtering domains terminating in <strong>{countryBreakdown.find(c => c.code === countryFilter)?.flag} {countryBreakdown.find(c => c.code === countryFilter)?.country}</strong>
            </span>
          </div>
          <button
            onClick={() => setCountryFilter(null)}
            className="secondary-btn !min-h-[26px] !text-[11px] !py-0.5 !px-2 font-medium cursor-pointer"
          >
            Clear Country Filter
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 1: DOMAIN DIRECTORY ─────────────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {domainSection === 'directory' && (
        <div className="space-y-4">
          {/* Controls Bar: Filter pills, sort, view toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-[var(--muted)] mr-1">Filter:</span>
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  activeTab === 'all'
                    ? 'bg-[var(--button-bg)] text-[var(--button-text)] font-semibold'
                    : 'bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)]'
                }`}
              >
                All ({unifiedDomains.length})
              </button>
              <button
                onClick={() => setActiveTab('allowed')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'allowed'
                    ? 'bg-[var(--green-bg)] text-[var(--green)] border border-[color-mix(in_srgb,var(--green)_30%,var(--border))] font-semibold'
                    : 'bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)]'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
                <span>Allowed Only</span>
              </button>
              <button
                onClick={() => setActiveTab('blocked')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'blocked'
                    ? 'bg-[var(--red-bg)] text-[var(--red)] border border-[color-mix(in_srgb,var(--red)_30%,var(--border))] font-semibold'
                    : 'bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)]'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                <span>Blocked Threats ({topBlocked.length})</span>
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setSortBy(s => s === 'volume' ? 'alpha' : 'volume')}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--surface-2)] border border-[var(--border)] rounded-lg transition-colors cursor-pointer"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span>{sortBy === 'volume' ? 'Sort: Hits' : 'Sort: A-Z'}</span>
              </button>

              <div className="flex items-center bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-0.5 text-xs">
                <button
                  onClick={() => setViewMode('split')}
                  className={`px-2.5 py-1 rounded-md transition-all font-medium cursor-pointer ${
                    viewMode === 'split' ? 'bg-[var(--bg-active)] text-[var(--text-primary)] font-semibold shadow-xs' : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Comparative
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-2.5 py-1 rounded-md transition-all font-medium cursor-pointer ${
                    viewMode === 'table' ? 'bg-[var(--bg-active)] text-[var(--text-primary)] font-semibold shadow-xs' : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Table View
                </button>
              </div>
            </div>
          </div>

          {/* ── Directory Views ── */}
          {viewMode === 'split' ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Top Queried Domains */}
              <Section
                title="Most Queried Endpoints"
                subtitle={`${filteredQueried.length} lookups ordered by volume`}
                action={
                  <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
                    Peak: {maxQueried.toLocaleString()}
                  </span>
                }
              >
                {loading ? (
                  <ListSkeleton rows={10} />
                ) : (
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {filteredQueried.map(([domain, count], i) => {
                      const isBlocked = blockedSet.has(domain)
                      const geo = getDomainGeo(domain)
                      return (
                        <div
                          key={domain}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-hover)] group transition-colors cursor-pointer"
                          onClick={() => setSelectedDomain({ domain, blocked: isBlocked, count })}
                        >
                          <span className="text-[10.5px] font-mono text-[var(--text-muted)] w-4 shrink-0">{i + 1}</span>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <FaviconDomain
                                domain={domain}
                                blocked={isBlocked}
                                className={`text-xs font-mono ${isBlocked ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)] font-medium'} truncate max-w-[220px]`}
                              />
                              <button
                                onClick={e => handleCopy(domain, e)}
                                className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-opacity p-0.5 cursor-pointer"
                                title="Copy domain"
                              >
                                {copiedDomain === domain ? <Check className="w-3 h-3 text-[var(--green)]" /> : <Copy className="w-3 h-3" />}
                              </button>
                              <span className="text-[10px] select-none" title={`Dest: ${geo.country}`}>
                                {geo.flag}
                              </span>
                            </div>
                            <div className="mt-1 h-1 bg-[var(--surface-3)] rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[var(--text-primary)] opacity-40 transition-all"
                                style={{ width: `${Math.max((count / maxQueried) * 100, 2)}%` }}
                              />
                            </div>
                          </div>

                          <span className="text-xs font-mono shrink-0 tabular-nums text-[var(--text-primary)]">
                            {count.toLocaleString()}
                          </span>

                          <button
                            onClick={e => {
                              e.stopPropagation()
                              if (isBlocked) handleUnblock(domain)
                              else handleBlock(domain)
                            }}
                            aria-label={isBlocked ? `Whitelist ${domain}` : `Block ${domain}`}
                            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                            title={isBlocked ? 'Whitelist domain' : 'Block domain'}
                          >
                            {isBlocked ? <ShieldOff className="w-3.5 h-3.5 text-[var(--red)]" /> : <Shield className="w-3.5 h-3.5 text-[var(--green)]" />}
                          </button>
                        </div>
                      )
                    })}
                    {filteredQueried.length === 0 && (
                      <div className="px-4 py-12 text-center text-xs text-[var(--text-tertiary)]">
                        No domains matching query
                      </div>
                    )}
                  </div>
                )}
              </Section>

              {/* Top Blocked Domains */}
              <Section
                title="Most Filtered Endpoints"
                subtitle={`${filteredBlocked.length} blocked threat endpoints intercepted`}
                action={
                  <span className="text-[10px] font-mono text-[var(--red)]">
                    Peak: {maxBlocked.toLocaleString()}
                  </span>
                }
              >
                {loading ? (
                  <ListSkeleton rows={10} />
                ) : (
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {filteredBlocked.map(([domain, count], i) => {
                      const geo = getDomainGeo(domain)
                      return (
                        <div
                          key={domain}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-hover)] group transition-colors cursor-pointer"
                          onClick={() => setSelectedDomain({ domain, blocked: true, count })}
                        >
                          <span className="text-[10.5px] font-mono text-[var(--text-muted)] w-4 shrink-0">{i + 1}</span>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <FaviconDomain
                                domain={domain}
                                blocked={true}
                                className="text-xs font-mono text-[var(--text-secondary)] truncate max-w-[220px]"
                              />
                              <button
                                onClick={e => handleCopy(domain, e)}
                                className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-opacity p-0.5 cursor-pointer"
                                title="Copy domain"
                              >
                                {copiedDomain === domain ? <Check className="w-3 h-3 text-[var(--green)]" /> : <Copy className="w-3 h-3" />}
                              </button>
                              <span className="text-[10px] select-none" title={`Origin: ${geo.country}`}>
                                {geo.flag}
                              </span>
                            </div>
                            <div className="mt-1 h-1 bg-[var(--surface-3)] rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[var(--red)] opacity-80 transition-all"
                                style={{ width: `${Math.max((count / maxBlocked) * 100, 2)}%` }}
                              />
                            </div>
                          </div>

                          <span className="text-xs font-mono text-[var(--red)] font-medium shrink-0 tabular-nums">
                            {count.toLocaleString()}
                          </span>

                          <button
                            onClick={e => {
                              e.stopPropagation()
                              handleUnblock(domain)
                            }}
                            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                            title="Whitelist domain"
                          >
                            <ShieldOff className="w-3.5 h-3.5 text-[var(--red)]" />
                          </button>
                        </div>
                      )
                    })}
                    {filteredBlocked.length === 0 && (
                      <div className="px-4 py-12 text-center text-xs text-[var(--text-tertiary)]">
                        No blocked domains recorded
                      </div>
                    )}
                  </div>
                )}
              </Section>
            </div>
          ) : (
            /* Unified Table Directory */
            <Section
              title="Unified Domain Directory"
              subtitle={`${unifiedDomains.length} unique network hostnames`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                      <th className="py-2.5 px-4">Domain Endpoint</th>
                      <th className="py-2.5 px-4">Country &amp; Geo</th>
                      <th className="py-2.5 px-4 min-w-[140px]">Volume Share</th>
                      <th className="py-2.5 px-4 text-right">Lookups</th>
                      <th className="py-2.5 px-4 text-center">Status</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {unifiedDomains.map(item => {
                      const sharePct = maxQueried > 0 ? Math.round((item.count / maxQueried) * 100) : 0
                      const geo = getDomainGeo(item.domain)
                      return (
                        <tr
                          key={item.domain}
                          className="hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                          onClick={() => setSelectedDomain(item)}
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <FaviconDomain domain={item.domain} blocked={item.blocked} className="text-xs font-mono font-medium truncate max-w-[260px]" />
                              <button
                                onClick={e => handleCopy(item.domain, e)}
                                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-opacity p-0.5 cursor-pointer"
                                title="Copy"
                              >
                                {copiedDomain === item.domain ? <Check className="w-3 h-3 text-[var(--green)]" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </div>
                          </td>

                          <td className="py-3 px-4 font-mono text-[11px] text-[var(--muted)]">
                            <span className="inline-flex items-center gap-1.5">
                              <span>{geo.flag}</span>
                              <span className="truncate max-w-[120px]">{geo.country}</span>
                            </span>
                          </td>

                          <td className="py-3 px-4">
                            <div className="w-full h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${item.blocked ? 'bg-[var(--red)] opacity-80' : 'bg-[var(--text-primary)] opacity-40'}`}
                                style={{ width: `${Math.max(sharePct, 3)}%` }}
                              />
                            </div>
                          </td>

                          <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-[var(--text-primary)] text-xs">
                            {item.count.toLocaleString()}
                          </td>

                          <td className="py-3 px-4 text-center">
                            <span className={`status ${item.blocked ? 'bad' : 'good'} text-[10px] py-0.5 px-2`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${item.blocked ? 'bg-[var(--red)]' : 'bg-[var(--green)]'}`} />
                              <span>{item.blocked ? 'BLOCKED' : 'ALLOWED'}</span>
                            </span>
                          </td>

                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => item.blocked ? handleUnblock(item.domain) : handleBlock(item.domain)}
                                className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
                                title={item.blocked ? 'Whitelist domain' : 'Block domain'}
                              >
                                {item.blocked ? <ShieldOff className="w-3.5 h-3.5 text-[var(--red)]" /> : <Shield className="w-3.5 h-3.5 text-[var(--green)]" />}
                              </button>
                              <button
                                onClick={() => setSelectedDomain(item)}
                                className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] transition-colors cursor-pointer"
                                title="Inspect domain"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 2: COUNTRY & GEO DESTINATIONS (WHERE DATA WENT) ─────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {domainSection === 'country_destinations' && (
        <div className="space-y-4">
          {/* Executive Geographic Overview Banner */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-[var(--green)]" />
                  <h3 className="text-sm font-bold text-[var(--text)]">
                    Network Traffic Geographic Routing Audit
                  </h3>
                </div>
                <p className="text-xs text-[var(--muted)] mt-1 max-w-2xl leading-relaxed">
                  Based on DNS resolution endpoints and authoritative autonomous systems, this telemetry reveals which geographic jurisdictions your network requests terminating in.
                </p>
              </div>

              {topCountry && (
                <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl px-3.5 py-2 flex items-center gap-2.5">
                  <span className="text-2xl select-none">{topCountry.flag}</span>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Primary Destination</div>
                    <div className="font-bold text-xs text-[var(--text)]">{topCountry.country} ({topCountry.sharePct}%)</div>
                  </div>
                </div>
              )}
            </div>

            {/* Split Progress Bar of Top Destinations */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
                <span>Top Traffic Destinations:</span>
                <span>{countryBreakdown.length} unique countries / regions identified</span>
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden flex bg-[var(--surface-2)]">
                {countryBreakdown.slice(0, 5).map((c, idx) => {
                  const colors = ['var(--green)', 'var(--text-primary)', 'var(--text-secondary)', 'var(--muted)', 'var(--border-strong)']
                  return (
                    <div
                      key={c.code}
                      style={{ width: `${Math.max(c.sharePct, 2)}%`, backgroundColor: colors[idx % colors.length] }}
                      title={`${c.country}: ${c.totalQueries.toLocaleString()} queries (${c.sharePct}%)`}
                      className="h-full transition-all"
                    />
                  )
                })}
              </div>
            </div>
          </div>

          {/* Country Destination Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {countryBreakdown.map((c, i) => (
              <div
                key={c.code}
                className={`bg-[var(--surface)] border rounded-xl p-4 space-y-3 transition-all ${
                  countryFilter === c.code ? 'border-[var(--green)] shadow-md' : 'border-[var(--border)] hover:border-[var(--strong-border)]'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl select-none">{c.flag}</span>
                    <div>
                      <div className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                        <span>{c.country}</span>
                        {i === 0 && (
                          <span className="status good text-[9px] py-0 px-1.5 font-bold uppercase tracking-wider">
                            #1 Top
                          </span>
                        )}
                      </div>
                      <div className="text-[10.5px] text-[var(--muted)] font-mono">{c.region}</div>
                    </div>
                  </div>

                  <span className="text-xs font-mono font-bold text-[var(--text)]">
                    {c.sharePct}%
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${i === 0 ? 'bg-[var(--green)]' : 'bg-[var(--text-primary)]'}`}
                    style={{ width: `${Math.max(c.sharePct, 3)}%` }}
                  />
                </div>

                {/* Stats Breakdown: Allowed vs Blocked */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--border-subtle)] text-[11px]">
                  <div>
                    <div className="text-[9.5px] uppercase font-mono text-[var(--muted)]">Allowed</div>
                    <div className="font-mono font-bold text-xs text-[var(--green)]">
                      {c.allowedQueries.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9.5px] uppercase font-mono text-[var(--muted)]">Blocked Threats</div>
                    <div className="font-mono font-bold text-xs text-[var(--red)]">
                      {c.blockedQueries.toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Top Services in this country */}
                <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
                  <div className="text-[10px] text-[var(--muted)] flex items-center justify-between">
                    <span>Key Endpoints:</span>
                    <span className="font-mono">{c.domains.size} hostnames</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {c.topDomainsList.map(d => (
                      <span key={d} className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] truncate max-w-[130px]">
                        {d}
                      </span>
                    ))}
                  </div>
                </div>

                {/* One-click country filter action */}
                <button
                  type="button"
                  onClick={() => {
                    setCountryFilter(c.code === countryFilter ? null : c.code)
                    setDomainSection('directory')
                  }}
                  className="w-full mt-2 secondary-btn !min-h-[30px] !text-[11px] !py-1 text-center justify-center cursor-pointer"
                >
                  {countryFilter === c.code ? 'Viewing Domains' : `Inspect ${c.country} Domains`}
                </button>
              </div>
            ))}
          </div>

          {/* Top-Level Domains (TLD) Breakdown Grid */}
          <Section
            title="Top-Level Domain (TLD) Distribution"
            subtitle="Breakdown of network requests across web extensions and country-code TLDs"
          >
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              {tldBreakdown.map(item => (
                <div key={item.tld} className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-3 space-y-1">
                  <div className="font-mono text-xs font-bold text-[var(--text)]">{item.tld}</div>
                  <div className="text-base font-mono font-bold text-[var(--text)]">{item.count.toLocaleString()}</div>
                  <div className="text-[10.5px] text-[var(--muted)] font-mono">{item.pct}% volume</div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 3: BLOCKED THREATS & TRACKERS ───────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {domainSection === 'threats' && (
        <div className="space-y-4">
          <Section
            title="Intercepted Threat & Tracking Endpoints"
            subtitle={`${filteredBlocked.length} blocked advertising, telemetry, and tracking endpoints`}
            action={
              <div className="flex items-center gap-2">
                <span className="status bad text-[10px] py-0.5 px-2">
                  {totalBlockedHits.toLocaleString()} threats blocked
                </span>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                    <th className="py-2.5 px-4">Threat Domain</th>
                    <th className="py-2.5 px-4">Country &amp; Geo</th>
                    <th className="py-2.5 px-4 min-w-[140px]">Block Frequency</th>
                    <th className="py-2.5 px-4 text-right">Intercepts</th>
                    <th className="py-2.5 px-4 text-center">Status</th>
                    <th className="py-2.5 px-4 text-right">Whitelist</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {filteredBlocked.map(([domain, count]) => {
                    const sharePct = maxBlocked > 0 ? Math.round((count / maxBlocked) * 100) : 0
                    const geo = getDomainGeo(domain)
                    return (
                      <tr
                        key={domain}
                        className="hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                        onClick={() => setSelectedDomain({ domain, blocked: true, count })}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <FaviconDomain domain={domain} blocked className="text-xs font-mono font-medium truncate max-w-[260px]" />
                            <button
                              onClick={e => handleCopy(domain, e)}
                              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-opacity p-0.5 cursor-pointer"
                              title="Copy"
                            >
                              {copiedDomain === domain ? <Check className="w-3 h-3 text-[var(--green)]" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </td>

                        <td className="py-3 px-4 font-mono text-[11px] text-[var(--muted)]">
                          <span className="inline-flex items-center gap-1.5">
                            <span>{geo.flag}</span>
                            <span className="truncate max-w-[120px]">{geo.country}</span>
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          <div className="w-full h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--red)] opacity-80 transition-all"
                              style={{ width: `${Math.max(sharePct, 3)}%` }}
                            />
                          </div>
                        </td>

                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-[var(--red)] text-xs">
                          {count.toLocaleString()}
                        </td>

                        <td className="py-3 px-4 text-center">
                          <span className="status bad text-[10px] py-0.5 px-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                            <span>BLOCKED</span>
                          </span>
                        </td>

                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              handleUnblock(domain)
                            }}
                            className="secondary-btn !min-h-[28px] !text-[11px] !py-1 !px-2.5 font-medium cursor-pointer"
                            title="Remove from blocklist"
                          >
                            Whitelist
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {filteredBlocked.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-xs text-[var(--muted)]">
                        No blocked domains match your search query.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 4: RULE DIAGNOSTIC SANDBOX ──────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {domainSection === 'rule_tester' && (
        <div className="space-y-4">
          <Section
            title="Live Rule Diagnostics &amp; Sandbox"
            subtitle="Test any domain against your active AdGuard Home filter rules and custom blocklists"
          >
            <div className="p-4 space-y-4">
              <form onSubmit={handleTestDiagnostic} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter hostname or domain to test (e.g. telemetry.example.com)..."
                  value={diagnosticInput}
                  onChange={e => setDiagnosticInput(e.target.value)}
                  className="flex-1 bg-[var(--surface-2)] border border-[var(--border)] focus:border-[var(--strong-border)] rounded-xl px-3.5 py-2 text-xs font-mono text-[var(--text)] placeholder-[var(--muted)] focus:outline-hidden"
                />
                <button
                  type="submit"
                  disabled={diagnosticLoading || !diagnosticInput.trim()}
                  className="primary-btn text-xs py-2 px-4 cursor-pointer disabled:opacity-50"
                >
                  {diagnosticLoading ? 'Testing Host…' : 'Test Rule'}
                </button>
              </form>

              {/* Diagnostic Result Banner */}
              {diagnosticResult && diagnosticTestedHost && (() => {
                const isBlockedHost = isDnsBlocked(diagnosticResult)
                const isRewriteHost = Boolean(diagnosticResult.reason?.startsWith('Rewrite'))
                return (
                  <div className="p-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          isBlockedHost
                            ? 'bg-[var(--red)]'
                            : isRewriteHost
                              ? 'bg-[var(--text-2)]'
                              : 'bg-[var(--green)]'
                        }`} />
                        <span className="font-mono text-sm font-bold text-[var(--text)]">{diagnosticTestedHost}</span>
                        <span className={`status text-[10px] font-mono py-0.5 px-2 font-semibold ${
                          isBlockedHost
                            ? 'bad'
                            : isRewriteHost
                              ? 'text-[var(--text-2)] bg-[var(--surface-3)] border border-[var(--border)]'
                              : 'good'
                        }`}>
                          {isBlockedHost ? 'FILTERED / BLOCKED' : isRewriteHost ? 'REWRITTEN / LOCAL RULE' : 'ALLOWED / NOT FILTERED'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isBlockedHost ? (
                          <button
                            onClick={() => handleUnblock(diagnosticTestedHost)}
                            className="secondary-btn text-xs py-1 px-3 cursor-pointer"
                          >
                            Whitelist Host
                          </button>
                        ) : (
                          <button
                            onClick={() => handleBlock(diagnosticTestedHost)}
                            className="primary-btn text-xs py-1 px-3 cursor-pointer"
                          >
                            Block Host
                          </button>
                        )}
                      </div>
                    </div>

                    {diagnosticResult.rules?.[0]?.text && (
                      <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1">
                        <div className="text-[10.5px] uppercase font-bold text-[var(--muted)]">Matching Rule:</div>
                        <code className="block text-xs font-mono text-[var(--text)] bg-[var(--surface)] p-2 rounded-lg border border-[var(--border)] overflow-x-auto">
                          {diagnosticResult.rules[0].text}
                        </code>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          </Section>
        </div>
      )}

      {/* ── Slide-Out Domain Detail Drawer ── */}
      {selectedDomain && (
        <DomainDrawer
          domain={selectedDomain.domain}
          blocked={selectedDomain.blocked}
          count={selectedDomain.count}
          onClose={() => setSelectedDomain(null)}
          onBlock={handleBlock}
          onUnblock={handleUnblock}
          onViewLive={d => navigate(`/live?search=${encodeURIComponent(d)}`)}
          onViewClient={ip => navigate(`/clients/${encodeURIComponent(ip)}`)}
        />
      )}
    </div>
  )
}
