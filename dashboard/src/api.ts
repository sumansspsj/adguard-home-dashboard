import axios from 'axios'

export function getBackendHost(): string {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('agh_backend_url')
    if (saved && saved.trim()) {
      return saved.trim().replace(/\/+$/, '')
    }
    if (window.location.origin && window.location.origin !== 'null') {
      return window.location.origin
    }
  }
  return 'http://localhost:8080'
}

// Dynamic Base URL support for web deployment and proxy
export function getBackendBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('agh_backend_url')
    if (saved && saved.trim()) {
      return `${saved.trim().replace(/\/+$/, '')}/api`
    }
  }
  return '/api'
}

export function setBackendBaseUrl(url: string) {
  if (typeof window !== 'undefined') {
    if (url && url.trim()) {
      localStorage.setItem('agh_backend_url', url.trim().replace(/\/+$/, ''))
    } else {
      localStorage.removeItem('agh_backend_url')
    }
    api.defaults.baseURL = getBackendBaseUrl()
  }
}

export function getApiUrl(path: string): string {
  const base = getBackendBaseUrl()
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${cleanPath}`
}

const api = axios.create({ baseURL: getBackendBaseUrl(), timeout: 12000 })

api.interceptors.request.use((config) => {
  config.baseURL = getBackendBaseUrl()
  return config
})

// ── Shared types ────────────────────────────────────────────────────────────

export interface ClientInfo {
  whois: Record<string, string>
  name: string
  disallowed_rule: string
  disallowed: boolean
}

export interface QueryLogEntry {
  answer?: { type: string; value: string; ttl: number }[]
  answer_dnssec: boolean
  cached: boolean
  client: string
  client_info?: ClientInfo
  client_proto: string
  elapsedMs: string
  filterId?: number
  question: { class: string; name: string; type: string }
  reason: string
  rule?: string
  rules?: { filter_list_id: number; text: string }[]
  status: string
  time: string
  upstream?: string
}

export interface QueryLog {
  data: QueryLogEntry[]
  oldest: string
  total: number
}

export interface AghStats {
  num_dns_queries: number
  num_blocked_filtering: number
  num_replaced_safebrowsing: number
  num_replaced_parental: number
  num_replaced_safesearch: number
  avg_processing_time: number
  top_queried_domains: Record<string, number>[]
  top_blocked_domains: Record<string, number>[]
  top_clients: Record<string, number>[]
  top_upstreams_responses?: Record<string, number>[]
  top_upstreams_avg_time?: Record<string, number>[]
  dns_queries: number[]
  blocked_filtering: number[]
  replaced_safebrowsing: number[]
  replaced_parental: number[]
}

export interface AghStatus {
  dns_addresses: string[]
  dns_port: number
  http_port: number
  protection_enabled: boolean
  querylog_enabled: boolean
  running: boolean
  ui_language: string
  version: string
  language: string
}

export interface SafeSearch {
  enabled: boolean
  bing: boolean
  duckduckgo: boolean
  ecosia: boolean
  google: boolean
  pixabay: boolean
  yandex: boolean
  youtube: boolean
}

export interface AghClient {
  name: string
  ids: string[]
  use_global_settings: boolean
  filtering_enabled: boolean
  parental_enabled: boolean
  safebrowsing_enabled: boolean
  safesearch_enabled: boolean
  safe_search?: SafeSearch
  blocked_services: string[]
  upstreams: string[]
  tags: string[]
  ignore_querylog: boolean
  ignore_statistics: boolean
}

export interface AutoClient {
  ip: string
  name: string
  source: string
  whois_info: Record<string, string>
}

export interface Clients {
  clients: AghClient[]
  auto_clients: AutoClient[]
  supported_tags: string[]
}

export interface FilteringStatus {
  enabled: boolean
  interval: number
  filters: {
    id: number
    url: string
    name: string
    rules_count: number
    enabled: boolean
    last_updated: string
  }[]
  whitelist_filters: unknown[]
  user_rules: string[]
}

export interface CacheStats {
  total: number
  cached: number
  cache_hit_rate: number
  upstreams: Record<string, number>
  real_avg_latency_ms?: number
  upstream_latency_ms?: number
  latency_spark?: number[]
}

export interface StatsConfig {
  interval: number
  ignored?: string[]
}

export interface QueryLogConfig {
  enabled: boolean
  interval: number
  anonymize_client_ip?: boolean
  ignored?: string[]
}

export type DnsBlockable =
  | string
  | {
      reason?: string
      rules?: { text?: string }[]
      status?: string
      answer?: { value?: string }[]
      client_info?: { disallowed?: boolean }
      filterId?: number
    }
  | null
  | undefined

/**
 * Accurately determines if an AdGuard Home DNS query was blocked/filtered.
 * Handles NotFiltered*, Rewrite*, and WhiteList entries correctly.
 * Supports both raw reason strings and full QueryLogEntry records.
 */
export function isDnsBlocked(target?: DnsBlockable): boolean {
  if (!target) return false

  if (typeof target === 'string') {
    const r = target.toLowerCase()
    if (
      r.startsWith('notfiltered') ||
      r.startsWith('rewrite') ||
      r.includes('whitelist') ||
      r.includes('allowlist')
    ) {
      return false
    }
    return (
      r.startsWith('filter') ||
      r.startsWith('block') ||
      r.includes('safebrowsing') ||
      r.includes('parental') ||
      r.includes('safesearch')
    )
  }

  const reason = (target.reason || '').toLowerCase()

  // 1. Whitelist / Allowlist precedence
  if (
    reason.startsWith('notfilteredwhitelist') ||
    reason.includes('whitelist') ||
    reason.includes('allowlist') ||
    target.rules?.some(r => r.text?.startsWith('@@'))
  ) {
    return false
  }

  // 2. Reason-based block detection
  if (
    reason.startsWith('filter') ||
    reason.startsWith('block') ||
    reason.includes('safebrowsing') ||
    reason.includes('parental') ||
    reason.includes('safesearch')
  ) {
    return true
  }

  // 3. Client disallowed by policy
  if (target.client_info?.disallowed) {
    return true
  }

  // 4. Active block rules present
  if (target.rules && target.rules.length > 0) {
    const hasBlockRule = target.rules.some(r => !r.text?.startsWith('@@'))
    if (hasBlockRule) return true
  }

  // 5. Filter list ID present (non-zero)
  if (target.filterId !== undefined && target.filterId > 0) {
    return true
  }

  // 6. Sinkhole answers (0.0.0.0, ::) when reason is not explicitly NotFiltered*
  if (target.answer && target.answer.length > 0 && !reason.startsWith('notfiltered')) {
    const isSinkhole = target.answer.some(a => a.value === '0.0.0.0' || a.value === '::')
    if (isSinkhole) return true
  }

  // 7. Status field check
  const status = (target.status || '').toLowerCase()
  if (status === 'filtered' || status === 'blocked') {
    return true
  }

  return false
}

// ── API calls ────────────────────────────────────────────────────────────────

export const getStats = () =>
  api.get<AghStats>('/stats').then(r => r.data)

export const getStatsConfig = () =>
  api.get<StatsConfig>('/stats/config').then(r => r.data)

export const updateStatsConfig = (interval: number) =>
  api.post<{ ok: boolean }>('/stats/config', { interval }).then(r => r.data)

export const getQueryLogConfig = () =>
  api.get<QueryLogConfig>('/querylog/config').then(r => r.data)

export const updateQueryLogConfig = (interval: number) =>
  api.post<{ ok: boolean }>('/querylog/config', { interval }).then(r => r.data)

export const getStatus = () =>
  api.get<AghStatus>('/status').then(r => r.data)

export const getQueryLog = (params?: Record<string, string | number>) =>
  api.get<QueryLog>('/querylog', { params }).then(r => r.data)

export const getClientLog = (ip: string, limit = 200) =>
  api.get<QueryLog>(`/client_log/${encodeURIComponent(ip)}`, { params: { limit } }).then(r => r.data)

export const getClients = () =>
  api.get<Clients>('/clients').then(r => r.data)

export const getFiltering = () =>
  api.get<FilteringStatus>('/filtering').then(r => r.data)

export const getDnsInfo = () =>
  api.get('/dns_info').then(r => r.data)

export const getHealth = () =>
  api.get('/health').then(r => r.data)

export const getCacheStats = () =>
  api.get<CacheStats>('/cache_stats').then(r => r.data)

export const toggleProtection = (enabled: boolean, durationSeconds?: number) =>
  api.post('/protection', { enabled, duration: durationSeconds }).then(r => r.data)

export const setStatsPeriod = (interval: number) =>
  api.post('/stats/config', { interval }).then(r => r.data)

export const blockDomain = (domain: string) =>
  api.post('/rules/block', { domain }).then(r => r.data)

export const unblockDomain = (domain: string) =>
  api.post('/rules/unblock', { domain }).then(r => r.data)

export const getFilterLists = (): Promise<Record<number, string>> =>
  api.get('/filter_lists').then(r => r.data)

export interface CheckHostRule {
  text: string
  filter_list_id: number
}

export interface CheckHostResult {
  reason: string
  rule: string
  rules: CheckHostRule[]
  service_name: string
  cname: string
  ip_addrs: string[] | null
  filter_id: number
}

export const checkHost = (name: string) =>
  api.get<CheckHostResult>('/filtering/check_host', { params: { name } }).then(r => r.data)

// ── Security & Blocked Services Types ──────────────────────────────────────

export interface BlockedServiceItem {
  id: string
  name: string
  icon_svg: string
  rules?: string[]
  group_id?: string
}

export interface BlockedServicesAllResponse {
  blocked_services: BlockedServiceItem[]
  groups: { id: string }[]
}

export interface SecurityPolicies {
  safebrowsing: { enabled: boolean }
  parental: { enabled: boolean }
  safesearch: {
    enabled: boolean
    bing: boolean
    duckduckgo: boolean
    ecosia: boolean
    google: boolean
    pixabay: boolean
    yandex: boolean
    youtube: boolean
  }
}

// ── Security & Blocked Services API calls ───────────────────────────────────

export const getBlockedServicesAll = () =>
  api.get<BlockedServicesAllResponse>('/blocked_services/all').then(r => r.data)

export const getBlockedServicesList = () =>
  api.get<string[]>('/blocked_services/list').then(r => r.data)

export const updateBlockedServices = (ids: string[]) =>
  api.put<{ ok: boolean; ids: string[] }>('/blocked_services/update', { ids }).then(r => r.data)

export const getSecurityPolicies = () =>
  api.get<SecurityPolicies>('/security/policies').then(r => r.data)

export const toggleSafebrowsing = (enabled: boolean) =>
  api.post<{ ok: boolean; enabled: boolean }>('/security/safebrowsing', { enabled }).then(r => r.data)

export const toggleParental = (enabled: boolean) =>
  api.post<{ ok: boolean; enabled: boolean }>('/security/parental', { enabled }).then(r => r.data)

export const updateSafeSearch = (data: { enabled?: boolean; settings?: Partial<SecurityPolicies['safesearch']> }) =>
  api.post<{ ok: boolean }>('/security/safesearch', data).then(r => r.data)

export const getUserRules = () =>
  api.get<string[]>('/filtering/rules').then(r => r.data)

export const addUserRule = (rule: string) =>
  api.post<{ ok: boolean }>('/filtering/rules/add', { rule }).then(r => r.data)

export const addRulesBatch = (rules: string[]) =>
  api.post<{ ok: boolean; rules: string[] }>('/filtering/rules/add', { rules }).then(r => r.data)

export const removeUserRule = (rule: string) =>
  api.post<{ ok: boolean }>('/filtering/rules/remove', { rule }).then(r => r.data)

// ── Speedtest & DNS Benchmark ───────────────────────────────────────────────

export interface DnsBenchmarkResult {
  name: string
  host: string
  provider: string
  timeMs: number | null
  status: 'ok' | 'error'
  error?: string
  isLocal: boolean
}

export interface DnsBenchmarkResponse {
  results: DnsBenchmarkResult[]
  timestamp: number
}

export const getDnsBenchmark = () =>
  api.get<DnsBenchmarkResponse>('/dns_benchmark').then(r => r.data)

// ── Gemini AI Report & Chat Copilot ──────────────────────────────────────────

export interface ThreatVector {
  category: string
  domain: string
  sourceDevice: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  impact: string
  evidence: string
}

export interface ClientRisk {
  clientIp: string
  clientName: string
  riskGrade: 'A' | 'B' | 'C' | 'D'
  dominantBehavior: string
  anomaly?: string
  actionRecommended: string
}

export interface AIRecommendation {
  id: string
  title: string
  description: string
  rule?: string | null
  type: string
  category: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  impact: string
}

export interface AIReportData {
  securityScore: number
  securityGrade: string
  threatLevel: 'LOW' | 'GUARDED' | 'ELEVATED' | 'HIGH' | 'CRITICAL'
  executiveSummary: string
  statsSnapshot: {
    totalQueries: number
    blockedQueries: number
    blockRate: string
    avgLatencyMs: number | string
    activeDevices: number
  }
  topThreatVectors: ThreatVector[]
  clientRiskAnalysis: ClientRisk[]
  aiRecommendations: AIRecommendation[]
  dnsHygieneTips: string[]
  generatedAt?: number
  model?: string
}

export const getCachedAiReport = () =>
  api.get<{ ok: boolean; report: AIReportData | null }>('/ai/report').then(r => r.data)

export const generateAiReport = () =>
  api.post<{ ok: boolean; report: AIReportData }>('/ai/report', {}, { timeout: 45000 }).then(r => r.data)

export const sendAiChat = (message: string, history?: { role: 'user' | 'model'; text: string }[]) =>
  api.post<{ ok: boolean; reply: string; model: string }>('/ai/chat', { message, history }, { timeout: 35000 }).then(r => r.data)

export const applyAiRule = (rule: string) =>
  api.post<{ ok: boolean; rule: string }>('/ai/apply-rule', { rule }).then(r => r.data)

// ── Resolver Comparison & Live Speed Racing ─────────────────────────────────
export interface ResolverProvider {
  id: string
  name: string
  tag: string
  host: string
  protocol: string
  color: string
  tailwindText: string
  tailwindBg: string
  queriesResolved: number
  querySharePct: number
  avgHistoricalMs: number
  liveLatencyMs: number
  highlights: string[]
  rank?: number
  medal?: string
}

export interface ResolverTimelinePoint {
  time: string
  hour: string
  timestamp: number
  cloudflare: number
  google: number
  quad9: number
  winner: string
  fastestMs: number
}

export interface ResolverRaceResult {
  cloudflare: number
  google: number
  quad9: number
  timestamp: number
  winner: string
  winnerName: string
  marginMs: number
  podium: {
    id: string
    name: string
    timeMs: number
    color: string
    rank: number
  }[]
}

export interface ResolverComparisonResponse {
  providers: ResolverProvider[]
  leaderboard: ResolverProvider[]
  timeline: ResolverTimelinePoint[]
  latestRace: ResolverRaceResult
  totalQueriesResolved: number
  otherQueriesCount: number
  timestamp: number
}

export const getResolverComparison = () =>
  api.get<ResolverComparisonResponse>('/resolvers/compare').then(r => r.data)

export const runResolverRace = () =>
  api.post<{ ok: boolean; race: ResolverRaceResult; timeline: ResolverTimelinePoint[] }>('/resolvers/race').then(r => r.data)

// ── Multi-Server Node Management ─────────────────────────────────────────────
export interface AghServerConfig {
  id: string
  name: string
  host: string
  username: string
  hasPassword?: boolean
  active: boolean
  createdAt?: number
}

export interface ServerTestResult {
  ok: boolean
  latencyMs: number
  data?: {
    version: string
    running: boolean
    dns_port: number
    http_port: number
    protection_enabled: boolean
  }
  statusCode?: number
  error?: string
}

export interface ServersResponse {
  ok: boolean
  servers: AghServerConfig[]
  activeServer: AghServerConfig
}

export const getServers = () =>
  api.get<ServersResponse>('/servers').then(r => r.data)

export const testServerConnection = (params: { host: string; username?: string; password?: string }) =>
  api.post<ServerTestResult>('/servers/test', params).then(r => r.data)

export const addServer = (data: { name: string; host: string; username?: string; password?: string; autoSwitch?: boolean }) =>
  api.post<{ ok: boolean; server: AghServerConfig; activeServer: AghServerConfig }>('/servers', data).then(r => r.data)

export const updateServer = (id: string, updates: { name?: string; host?: string; username?: string; password?: string }) =>
  api.put<{ ok: boolean; server: AghServerConfig }>(`/servers/${id}`, updates).then(r => r.data)

export const deleteServer = (id: string) =>
  api.delete<{ ok: boolean; deletedId: string; activeId: string }>(`/servers/${id}`).then(r => r.data)

export const switchServer = (id: string) =>
  api.post<{ ok: boolean; activeServer: AghServerConfig }>(`/servers/${id}/switch`).then(r => r.data)

