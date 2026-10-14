import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  type AghStats,
  type BlockedServiceItem,
  type SecurityPolicies,
  type CheckHostResult,
  getStats,
  getBlockedServicesAll,
  getBlockedServicesList,
  updateBlockedServices,
  getSecurityPolicies,
  toggleSafebrowsing,
  toggleParental,
  updateSafeSearch,
  getUserRules,
  addUserRule,
  removeUserRule,
  checkHost,
} from '../api'
import StatCard from '../components/StatCard'
import Section from '../components/Section'
import FaviconDomain from '../components/FaviconDomain'
import DomainsPage from './Domains'
import { useToast } from '../contexts/ToastContext'
import { useServer } from '../contexts/ServerContext'
import { usePageTitle } from '../hooks/usePageTitle'
import {
  Shield, ShieldAlert, ShieldCheck, Bug, Eye, Lock,
  Search, Tv, Gamepad2, MessageSquare, Share2, ShoppingBag,
  Bot, Heart, Dice5, Cloud, Trash2, Plus, ExternalLink,
  RefreshCw, Check, Layers, AlertTriangle, Sliders,
  X, AlertCircle, Globe
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeSvgBase64(base64: string): string {
  try {
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

function ServiceIcon({
  svgBase64,
  isBlocked,
  className = 'w-5 h-5',
}: {
  svgBase64: string
  isBlocked: boolean
  className?: string
}) {
  const svgHtml = useMemo(() => decodeSvgBase64(svgBase64), [svgBase64])

  if (!svgHtml) {
    return <Tv className={`${className} text-[var(--muted)]`} />
  }

  return (
    <div
      className={`${className} flex items-center justify-center shrink-0 [&>svg]:w-full [&>svg]:h-full ${
        isBlocked ? 'text-[var(--red)] font-bold' : 'text-[var(--muted)] group-hover:text-[var(--text)]'
      } transition-colors`}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  )
}

function StudioSwitch({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  variant = 'monochrome',
}: {
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  variant?: 'green' | 'red' | 'monochrome'
}) {
  const isSm = size === 'sm'

  let activeBg = 'bg-[var(--text)]'
  const knobBg = 'bg-[#090909]'

  if (variant === 'green') {
    activeBg = 'bg-[var(--green)]'
  } else if (variant === 'red') {
    activeBg = 'bg-[var(--red)]'
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={e => {
        e.stopPropagation()
        if (!disabled) onChange(!checked)
      }}
      className={`relative inline-flex shrink-0 items-center transition-colors duration-200 ease-in-out cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--focus)] rounded-full ${
        isSm ? 'w-8 h-4.5' : 'w-10 h-5.5'
      } ${
        checked
          ? activeBg
          : 'bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--surface-3)]'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span
        className={`pointer-events-none inline-block rounded-full shadow-xs transition-transform duration-200 ease-in-out ${
          isSm ? 'w-3.5 h-3.5' : 'w-4.5 h-4.5'
        } ${
          checked
            ? `${isSm ? 'translate-x-4' : 'translate-x-5'} ${knobBg}`
            : 'translate-x-0.5 bg-[var(--muted)]'
        }`}
      />
    </button>
  )
}

// ── Categories Definition ─────────────────────────────────────────────────────

interface CategoryDef {
  id: string
  label: string
  icon: typeof Tv
  emoji: string
  description: string
}

const CATEGORIES: CategoryDef[] = [
  { id: 'all', label: 'All Services', icon: Layers, emoji: '🌐', description: 'Complete catalog of native blocked service signatures' },
  { id: 'blocked', label: 'Currently Blocked', icon: ShieldAlert, emoji: '🚫', description: 'Services currently actively denied on this network' },
  { id: 'allowed', label: 'Allowed Services', icon: ShieldCheck, emoji: '✓', description: 'Services currently permitted without restriction' },
  { id: 'streaming', label: 'Streaming Video & Audio', icon: Tv, emoji: '🎬', description: 'Netflix, Prime Video, Disney+, YouTube, Spotify, Twitch' },
  { id: 'gaming', label: 'Gaming & Platforms', icon: Gamepad2, emoji: '🎮', description: 'Steam, Epic Games, Roblox, PlayStation, Xbox, Riot' },
  { id: 'social_network', label: 'Social Networks', icon: Share2, emoji: '💬', description: 'TikTok, Instagram, Reddit, X/Twitter, Snapchat, Facebook' },
  { id: 'messenger', label: 'Messaging & Chat', icon: MessageSquare, emoji: '📱', description: 'WhatsApp, Telegram, Discord, Skype, Signal, Zoom' },
  { id: 'ai', label: 'AI Assistants', icon: Bot, emoji: '🤖', description: 'OpenAI (ChatGPT), Claude, Perplexity, Midjourney' },
  { id: 'shopping', label: 'E-Commerce & Shopping', icon: ShoppingBag, emoji: '🛍️', description: 'Amazon, eBay, AliExpress, Shopee, Temu, Shein' },
  { id: 'dating', label: 'Dating & Adult Platforms', icon: Heart, emoji: '🔞', description: 'Tinder, Bumble, Badoo, OnlyFans' },
  { id: 'gambling', label: 'Betting & Gambling', icon: Dice5, emoji: '🎲', description: 'Betfair, Betway, Stake, Betano' },
  { id: 'cloud', label: 'Cloud & Infrastructure', icon: Cloud, emoji: '☁️', description: 'CDNs, Hosting providers, Privacy networks & Software' },
]

interface ThreatItem {
  domain: string
  count: number
  severity: 'high' | 'medium' | 'low'
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SecurityPage() {
  usePageTitle('Security')
  const navigate = useNavigate()
  const { toast } = useToast()
  const { serverVersion } = useServer()

  // Primary data states
  const [stats, setStats] = useState<AghStats | null>(null)
  const [services, setServices] = useState<BlockedServiceItem[]>([])
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set())
  const [policies, setPolicies] = useState<SecurityPolicies | null>(null)
  const [userRules, setUserRules] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Tab & Filter states
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get('tab') as 'services' | 'engines' | 'heuristics' | 'rules' | 'domains' | null
  const [activeTab, setActiveTab] = useState<'services' | 'engines' | 'heuristics' | 'rules' | 'domains'>(
    tabFromUrl && ['services', 'engines', 'heuristics', 'rules', 'domains'].includes(tabFromUrl) ? tabFromUrl : 'services'
  )

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && ['services', 'engines', 'heuristics', 'rules', 'domains'].includes(tab)) {
      setActiveTab(tab as any)
    }
  }, [searchParams])

  const handleTabChange = (tab: 'services' | 'engines' | 'heuristics' | 'rules' | 'domains') => {
    setActiveTab(tab)
    if (tab === 'services') {
      setSearchParams({})
    } else {
      setSearchParams({ tab })
    }
  }

  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [serviceSearch, setServiceSearch] = useState<string>('')
  const [ruleSearch, setRuleSearch] = useState<string>('')
  const [ruleTypeFilter, setRuleTypeFilter] = useState<'all' | 'block' | 'allow' | 'client' | 'comment'>('all')
  const [newRuleText, setNewRuleText] = useState<string>('')
  const [submittingRule, setSubmittingRule] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)

  // Rule & Batch Deletion Confirmation State
  const [ruleToDelete, setRuleToDelete] = useState<string | null>(null)
  const [batchConfirmAction, setBatchConfirmAction] = useState<'block' | 'unblock' | null>(null)

  // Threat & Host Diagnostic Tool State
  const [inspectDomain, setInspectDomain] = useState<string>('')
  const [inspectResult, setInspectResult] = useState<CheckHostResult | null>(null)
  const [inspectLoading, setInspectLoading] = useState<boolean>(false)
  const [showInspector, setShowInspector] = useState<boolean>(false)

  // Initial load
  const loadAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)

    try {
      const [statsData, servicesData, blockedListData, policiesData, rulesData] = await Promise.all([
        getStats().catch(() => null),
        getBlockedServicesAll().catch(() => ({ blocked_services: [], groups: [] })),
        getBlockedServicesList().catch(() => []),
        getSecurityPolicies().catch(() => null),
        getUserRules().catch(() => []),
      ])

      if (statsData) setStats(statsData)
      if (servicesData && servicesData.blocked_services) {
        setServices(servicesData.blocked_services)
      }
      if (Array.isArray(blockedListData)) {
        setBlockedIds(new Set(blockedListData))
      }
      if (policiesData) setPolicies(policiesData)
      if (Array.isArray(rulesData)) setUserRules(rulesData)
    } catch (err) {
      console.error('Failed to load security telemetry', err)
      toast('Failed to load security telemetry', { type: 'error' })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [toast])

  useEffect(() => {
    loadAll(false)

    const interval = setInterval(() => {
      if (!document.hidden && activeTab !== 'domains') {
        Promise.all([
          getStats().catch(() => null),
          getBlockedServicesList().catch(() => []),
          getSecurityPolicies().catch(() => null),
        ])
          .then(([statsData, blockedListData, policiesData]) => {
            if (statsData) setStats(statsData)
            if (Array.isArray(blockedListData)) {
              setBlockedIds(new Set(blockedListData))
            }
            if (policiesData) setPolicies(policiesData)
          })
          .catch(() => {})
      }
    }, 10_000)

    return () => clearInterval(interval)
  }, [serverVersion, loadAll, activeTab])

  // ── Blocked Services Logic ──────────────────────────────────────────────────

  const filteredServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase()
    return services.filter(service => {
      // Category match
      let matchCat = true
      if (selectedCategory === 'blocked') {
        matchCat = blockedIds.has(service.id)
      } else if (selectedCategory === 'allowed') {
        matchCat = !blockedIds.has(service.id)
      } else if (selectedCategory === 'cloud') {
        matchCat = ['cdn', 'hosting', 'privacy', 'software'].includes(service.group_id || '')
      } else if (selectedCategory !== 'all') {
        matchCat = service.group_id === selectedCategory
      }

      if (!matchCat) return false

      // Search match
      if (!q) return true
      return (
        service.name.toLowerCase().includes(q) ||
        service.id.toLowerCase().includes(q) ||
        (service.rules || []).some(r => r.toLowerCase().includes(q))
      )
    })
  }, [services, selectedCategory, serviceSearch, blockedIds])

  // Robust Category Counts
  const categoryCounts = useMemo(() => {
    const blockedInServices = services.filter(s => blockedIds.has(s.id)).length
    const map: Record<string, { total: number; blocked: number }> = {
      all: { total: services.length, blocked: blockedInServices },
      blocked: { total: blockedInServices, blocked: blockedInServices },
      allowed: { total: Math.max(0, services.length - blockedInServices), blocked: 0 },
    }

    CATEGORIES.forEach(c => {
      if (['all', 'blocked', 'allowed'].includes(c.id)) return
      let matching: BlockedServiceItem[] = []
      if (c.id === 'cloud') {
        matching = services.filter(s => ['cdn', 'hosting', 'privacy', 'software'].includes(s.group_id || ''))
      } else {
        matching = services.filter(s => s.group_id === c.id)
      }
      const bCount = matching.filter(s => blockedIds.has(s.id)).length
      map[c.id] = { total: matching.length, blocked: bCount }
    })

    return map
  }, [services, blockedIds])

  // Toggle single service
  const handleToggleService = async (service: BlockedServiceItem) => {
    const isCurrentlyBlocked = blockedIds.has(service.id)
    const prevSet = new Set(blockedIds)
    const nextSet = new Set(blockedIds)

    if (isCurrentlyBlocked) {
      nextSet.delete(service.id)
    } else {
      nextSet.add(service.id)
    }

    // Optimistic update
    setBlockedIds(nextSet)

    try {
      await updateBlockedServices(Array.from(nextSet))
      toast(
        isCurrentlyBlocked
          ? `${service.name} is now permitted`
          : `${service.name} blocked across all network clients`,
        { type: isCurrentlyBlocked ? 'info' : 'success' }
      )
    } catch {
      // Revert on failure
      setBlockedIds(prevSet)
      toast(`Failed to update ${service.name} policy`, { type: 'error' })
    }
  }

  // Batch action for currently filtered services
  const handleBatchServices = async (action: 'block' | 'unblock') => {
    if (filteredServices.length === 0) return
    setBatchLoading(true)

    const prevSet = new Set(blockedIds)
    const nextSet = new Set(blockedIds)
    const affected: string[] = []

    filteredServices.forEach(s => {
      if (action === 'block' && !nextSet.has(s.id)) {
        nextSet.add(s.id)
        affected.push(s.name)
      } else if (action === 'unblock' && nextSet.has(s.id)) {
        nextSet.delete(s.id)
        affected.push(s.name)
      }
    })

    if (affected.length === 0) {
      setBatchLoading(false)
      toast(`All ${filteredServices.length} visible services are already ${action === 'block' ? 'blocked' : 'permitted'}.`, { type: 'info' })
      return
    }

    setBlockedIds(nextSet)

    try {
      await updateBlockedServices(Array.from(nextSet))
      toast(
        action === 'block'
          ? `Blocked ${affected.length} services`
          : `Permitted ${affected.length} services`,
        { type: 'success' }
      )
    } catch {
      setBlockedIds(prevSet)
      toast(`Failed to update services batch`, { type: 'error' })
    } finally {
      setBatchLoading(false)
    }
  }

  // ── Core Engines Logic ──────────────────────────────────────────────────────

  const handleToggleSafebrowsing = async () => {
    if (!policies) return
    const prevPolicies = policies
    const nextState = !policies.safebrowsing.enabled
    setPolicies(prev => prev ? { ...prev, safebrowsing: { enabled: nextState } } : null)

    try {
      await toggleSafebrowsing(nextState)
      toast(nextState ? 'AdGuard SafeBrowsing Cloud Shield enabled' : 'SafeBrowsing disabled', { type: 'success' })
    } catch {
      setPolicies(prevPolicies)
      toast('Failed to update SafeBrowsing status', { type: 'error' })
    }
  }

  const handleToggleParental = async () => {
    if (!policies) return
    const prevPolicies = policies
    const nextState = !policies.parental.enabled
    setPolicies(prev => prev ? { ...prev, parental: { enabled: nextState } } : null)

    try {
      await toggleParental(nextState)
      toast(nextState ? 'Parental Control adult filter enabled' : 'Parental Control disabled', { type: 'success' })
    } catch {
      setPolicies(prevPolicies)
      toast('Failed to update Parental Control', { type: 'error' })
    }
  }

  const handleToggleMasterSafeSearch = async () => {
    if (!policies) return
    const prevPolicies = policies
    const nextState = !policies.safesearch.enabled
    setPolicies(prev => prev ? { ...prev, safesearch: { ...prev.safesearch, enabled: nextState } } : null)

    try {
      await updateSafeSearch({ enabled: nextState })
      toast(nextState ? 'Enforced SafeSearch across search engines' : 'SafeSearch disabled', { type: 'success' })
    } catch {
      setPolicies(prevPolicies)
      toast('Failed to update SafeSearch', { type: 'error' })
    }
  }

  const handleToggleSearchEngine = async (engine: keyof Omit<SecurityPolicies['safesearch'], 'enabled'>) => {
    if (!policies) return
    const prevPolicies = policies
    const current = Boolean(policies.safesearch[engine])
    const nextState = !current

    // Exclude 'enabled' boolean so only engine key-values are sent to /control/safesearch/settings
    const { enabled: _unused, ...currentSettings } = policies.safesearch
    const cleanSettings = {
      ...currentSettings,
      [engine]: nextState,
    }

    setPolicies(prev => prev ? {
      ...prev,
      safesearch: { ...prev.safesearch, [engine]: nextState },
    } : null)

    try {
      await updateSafeSearch({ settings: cleanSettings })
      toast(`Updated SafeSearch for ${engine}`, { type: 'success' })
    } catch {
      setPolicies(prevPolicies)
      toast(`Failed to update ${engine} SafeSearch`, { type: 'error' })
    }
  }

  // ── Threat Heuristics Logic ─────────────────────────────────────────────────

  const topBlocked: ThreatItem[] = useMemo(() => {
    return (stats?.top_blocked_domains || [])
      .flatMap(o => Object.entries(o) as [string, number][])
      .slice(0, 30)
      .map(([domain, count]) => {
        const d = domain.toLowerCase()
        let severity: ThreatItem['severity'] = 'low'
        if (d.includes('doubleclick') || d.includes('malware') || d.includes('phish') || d.includes('track') || d.includes('c2') || d.includes('bot') || d.includes('telemetry')) {
          severity = 'high'
        } else if (d.includes('ad') || d.includes('analytics') || d.includes('metrics')) {
          severity = 'medium'
        }
        return { domain, count, severity }
      })
  }, [stats])

  const highCount = topBlocked.filter(t => t.severity === 'high').length
  const mediumCount = topBlocked.filter(t => t.severity === 'medium').length

  const handleWhitelistDomain = async (domain: string) => {
    const rule = `@@||${domain}^`
    if (userRules.includes(rule)) {
      toast(`${domain} is already whitelisted`, { type: 'info' })
      return
    }

    try {
      await addUserRule(rule)
      setUserRules(prev => [rule, ...prev.filter(r => r !== rule)])
      toast(`Whitelisted ${domain} in custom firewall rules`, { type: 'success' })
    } catch {
      toast(`Failed to whitelist ${domain}`, { type: 'error' })
    }
  }

  // Threat & Host Diagnostic Tool
  const runHostDiagnostics = async (domainToTest?: string) => {
    const target = (domainToTest || inspectDomain).trim()
    if (!target) return

    setInspectDomain(target)
    setInspectLoading(true)
    setShowInspector(true)

    try {
      const data = await checkHost(target)
      setInspectResult(data)
    } catch {
      toast(`Failed to inspect host ${target}`, { type: 'error' })
    } finally {
      setInspectLoading(false)
    }
  }

  // ── Custom Rules Logic ──────────────────────────────────────────────────────

  const filteredRules = useMemo(() => {
    const q = ruleSearch.trim().toLowerCase()
    return userRules.filter(r => {
      // Type filter
      if (ruleTypeFilter === 'block') {
        if (r.startsWith('!') || r.startsWith('#') || r.startsWith('@@')) return false
      } else if (ruleTypeFilter === 'allow') {
        if (!r.startsWith('@@')) return false
      } else if (ruleTypeFilter === 'client') {
        if (!r.includes('$client=')) return false
      } else if (ruleTypeFilter === 'comment') {
        if (!r.startsWith('!') && !r.startsWith('#')) return false
      }

      if (!q) return true
      return r.toLowerCase().includes(q)
    })
  }, [userRules, ruleSearch, ruleTypeFilter])

  const ruleCounts = useMemo(() => {
    let block = 0
    let allow = 0
    let client = 0
    let comment = 0
    userRules.forEach(r => {
      if (r.startsWith('!') || r.startsWith('#')) comment++
      else if (r.startsWith('@@')) allow++
      else block++

      if (r.includes('$client=')) client++
    })
    return { all: userRules.length, block, allow, client, comment }
  }, [userRules])

  const handleAddRule = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const rule = newRuleText.trim()
    if (!rule) return

    if (userRules.includes(rule)) {
      toast('This rule is already in your firewall rules list', { type: 'info' })
      return
    }

    setSubmittingRule(true)
    try {
      await addUserRule(rule)
      setUserRules(prev => [rule, ...prev.filter(r => r !== rule)])
      setNewRuleText('')
      toast('Custom firewall rule added', { type: 'success' })
    } catch {
      toast('Failed to add custom rule', { type: 'error' })
    } finally {
      setSubmittingRule(false)
    }
  }

  const confirmDeleteRule = async () => {
    if (!ruleToDelete) return
    const target = ruleToDelete
    try {
      await removeUserRule(target)
      setUserRules(prev => prev.filter(r => r !== target))
      toast('Rule removed from firewall', { type: 'info' })
    } catch {
      toast('Failed to remove rule', { type: 'error' })
    } finally {
      setRuleToDelete(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const activeCategoryMeta = CATEGORIES.find(c => c.id === selectedCategory) || CATEGORIES[0]

  // Total security policy actions (Malware + Phishing + Parental + SafeSearch)
  const totalPolicyActions = (stats?.num_replaced_safebrowsing ?? 0) +
    (stats?.num_replaced_parental ?? 0) +
    (stats?.num_replaced_safesearch ?? 0)

  return (
    <div className="space-y-6 text-[var(--text)]">
      {/* ── Page Heading matching Monochrome Standard (Desktop) ── */}
      <section className="page-heading hidden sm:flex">
        <div>
          <h1>Security</h1>
          <div className="subtitle">
            Cloud threat shields, granular service blocklists, parental filters & custom DNS firewall.
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Quick status pills with semantic accents */}
          <div className="hidden md:flex items-center gap-2 text-xs">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] border font-mono text-[11px] ${
              policies?.safebrowsing.enabled
                ? 'bg-[var(--green-bg)] border-[var(--green)]/30 text-[var(--green)] font-semibold'
                : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]'
            }`}>
              <Shield className="w-3 h-3" />
              SafeBrowsing {policies?.safebrowsing.enabled ? 'ACTIVE' : 'OFF'}
            </span>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] border font-mono text-[11px] ${
              policies?.safesearch.enabled
                ? 'bg-[var(--green-bg)] border-[var(--green)]/30 text-[var(--green)] font-semibold'
                : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]'
            }`}>
              <Lock className="w-3 h-3" />
              SafeSearch {policies?.safesearch.enabled ? 'ACTIVE' : 'OFF'}
            </span>
          </div>

          <button
            onClick={() => setShowInspector(!showInspector)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
              showInspector
                ? 'bg-[var(--surface-3)] border-[var(--strong-border)] text-[var(--text)]'
                : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text)]'
            }`}
            title="Inspect Domain Policy"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Host Inspector</span>
          </button>

          <button
            onClick={() => loadAll(true)}
            disabled={refreshing}
            className="icon-btn"
            title="Refresh security status"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </section>

      {/* ── Mobile Security Engine Status Bar ── */}
      <div className="sm:hidden space-y-2">
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                policies?.safebrowsing.enabled ? 'bg-[var(--green)]' : 'bg-[var(--muted)]'
              }`}
            />
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--text)] truncate">
              {policies?.safebrowsing.enabled ? 'SafeBrowsing Active' : 'SafeBrowsing Off'}
            </span>
            <span className="text-[11px] text-[var(--muted)] font-mono truncate">
              · {blockedIds.size} blocked
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowInspector(!showInspector)}
              className="p-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] cursor-pointer"
              title="Host Inspector"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => loadAll(true)}
              disabled={refreshing}
              className="p-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* 3-Pill Quick Security Metrics on Mobile */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-left">
            <div className="text-[10px] uppercase font-semibold text-[var(--muted)]">Shield Actions</div>
            <div className="text-xs font-mono font-bold text-[var(--green)] truncate mt-0.5">
              {totalPolicyActions.toLocaleString()}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-left">
            <div className="text-[10px] uppercase font-semibold text-[var(--muted)]">Blocked Svc</div>
            <div className="text-xs font-mono font-bold text-[var(--red)] truncate mt-0.5">
              {blockedIds.size}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-left">
            <div className="text-[10px] uppercase font-semibold text-[var(--muted)]">User Rules</div>
            <div className="text-xs font-mono font-bold text-[var(--text)] truncate mt-0.5">
              {userRules.length}
            </div>
          </div>
        </div>
      </div>

      {/* ── Host & Threat Inspector Card (Expandable) ── */}
      {showInspector && (
        <div className="bg-[var(--surface)] border border-[var(--strong-border)] rounded-xl p-4 space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-[var(--text)]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text)]">
                Domain Threat & Filter Diagnostics
              </h3>
            </div>
            <button
              onClick={() => setShowInspector(false)}
              className="p-1 rounded text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-[var(--text-2)] leading-relaxed">
            Test any domain in real-time against AdGuard Home’s active filter lists, whitelist overrides, SafeBrowsing reputation engine, and rewrites.
          </p>

          <form
            onSubmit={e => {
              e.preventDefault()
              runHostDiagnostics()
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div className="relative flex-1">
              <input
                type="text"
                value={inspectDomain}
                onChange={e => setInspectDomain(e.target.value)}
                placeholder="e.g. doubleclick.net, netflix.com, example.com"
                className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border)] focus:border-[var(--text)] focus:outline-hidden rounded-lg text-xs font-mono text-[var(--text)] placeholder-[var(--muted)] transition-colors"
              />
              {inspectDomain && (
                <button
                  type="button"
                  onClick={() => {
                    setInspectDomain('')
                    setInspectResult(null)
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] text-xs cursor-pointer"
                >
                  ×
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={inspectLoading || !inspectDomain.trim()}
              className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--fg)] text-[var(--bg)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
            >
              <Search className={`w-3.5 h-3.5 ${inspectLoading ? 'animate-spin' : ''}`} />
              <span>Inspect Policy</span>
            </button>
          </form>

          {/* Diagnostic Result Panel */}
          {inspectResult && (
            <div className="p-3.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-[var(--text)] text-sm">{inspectDomain}</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-semibold ${
                    inspectResult.reason === 'FilteredBlackList' || inspectResult.filter_id
                      ? 'bg-[var(--red-bg)] text-[var(--red)] border-[var(--red)]/30'
                      : inspectResult.reason === 'FilteredWhiteList'
                      ? 'bg-[var(--green-bg)] text-[var(--green)] border-[var(--green)]/30'
                      : 'bg-[var(--surface-3)] text-[var(--text-2)] border-[var(--border)]'
                  }`}>
                    {inspectResult.reason || 'UNFILTERED'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleWhitelistDomain(inspectDomain)}
                    className="px-2.5 py-1 rounded bg-[var(--surface-3)] hover:bg-[var(--border)] text-[var(--text)] border border-[var(--border)] text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    + Whitelist Domain
                  </button>
                  <button
                    onClick={() => navigate(`/live-dns?search=${encodeURIComponent(inspectDomain)}`)}
                    className="px-2.5 py-1 rounded bg-[var(--surface-3)] hover:bg-[var(--border)] text-[var(--text)] border border-[var(--border)] text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <span>View in Live DNS</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {inspectResult.rule && (
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-2)] pt-1">
                  <span className="text-[var(--muted)]">Matching Rule:</span>
                  <code className="px-1.5 py-0.5 rounded bg-[var(--surface-3)] border border-[var(--border)] text-[var(--text)] font-mono">
                    {inspectResult.rule}
                  </code>
                  {inspectResult.filter_id > 0 && (
                    <span className="text-[var(--muted)] text-[10px]">
                      (Filter list ID #{inspectResult.filter_id})
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Executive KPI Cards (Desktop & Tablet) ── */}
      <section className="metrics hidden sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-3.5" aria-label="Security key metrics">
        <StatCard
          label="DNS Filter Blocks"
          value={stats?.num_blocked_filtering ?? 0}
          sub="Threats & ads blocked by firewall"
          icon={<ShieldAlert className="w-3.5 h-3.5 text-[var(--red)]" />}
          loading={loading}
        />
        <StatCard
          label="Cloud Shields Active"
          value={totalPolicyActions}
          sub="SafeBrowsing + SafeSearch + Parental"
          icon={<ShieldCheck className="w-3.5 h-3.5 text-[var(--green)]" />}
          loading={loading}
        />
        <StatCard
          label="Blocked Services"
          value={`${blockedIds.size} / ${services.length || 139}`}
          sub={`${Math.round(((blockedIds.size) / (services.length || 139)) * 100)}% signatures restricted`}
          icon={<Shield className="w-3.5 h-3.5 text-[var(--red)]" />}
          loading={loading}
        />
        <StatCard
          label="Custom User Rules"
          value={userRules.length}
          sub="Active domain inspection rules"
          icon={<Sliders className="w-3.5 h-3.5 text-[var(--text)]" />}
          loading={loading}
        />
      </section>

      {/* ── Navigation Tab Bar ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] pb-1 overflow-x-auto scrollbar-none">
        <button
          onClick={() => handleTabChange('services')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'services'
              ? 'bg-[var(--surface-3)] text-[var(--text)] border border-[var(--strong-border)] shadow-xs font-semibold'
              : 'text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5 text-[var(--text)]" />
          <span>Blocked Services</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] font-mono">
            {blockedIds.size} / {services.length}
          </span>
        </button>

        <button
          onClick={() => handleTabChange('engines')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'engines'
              ? 'bg-[var(--surface-3)] text-[var(--text)] border border-[var(--strong-border)] shadow-xs font-semibold'
              : 'text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--text)]" />
          <span>Core Security Engines</span>
          <span className={`w-2 h-2 rounded-full ${
            policies?.safebrowsing.enabled || policies?.safesearch.enabled
              ? 'bg-[var(--green)]'
              : 'bg-[var(--muted)]'
          }`} />
        </button>

        <button
          onClick={() => handleTabChange('rules')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'rules'
              ? 'bg-[var(--surface-3)] text-[var(--text)] border border-[var(--strong-border)] shadow-xs font-semibold'
              : 'text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <Sliders className="w-3.5 h-3.5 text-[var(--text)]" />
          <span>DNS Firewall Rules</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] font-mono">
            {userRules.length}
          </span>
        </button>

        <button
          onClick={() => handleTabChange('domains')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'domains'
              ? 'bg-[var(--surface-3)] text-[var(--text)] border border-[var(--strong-border)] shadow-xs font-semibold'
              : 'text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <Globe className="w-3.5 h-3.5 text-[var(--text)]" />
          <span>Domain Destinations & Geo</span>
        </button>

        <button
          onClick={() => handleTabChange('heuristics')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'heuristics'
              ? 'bg-[var(--surface-3)] text-[var(--text)] border border-[var(--strong-border)] shadow-xs font-semibold'
              : 'text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-[var(--text)]" />
          <span>Threat Intelligence</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] font-mono">
            {topBlocked.length}
          </span>
        </button>
      </div>

      {/* ── TAB 1: BLOCKED SERVICES ─────────────────────────────────────────── */}
      {activeTab === 'services' && (
        <div className="space-y-4">
          {/* Category Filter Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 scrollbar-none">
            {CATEGORIES.map(cat => {
              const countMeta = categoryCounts[cat.id] || { total: 0, blocked: 0 }
              const isSelected = selectedCategory === cat.id

              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer shrink-0 border ${
                    isSelected
                      ? 'bg-[var(--surface-3)] border-[var(--strong-border)] text-[var(--text)] shadow-xs'
                      : 'bg-[var(--card)] border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text)] hover:border-[var(--strong-border)]'
                  }`}
                >
                  <span className="text-xs">{cat.emoji}</span>
                  <span>{cat.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    isSelected
                      ? 'bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)]'
                      : countMeta.blocked > 0
                        ? 'bg-[var(--red-bg)] text-[var(--red)] border border-[var(--red)]/30 font-semibold'
                        : 'bg-[var(--surface-2)] text-[var(--muted)]'
                  }`}>
                    {countMeta.blocked > 0 ? `${countMeta.blocked}/${countMeta.total}` : countMeta.total}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Search Bar & Category Controls Bar */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Category Info */}
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-sm shrink-0 mt-0.5">
                  {activeCategoryMeta.emoji}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-[var(--text)] tracking-tight">
                      {activeCategoryMeta.label}
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.2 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)]">
                      {filteredServices.length} {filteredServices.length === 1 ? 'service' : 'services'}
                    </span>
                    {categoryCounts[selectedCategory]?.blocked > 0 && (
                      <span className="text-[11px] font-mono px-2 py-0.2 rounded-full bg-[var(--red-bg)] text-[var(--red)] border border-[var(--red)]/30 font-semibold">
                        {categoryCounts[selectedCategory]?.blocked} blocked
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-2)] mt-0.5">
                    {activeCategoryMeta.description}
                  </p>
                </div>
              </div>

              {/* Batch Actions & Search */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Search Input */}
                <div className="relative min-w-[200px] flex-1 sm:flex-none">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    type="text"
                    value={serviceSearch}
                    onChange={e => setServiceSearch(e.target.value)}
                    placeholder="Search Netflix, Steam, TikTok..."
                    className="w-full pl-8 pr-7 py-1.5 bg-[var(--bg)] border border-[var(--border)] focus:border-[var(--text)] focus:outline-hidden rounded-lg text-xs text-[var(--text)] placeholder-[var(--muted)] transition-colors"
                  />
                  {serviceSearch && (
                    <button
                      onClick={() => setServiceSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)]"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Batch Block / Allow Buttons */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setBatchConfirmAction('block')}
                    disabled={batchLoading || filteredServices.length === 0}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--red-bg)] hover:bg-[var(--red)] hover:text-black text-[var(--red)] border border-[var(--red)]/30 text-xs font-semibold transition-all cursor-pointer disabled:opacity-40"
                    title="Block all visible services"
                  >
                    <ShieldAlert className="w-3 h-3" />
                    <span>Block All</span>
                  </button>
                  <button
                    onClick={() => setBatchConfirmAction('unblock')}
                    disabled={batchLoading || filteredServices.length === 0}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--green-bg)] hover:bg-[var(--green)] hover:text-black text-[var(--green)] border border-[var(--green)]/30 text-xs font-semibold transition-all cursor-pointer disabled:opacity-40"
                    title="Allow all visible services"
                  >
                    <Check className="w-3 h-3" />
                    <span>Allow All</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Services Grid */}
          {loading ? (
            <div className="py-20 text-center text-xs text-[var(--muted)] flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-[var(--text-2)]" />
              <span>Loading service signatures…</span>
            </div>
          ) : filteredServices.length === 0 ? (
            <div className="py-16 text-center text-xs text-[var(--text-2)] bg-[var(--card)] border border-[var(--border)] rounded-xl p-8">
              <ShieldCheck className="w-8 h-8 text-[var(--muted)] mx-auto mb-2" />
              <div className="text-[var(--text)] font-medium text-sm">No services match your filter</div>
              <div className="text-[var(--muted)] mt-1">Try clearing your search query or selecting another category.</div>
              {serviceSearch && (
                <button
                  onClick={() => setServiceSearch('')}
                  className="mt-3 px-3 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text)] border border-[var(--border)] text-xs transition-colors cursor-pointer"
                >
                  Clear Search
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredServices.map(service => {
                const isBlocked = blockedIds.has(service.id)
                const ruleCount = service.rules?.length || 0

                return (
                  <div
                    key={service.id}
                    onClick={() => handleToggleService(service)}
                    className={`group relative border rounded-xl p-3.5 transition-all cursor-pointer flex flex-col justify-between ${
                      isBlocked
                        ? 'border-[var(--red)]/30 bg-[var(--card)] shadow-xs'
                        : 'bg-[var(--card)] border-[var(--border)] hover:border-[var(--strong-border)]'
                    }`}
                  >
                    <div>
                      {/* Top Row: Icon + Name + Switch */}
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-colors ${
                            isBlocked
                              ? 'bg-[var(--red-bg)] border-[var(--red)]/30'
                              : 'bg-[var(--surface-2)] border-[var(--border)] group-hover:border-[var(--strong-border)]'
                          }`}>
                            <ServiceIcon svgBase64={service.icon_svg} isBlocked={isBlocked} className="w-4.5 h-4.5" />
                          </div>

                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[var(--text)] tracking-tight truncate">
                              {service.name}
                            </div>
                            <div className="text-[10px] text-[var(--muted)] capitalize truncate mt-0.5">
                              {service.group_id?.replace('_', ' ') || 'Service'}
                            </div>
                          </div>
                        </div>

                        {/* Switch with Red accent when blocked */}
                        <StudioSwitch
                          checked={isBlocked}
                          onChange={() => handleToggleService(service)}
                          size="sm"
                          variant="red"
                        />
                      </div>

                      {/* Rules domain preview */}
                      <div className="mt-2.5 pt-2 border-t border-[var(--border)] flex items-center justify-between text-[10px] text-[var(--muted)]">
                        <span className="font-mono truncate max-w-[140px]" title={service.rules?.join(', ')}>
                          {service.rules?.[0]?.replace(/[|\\^]/g, '') || service.id}
                        </span>
                        {ruleCount > 1 && (
                          <span className="shrink-0 text-[var(--text-2)] font-mono">
                            +{ruleCount - 1} domains
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Bottom Status pill with Semantic Accent */}
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className={`text-[10px] font-medium font-mono px-2 py-0.5 rounded-full border ${
                        isBlocked
                          ? 'bg-[var(--red-bg)] text-[var(--red)] border-[var(--red)]/30 font-semibold'
                          : 'bg-[var(--surface-2)] text-[var(--text-2)] border-[var(--border)]'
                      }`}>
                        {isBlocked ? 'BLOCKED / DENIED' : 'PERMITTED'}
                      </span>

                      <span className="text-[10px] text-[var(--muted)] group-hover:text-[var(--text)] transition-colors">
                        Click to toggle
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: CORE SECURITY ENGINES ────────────────────────────────────── */}
      {activeTab === 'engines' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* SafeBrowsing Card */}
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                    policies?.safebrowsing.enabled
                      ? 'bg-[var(--green-bg)] border-[var(--green)]/30 text-[var(--green)]'
                      : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]'
                  }`}>
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-[var(--text)]">AdGuard SafeBrowsing Cloud</h3>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                        policies?.safebrowsing.enabled
                          ? 'bg-[var(--green-bg)] text-[var(--green)] border-[var(--green)]/30 font-semibold'
                          : 'bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]'
                      }`}>
                        {policies?.safebrowsing.enabled ? 'ACTIVE' : 'DISABLED'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-2)] mt-1 leading-relaxed">
                      AdGuard Cloud reputation engine. Intercepts phishing scams, malware distribution infrastructure, ransomware command servers, and fraudulent sites in real-time.
                    </p>
                  </div>
                </div>

                <StudioSwitch
                  checked={Boolean(policies?.safebrowsing.enabled)}
                  onChange={handleToggleSafebrowsing}
                  variant="green"
                />
              </div>

              <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-3 flex items-center justify-between text-xs">
                <span className="text-[var(--text-2)]">Total Neutralized Threats</span>
                <span className="font-mono font-semibold text-[var(--green)]">
                  {stats?.num_replaced_safebrowsing?.toLocaleString() ?? 0}
                </span>
              </div>
            </div>

            {/* Parental Control Card */}
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                    policies?.parental.enabled
                      ? 'bg-[var(--green-bg)] border-[var(--green)]/30 text-[var(--green)]'
                      : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]'
                  }`}>
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-[var(--text)]">Parental Adult Content Filter</h3>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                        policies?.parental.enabled
                          ? 'bg-[var(--green-bg)] text-[var(--green)] border-[var(--green)]/30 font-semibold'
                          : 'bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]'
                      }`}>
                        {policies?.parental.enabled ? 'ACTIVE' : 'DISABLED'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-2)] mt-1 leading-relaxed">
                      Blocks access to adult entertainment, sexually explicit, and restricted media networks. Provides family-friendly protection across all network endpoints.
                    </p>
                  </div>
                </div>

                <StudioSwitch
                  checked={Boolean(policies?.parental.enabled)}
                  onChange={handleToggleParental}
                  variant="green"
                />
              </div>

              <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-3 flex items-center justify-between text-xs">
                <span className="text-[var(--text-2)]">Parental Filter Invocations</span>
                <span className="font-mono font-semibold text-[var(--text)]">
                  {stats?.num_replaced_parental?.toLocaleString() ?? 0}
                </span>
              </div>
            </div>
          </div>

          {/* SafeSearch Card & Engine Matrix */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                  policies?.safesearch.enabled
                    ? 'bg-[var(--green-bg)] border-[var(--green)]/30 text-[var(--green)]'
                    : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]'
                }`}>
                  <Eye className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-[var(--text)]">Multi-Engine SafeSearch Enforcement</h3>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                      policies?.safesearch.enabled
                        ? 'bg-[var(--green-bg)] text-[var(--green)] border-[var(--green)]/30 font-semibold'
                        : 'bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]'
                    }`}>
                      {policies?.safesearch.enabled ? 'ACTIVE' : 'DISABLED'}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-2)] mt-1 leading-relaxed">
                    Forces strict SafeSearch query flags and YouTube Restricted Mode directly at the DNS protocol layer. Search results with adult content are sanitized before reaching clients.
                  </p>
                </div>
              </div>

              <StudioSwitch
                checked={Boolean(policies?.safesearch.enabled)}
                onChange={handleToggleMasterSafeSearch}
                variant="green"
              />
            </div>

            {/* Individual search engines switches */}
            <div>
              <div className="text-xs font-semibold text-[var(--text-2)] mb-2.5">
                Configured Search Engine Interceptors
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {[
                  { id: 'google', name: 'Google SafeSearch', desc: 'Forces safe=active' },
                  { id: 'youtube', name: 'YouTube Restricted Mode', desc: 'Strict family mode' },
                  { id: 'bing', name: 'Bing SafeSearch', desc: 'Strict content filter' },
                  { id: 'duckduckgo', name: 'DuckDuckGo Strict', desc: 'Safe search level 1' },
                  { id: 'ecosia', name: 'Ecosia SafeSearch', desc: 'Enforces safe filter' },
                  { id: 'pixabay', name: 'Pixabay Images', desc: 'Safeguard image results' },
                  { id: 'yandex', name: 'Yandex Family', desc: 'Family search mode' },
                ].map(engine => {
                  const key = engine.id as keyof Omit<SecurityPolicies['safesearch'], 'enabled'>
                  const isEngineActive = Boolean(policies?.safesearch[key])

                  return (
                    <div
                      key={engine.id}
                      onClick={() => handleToggleSearchEngine(key)}
                      className={`p-3 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
                        isEngineActive
                          ? 'bg-[var(--surface-2)] border-[var(--strong-border)]'
                          : 'bg-[var(--card)] border-[var(--border)] opacity-60'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-medium text-[var(--text)]">{engine.name}</div>
                        <div className="text-[10px] text-[var(--muted)]">{engine.desc}</div>
                      </div>
                      <StudioSwitch
                        checked={isEngineActive}
                        onChange={() => handleToggleSearchEngine(key)}
                        size="sm"
                        variant="green"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: THREAT INTELLIGENCE & HEURISTICS ──────────────────────────── */}
      {activeTab === 'heuristics' && (
        <div className="space-y-4">
          {/* Severity summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="border border-[var(--red)]/30 bg-[var(--card)] rounded-xl p-4 shadow-xs">
              <div className="text-[11px] font-semibold text-[var(--red)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>High Risk Interceptions</span>
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[var(--red)]">{highCount}</div>
              <div className="text-[11px] text-[var(--muted)] mt-1">Phishing, Malware, Botnet C2</div>
            </div>

            <div className="border border-[var(--border)] bg-[var(--card)] rounded-xl p-4 shadow-xs">
              <div className="text-[11px] font-semibold text-[var(--text-2)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Medium Risk Trackers</span>
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[var(--text)]">{mediumCount}</div>
              <div className="text-[11px] text-[var(--muted)] mt-1">Telemetry & Profilers</div>
            </div>

            <div className="border border-[var(--border)] bg-[var(--card)] rounded-xl p-4 shadow-xs">
              <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Bug className="w-3.5 h-3.5" />
                <span>Low Risk Ad Endpoints</span>
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[var(--text-2)]">
                {Math.max(0, topBlocked.length - highCount - mediumCount)}
              </div>
              <div className="text-[11px] text-[var(--muted)] mt-1">Standard Advertising Networks</div>
            </div>
          </div>

          {/* Threat List Table */}
          <Section
            title="Active Filter Interceptions"
            subtitle="Heuristically analyzed from recent network DNS logs"
            action={
              <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <AlertTriangle className="w-3.5 h-3.5 text-[var(--text)]" />
                <span>Real-time Telemetry</span>
              </div>
            }
          >
            <div>
              {/* Table header for desktop */}
              <div className="hidden sm:grid grid-cols-12 gap-x-4 px-4 py-2.5 bg-[var(--surface-2)] border-b border-[var(--border)] text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                <div className="col-span-1">Risk</div>
                <div className="col-span-6">Target Domain</div>
                <div className="col-span-2 text-right">Block Hits</div>
                <div className="col-span-3 text-right">Actions</div>
              </div>

              {loading ? (
                <div className="py-16 text-center text-xs text-[var(--muted)]">Loading threats…</div>
              ) : topBlocked.length === 0 ? (
                <div className="py-16 text-center text-xs text-[var(--muted)]">
                  No blocked threats recorded in current telemetry window.
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {topBlocked.map(({ domain, count, severity }) => (
                    <div
                      key={domain}
                      className="flex flex-col sm:grid sm:grid-cols-12 gap-2 sm:gap-x-4 px-4 py-3 hover:bg-[var(--surface-2)] items-start sm:items-center transition-colors text-xs"
                    >
                      {/* Risk Dot & Badge */}
                      <div className="col-span-1 flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          severity === 'high'
                            ? 'bg-[var(--red)]'
                            : severity === 'medium'
                            ? 'bg-[var(--text-2)]'
                            : 'bg-[var(--muted)]'
                        }`} />
                        <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded border font-semibold ${
                          severity === 'high'
                            ? 'bg-[var(--red-bg)] text-[var(--red)] border-[var(--red)]/30'
                            : severity === 'medium'
                            ? 'bg-[var(--surface-3)] text-[var(--text-2)] border-[var(--border)]'
                            : 'bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]'
                        }`}>
                          {severity.toUpperCase()}
                        </span>
                      </div>

                      {/* Domain */}
                      <div className="col-span-6 min-w-0 w-full">
                        <FaviconDomain domain={domain} blocked className="text-xs font-mono text-[var(--text)] truncate" />
                      </div>

                      {/* Hits Count */}
                      <div className="col-span-2 sm:text-right flex items-center sm:justify-end gap-1 text-xs font-mono text-[var(--text)] font-semibold">
                        <span className="sm:hidden text-[10px] text-[var(--muted)] uppercase font-sans">Hits:</span>
                        <span>{count.toLocaleString()}</span>
                      </div>

                      {/* Actions */}
                      <div className="col-span-3 flex items-center sm:justify-end gap-1.5 w-full sm:w-auto pt-1 sm:pt-0">
                        <button
                          onClick={() => runHostDiagnostics(domain)}
                          title="Inspect domain policy"
                          className="px-2 py-1 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)] border border-[var(--border)] text-[10px] font-medium transition-colors cursor-pointer"
                        >
                          Inspect
                        </button>
                        <button
                          onClick={() => handleWhitelistDomain(domain)}
                          title="Whitelist domain"
                          className="px-2 py-1 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)] border border-[var(--border)] text-[10px] font-medium transition-colors cursor-pointer"
                        >
                          Whitelist
                        </button>
                        <button
                          onClick={() => navigate(`/live-dns?search=${encodeURIComponent(domain)}`)}
                          title="Inspect in Live DNS"
                          className="p-1 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)] border border-[var(--border)] transition-colors cursor-pointer"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>
        </div>
      )}

      {/* ── TAB 4: CUSTOM DNS FIREWALL RULES ────────────────────────────────── */}
      {activeTab === 'rules' && (
        <div className="space-y-4">
          {/* Add Rule Card */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-[var(--text)] tracking-tight">Add Custom Filtering Rule</h3>
                <p className="text-[11px] text-[var(--text-2)] mt-0.5">
                  AdGuard / Adblock syntax supported. E.g. <code className="text-[var(--text)] bg-[var(--surface-2)] px-1 rounded font-mono">||domain.com^</code> or <code className="text-[var(--text)] bg-[var(--surface-2)] px-1 rounded font-mono">@@||domain.com^</code>
                </p>
              </div>

              {/* Preset Chips */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setNewRuleText('||example.com^')}
                  className="px-2 py-1 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)] border border-[var(--border)] text-[10px] font-mono transition-colors cursor-pointer"
                >
                  + Block
                </button>
                <button
                  type="button"
                  onClick={() => setNewRuleText('@@||example.com^')}
                  className="px-2 py-1 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)] border border-[var(--border)] text-[10px] font-mono transition-colors cursor-pointer"
                >
                  + Whitelist
                </button>
                <button
                  type="button"
                  onClick={() => setNewRuleText('||example.com^$client=192.168.1.15')}
                  className="px-2 py-1 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)] border border-[var(--border)] text-[10px] font-mono transition-colors cursor-pointer"
                >
                  + Per-Client
                </button>
                <button
                  type="button"
                  onClick={() => setNewRuleText('! Note: custom rule')}
                  className="px-2 py-1 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)] border border-[var(--border)] text-[10px] font-mono transition-colors cursor-pointer"
                >
                  + Comment
                </button>
              </div>
            </div>

            <form onSubmit={handleAddRule} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={newRuleText}
                onChange={e => setNewRuleText(e.target.value)}
                placeholder="Enter rule syntax e.g. ||tracking-api.com^"
                className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] focus:border-[var(--text)] focus:outline-hidden rounded-lg text-xs font-mono text-[var(--text)] placeholder-[var(--muted)] transition-colors"
              />
              <button
                type="submit"
                disabled={submittingRule || !newRuleText.trim()}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--fg)] text-[var(--bg)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Rule</span>
              </button>
            </form>
          </div>

          {/* Rules List Controls & Type Filter Chips */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Type filter chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-1 md:pb-0">
                {[
                  { id: 'all', label: 'All Rules', count: ruleCounts.all },
                  { id: 'block', label: 'Block Rules', count: ruleCounts.block },
                  { id: 'allow', label: 'Allow / Whitelist', count: ruleCounts.allow },
                  { id: 'client', label: 'Per-Client', count: ruleCounts.client },
                  { id: 'comment', label: 'Comments', count: ruleCounts.comment },
                ].map(chip => (
                  <button
                    key={chip.id}
                    onClick={() => setRuleTypeFilter(chip.id as typeof ruleTypeFilter)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer border whitespace-nowrap flex items-center gap-1.5 ${
                      ruleTypeFilter === chip.id
                        ? 'bg-[var(--surface-3)] border-[var(--strong-border)] text-[var(--text)]'
                        : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text)]'
                    }`}
                  >
                    <span>{chip.label}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[var(--bg)] border border-[var(--border)] text-[var(--text-2)]">
                      {chip.count}
                    </span>
                  </button>
                ))}
              </div>

              {/* Search input */}
              <div className="relative min-w-[200px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type="text"
                  value={ruleSearch}
                  onChange={e => setRuleSearch(e.target.value)}
                  placeholder="Filter rules..."
                  className="w-full pl-8 pr-7 py-1.5 bg-[var(--bg)] border border-[var(--border)] focus:border-[var(--text)] focus:outline-hidden rounded-lg text-xs text-[var(--text)] placeholder-[var(--muted)] transition-colors"
                />
                {ruleSearch && (
                  <button
                    onClick={() => setRuleSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Rules Table / Cards */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="hidden sm:grid grid-cols-12 gap-x-4 px-4 py-2.5 bg-[var(--surface-2)] border-b border-[var(--border)] text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
              <div className="col-span-1">#</div>
              <div className="col-span-2">Type</div>
              <div className="col-span-8">Rule Expression</div>
              <div className="col-span-1 text-right">Action</div>
            </div>

            {filteredRules.length === 0 ? (
              <div className="py-14 text-center text-xs text-[var(--muted)]">
                No user rules match your search or filter.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)] max-h-[600px] overflow-y-auto">
                {filteredRules.map((rule, idx) => {
                  const isComment = rule.startsWith('!') || rule.startsWith('#')
                  const isWhitelist = rule.startsWith('@@')
                  const isClientRule = rule.includes('$client=')

                  return (
                    <div
                      key={`${rule}-${idx}`}
                      className="flex flex-col sm:grid sm:grid-cols-12 gap-1.5 sm:gap-x-4 px-4 py-2.5 hover:bg-[var(--surface-2)] items-start sm:items-center text-xs transition-colors"
                    >
                      {/* Index */}
                      <div className="col-span-1 font-mono text-[var(--muted)] text-[11px] hidden sm:block">
                        {idx + 1}
                      </div>

                      {/* Type Badge */}
                      <div className="col-span-2">
                        {isComment ? (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--surface-2)] text-[var(--muted)] border border-[var(--border)]">
                            COMMENT
                          </span>
                        ) : isWhitelist ? (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--green-bg)] text-[var(--green)] border border-[var(--green)]/30 font-semibold">
                            ALLOW
                          </span>
                        ) : isClientRule ? (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text-2)] border border-[var(--border)]">
                            CLIENT
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--red-bg)] text-[var(--red)] border border-[var(--red)]/30 font-semibold">
                            BLOCK
                          </span>
                        )}
                      </div>

                      {/* Expression */}
                      <div className="col-span-8 min-w-0 w-full">
                        <span className={`font-mono text-xs break-all ${
                          isComment ? 'text-[var(--muted)] italic' : 'text-[var(--text)]'
                        }`}>
                          {rule}
                        </span>
                      </div>

                      {/* Delete Action with Confirmation */}
                      <div className="col-span-1 flex items-center justify-end w-full sm:w-auto pt-1 sm:pt-0">
                        <button
                          onClick={() => setRuleToDelete(rule)}
                          title="Delete rule"
                          className="p-1.5 rounded text-[var(--muted)] hover:text-[var(--red)] hover:bg-[var(--surface-3)] transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 5: DOMAIN DESTINATIONS & GEO INTELLIGENCE ───────────────────── */}
      {activeTab === 'domains' && (
        <div className="pt-1">
          <DomainsPage />
        </div>
      )}

      {/* ── Rule Deletion Confirmation Dialog ── */}
      {ruleToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--strong-border)] rounded-xl p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-[var(--red)]">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <h3 className="text-sm font-semibold text-[var(--text)]">Delete Firewall Rule</h3>
              </div>
              <button
                onClick={() => setRuleToDelete(null)}
                className="text-[var(--muted)] hover:text-[var(--text)] text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              Are you sure you want to permanently delete this rule from your DNS firewall?
            </p>

            <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] font-mono text-xs text-[var(--text)] break-all">
              {ruleToDelete}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRuleToDelete(null)}
                className="px-3 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text)] border border-[var(--border)] text-xs font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteRule}
                className="px-3.5 py-1.5 rounded-lg bg-[var(--red-bg)] hover:bg-[var(--red)] hover:text-black text-[var(--red)] border border-[var(--red)]/30 text-xs font-semibold transition-all cursor-pointer"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Batch Services Action Confirmation Dialog ── */}
      {batchConfirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--strong-border)] rounded-xl p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-[var(--red)]">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <h3 className="text-sm font-semibold text-[var(--text)]">
                  {batchConfirmAction === 'block' ? 'Block All Visible Services' : 'Allow All Visible Services'}
                </h3>
              </div>
              <button
                onClick={() => setBatchConfirmAction(null)}
                className="text-[var(--muted)] hover:text-[var(--text)] text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              {batchConfirmAction === 'block'
                ? `Are you sure you want to block all ${filteredServices.length} visible services for all network clients?`
                : `Are you sure you want to permit all ${filteredServices.length} visible services across the network?`}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBatchConfirmAction(null)}
                className="px-3 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text)] border border-[var(--border)] text-xs font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const act = batchConfirmAction
                  setBatchConfirmAction(null)
                  handleBatchServices(act)
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  batchConfirmAction === 'block'
                    ? 'bg-[var(--red-bg)] hover:bg-[var(--red)] hover:text-black text-[var(--red)] border border-[var(--red)]/30'
                    : 'bg-[var(--green-bg)] hover:bg-[var(--green)] hover:text-black text-[var(--green)] border border-[var(--green)]/30'
                }`}
              >
                {batchConfirmAction === 'block' ? 'Confirm Block All' : 'Confirm Allow All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
