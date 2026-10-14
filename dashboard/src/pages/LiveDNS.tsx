import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { type QueryLogEntry, getFilterLists, blockDomain, unblockDomain, getApiUrl, isDnsBlocked, getQueryLog } from '../api'
import { format, parseISO } from 'date-fns'
import { useToast } from '../contexts/ToastContext'
import { useServer } from '../contexts/ServerContext'
import FaviconDomain from '../components/FaviconDomain'
import { exportQueryLog } from '../utils/export'
import {
  Search, Filter, X, Pause, Play, ArrowDown,
  Shield, ShieldOff, ExternalLink, Zap, Database,
  Globe, Lock, AlertTriangle, ChevronRight,
  Clock, Server, Copy, Check, Download, Layers,
  ChevronDown, ChevronUp
} from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'

// ── Helpers & Design Tokens ───────────────────────────────────────────────────

function isBlocked(entryOrReason?: QueryLogEntry | string | null): boolean {
  return isDnsBlocked(entryOrReason)
}

function upstreamShort(u?: string): string {
  if (!u) return 'Local Cache'
  if (u.includes('google')) return 'Google DNS (DoH)'
  if (u.includes('quad9')) return 'Quad9 (DoH)'
  if (u.includes('cloudflare')) return 'Cloudflare (DoH)'
  if (u.includes('adguard')) return 'AdGuard DNS'
  return u.replace('https://', '').replace('/dns-query', '').split('.').slice(-2).join('.')
}

function formatTTL(ttl: number): string {
  if (ttl < 60) return `${ttl}s`
  if (ttl < 3600) return `${Math.round(ttl / 60)}m`
  return `${Math.round(ttl / 3600)}h`
}

function filterShort(name: string): string {
  if (!name) return 'Filter Rule'
  return name.replace(/^HaGeZi's /i, '').replace(/ (Blocklist|List|filter)$/i, '').slice(0, 32)
}

// ── Clean Status Badge ────────────────────────────────────────────────────────
function StatusBadge({ entry, reason }: { entry?: QueryLogEntry | null; reason?: string }) {
  const effectiveReason = entry?.reason || reason || ''
  const isRewrite = effectiveReason.startsWith('Rewrite')
  const isMalware = effectiveReason === 'FilteredSafeBrowsing' || effectiveReason.toLowerCase().includes('safebrowsing')
  const isParental = effectiveReason === 'FilteredParental' || effectiveReason.toLowerCase().includes('parental')
  const isSafeSearch = effectiveReason === 'FilteredSafeSearch' || effectiveReason.toLowerCase().includes('safesearch')
  const blocked = entry ? isDnsBlocked(entry) : isDnsBlocked(effectiveReason)

  if (isRewrite) {
    return (
      <span className="status text-[11px] py-0.5 px-2 bg-[var(--surface-3)] text-[var(--text-2)] border border-[var(--border)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-2)] shrink-0" />
        <span>Rewrite</span>
      </span>
    )
  }
  if (isMalware) {
    return (
      <span className="status bad">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)] shrink-0" />
        <span>Malware</span>
      </span>
    )
  }
  if (isParental) {
    return (
      <span className="status bad">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)] shrink-0" />
        <span>Parental</span>
      </span>
    )
  }
  if (isSafeSearch) {
    return (
      <span className="status bad">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] shrink-0" />
        <span>SafeSearch</span>
      </span>
    )
  }
  if (blocked) {
    return (
      <span className="status bad">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)] shrink-0" />
        <span>Blocked</span>
      </span>
    )
  }
  return (
    <span className="status good">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] shrink-0" />
      <span>Allowed</span>
    </span>
  )
}

// ── Copy Button ───────────────────────────────────────────────────────────────
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
    <button onClick={copy} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1" title="Copy text">
      {copied ? <Check className="w-3.5 h-3.5 text-[var(--text-primary)]" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

// ── Burst Group Interface ─────────────────────────────────────────────────────
interface BurstGroup {
  id: string
  client: string
  clientName: string
  domain: string
  time: string
  entries: QueryLogEntry[]
  hasBlocked: boolean
  hasCached: boolean
  hasDnssec: boolean
  avgLatency: number
  rules: { filter_list_id: number; text: string }[]
}

// ── Studio Inspector Drawer ───────────────────────────────────────────────────
interface DetailPanelProps {
  entry: QueryLogEntry | null
  filterNames: Record<number, string>
  onClose: () => void
  onBlock: (domain: string) => void
  onUnblock: (domain: string) => void
  onViewClient: (ip: string) => void
}

function DetailPanel({ entry, filterNames, onClose, onBlock, onUnblock, onViewClient }: DetailPanelProps) {
  const blocked = entry ? isBlocked(entry) : false
  const domain = entry?.question?.name ?? ''

  return (
    <AnimatePresence>
      {entry && (
        <>
          {/* Mobile backdrop */}
          <div
            className="sm:hidden fixed inset-0 z-40 bg-[var(--bg-overlay)] backdrop-blur-xs"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 350, damping: 35 }}
            className="fixed inset-x-0 bottom-0 max-h-[85vh] sm:max-h-none sm:inset-y-0 sm:right-0 sm:left-auto sm:w-84 sm:absolute bg-[var(--bg-card)] border-t sm:border-t-0 sm:border-l border-[var(--border)] rounded-t-2xl sm:rounded-none flex flex-col z-50 shadow-2xl overflow-hidden"
          >
            {/* Mobile drag handle */}
            <div className="w-10 h-1 bg-[var(--border-strong)] rounded-full mx-auto my-2 sm:hidden shrink-0" />

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 sm:py-3.5 border-b border-[var(--border)] shrink-0 bg-[var(--bg-surface)]">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--text-primary)] tracking-tight">Query Inspector</span>
              </div>
              <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded hover:bg-[var(--bg-hover)] transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[var(--border-subtle)]">
            {/* Domain & Primary Status */}
            <div className="px-4 py-4 space-y-2.5">
              <div className="flex items-start gap-2">
                <FaviconDomain
                  domain={domain}
                  blocked={blocked}
                  className="text-sm font-mono font-medium text-[var(--text-primary)] flex-1 min-w-0 break-all"
                />
                <CopyButton text={domain} />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge reason={entry.reason} />
                {entry.cached && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-[var(--bg-muted)] text-[var(--text-secondary)] border border-[var(--border)]">
                    <Database className="w-3 h-3" />
                    <span>Cache Hit</span>
                  </span>
                )}
                {entry.answer_dnssec && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border)]">
                    <Lock className="w-3 h-3" />
                    <span>DNSSEC Valid</span>
                  </span>
                )}
              </div>
            </div>

            {/* Core Telemetry */}
            <div className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-tertiary)] flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Timestamp</span>
                <span className="font-mono text-[var(--text-primary)]">
                  {entry.time ? format(parseISO(entry.time), 'HH:mm:ss.SSS') : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-tertiary)] flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Requesting Client</span>
                <button
                  onClick={() => onViewClient(entry.client)}
                  className="font-mono text-[var(--text-primary)] hover:underline flex items-center gap-1 font-medium cursor-pointer"
                >
                  {entry.client_info?.name || entry.client}
                  <ChevronRight className="w-3 h-3 text-[var(--text-muted)]" />
                </button>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-tertiary)] flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> Processing Latency</span>
                <span className="font-mono text-[var(--text-primary)]">
                  {entry.elapsedMs && parseFloat(entry.elapsedMs) > 0 ? `${parseFloat(entry.elapsedMs).toFixed(2)} ms` : '0 ms (Cache)'}
                </span>
              </div>
            </div>

            {/* DNS Question */}
            <div className="px-4 py-3.5 space-y-2">
              <div className="text-[10.5px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">DNS Question</div>
              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-2.5 font-mono text-xs space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-tertiary)]">Query Name</span>
                  <span className="text-[var(--text-primary)] ml-2 break-all text-right select-all">{entry.question?.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-tertiary)]">Record Type</span>
                  <span className="px-1.5 py-0.5 rounded bg-[var(--bg-active)] border border-[var(--border)] text-[10px] text-[var(--text-primary)] font-medium">
                    {entry.question?.type}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-tertiary)]">Class</span>
                  <span className="text-[var(--text-secondary)]">{entry.question?.class || 'IN'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-tertiary)]">Response Code</span>
                  <span className={entry.status === 'NOERROR' ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--color-danger)] font-medium'}>
                    {entry.status || 'NOERROR'}
                  </span>
                </div>
              </div>
            </div>

            {/* Resolved Records */}
            {entry.answer && entry.answer.length > 0 && (
              <div className="px-4 py-3.5 space-y-2">
                <div className="text-[10.5px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                  DNS Answer Records ({entry.answer.length})
                </div>
                <div className="space-y-1.5">
                  {entry.answer.map((a, i) => (
                    <div key={i} className="flex items-center justify-between bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] px-1 py-0.2 rounded bg-[var(--bg-active)] border border-[var(--border)] text-[var(--text-secondary)]">
                          {a.type}
                        </span>
                        <span className={a.value === '0.0.0.0' || a.value === '::' ? 'text-[var(--color-danger)] font-medium' : 'text-[var(--text-primary)]'}>
                          {a.value || '0.0.0.0'}
                        </span>
                      </div>
                      <span className="text-[var(--text-muted)] text-[11px]" title={`TTL: ${a.ttl}s`}>
                        {formatTTL(a.ttl)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Resolution Pipeline */}
            <div className="px-4 py-3.5 space-y-2">
              <div className="text-[10.5px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Resolution Source</div>
              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-2.5 flex items-center gap-2.5">
                {entry.cached ? (
                  <>
                    <Database className="w-4 h-4 text-[var(--text-primary)] shrink-0" />
                    <div>
                      <div className="text-xs text-[var(--text-primary)] font-medium">AdGuard Local Cache</div>
                      <div className="text-[11px] text-[var(--text-tertiary)]">Zero round-trip latency</div>
                    </div>
                  </>
                ) : entry.upstream ? (
                  <>
                    <Server className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs text-[var(--text-primary)] font-medium">{upstreamShort(entry.upstream)}</div>
                      <div className="text-[10.5px] font-mono text-[var(--text-tertiary)] truncate">{entry.upstream}</div>
                    </div>
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4 text-[var(--text-primary)] shrink-0" />
                    <div>
                      <div className="text-xs text-[var(--text-primary)] font-medium">Filtered Locally</div>
                      <div className="text-[11px] text-[var(--text-tertiary)]">Terminated prior to upstream resolution</div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Matched Filter Rules */}
            {blocked && (entry.rules?.length || entry.rule) && (
              <div className="px-4 py-3.5 space-y-2">
                <div className="text-[10.5px] font-medium uppercase tracking-wider text-[var(--text-tertiary)] flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                  <span>Matched Filter Rules</span>
                </div>
                <div className="space-y-2">
                  {(entry.rules ?? []).map((r, i) => (
                    <div key={i} className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[var(--text-primary)] font-medium">
                          {filterNames[r.filter_list_id] || `Filter List #${r.filter_list_id}`}
                        </span>
                        <span className="text-[10px] font-mono text-[var(--text-tertiary)]">ID: {r.filter_list_id}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="text-[11px] font-mono text-[var(--text-primary)] bg-[var(--bg-active)] border border-[var(--border)] px-2 py-1 rounded break-all flex-1">
                          {r.text}
                        </code>
                        <CopyButton text={r.text} />
                      </div>
                    </div>
                  ))}
                  {!entry.rules?.length && entry.rule && (
                    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-2">
                      <code className="text-[11px] font-mono text-[var(--text-primary)]">{entry.rule}</code>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div className="px-4 py-4 space-y-2">
              <div className="text-[10.5px] font-medium uppercase tracking-wider text-[var(--muted)] mb-2">Actions</div>
              {blocked ? (
                <button
                  onClick={() => onUnblock(domain)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-[var(--green)] bg-[var(--green-bg)] hover:bg-[var(--green)] hover:text-black border border-[var(--green)]/30 rounded-lg transition-colors cursor-pointer"
                >
                  <ShieldOff className="w-3.5 h-3.5" />
                  <span>Whitelist Domain</span>
                </button>
              ) : (
                <button
                  onClick={() => onBlock(domain)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-[var(--red)] bg-[var(--red-bg)] hover:bg-[var(--red)] hover:text-black border border-[var(--red)]/30 rounded-lg transition-colors cursor-pointer"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Block Domain</span>
                </button>
              )}
              <a
                href={`https://${domain}`}
                target="_blank"
                rel="noreferrer"
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-[var(--text)] border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded-lg transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[var(--muted)]" />
                <span>Visit Domain in Browser</span>
              </a>
            </div>
          </div>
        </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Standard Query Row ────────────────────────────────────────────────────────
interface RowProps {
  entry: QueryLogEntry
  selected: boolean
  filterNames: Record<number, string>
  onClick: () => void
  onClientClick: (ip: string) => void
  isNew?: boolean
}

function Row({ entry, selected, filterNames, onClick, onClientClick, isNew }: RowProps) {
  const blocked = isBlocked(entry)
  const clientName = entry.client_info?.name || entry.client
  const qtype = entry.question?.type || ''
  const filterListName = entry.rules?.[0]
    ? filterShort(filterNames[entry.rules[0].filter_list_id] || '')
    : null

  return (
    <div
      onClick={onClick}
      className={`border-b border-[var(--border-subtle)] cursor-pointer transition-colors group ${isNew ? 'dns-row-enter' : ''} ${
        selected
          ? 'bg-[var(--bg-active)] border-l-2 border-l-[var(--text-primary)]'
          : blocked
            ? 'bg-[var(--bg-active)]/30 hover:bg-[var(--bg-hover)]'
            : 'hover:bg-[var(--bg-hover)]'
      }`}
    >
      {/* Desktop View (md and up): 7 columns */}
      <div
        className="hidden md:grid gap-x-3 px-3.5 py-2.5 items-center"
        style={{ gridTemplateColumns: '84px 124px 1fr 56px 64px 48px 84px' }}
      >
        {/* Time */}
        <span className="text-[var(--text-tertiary)] tabular-nums font-mono text-[11px] self-center">
          {entry.time ? format(parseISO(entry.time), 'HH:mm:ss') : '—'}
        </span>

        {/* Client */}
        <button
          onClick={e => { e.stopPropagation(); onClientClick(entry.client) }}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-medium truncate text-left self-center transition-colors cursor-pointer"
          title={`${clientName} (${entry.client})`}
        >
          {clientName}
        </button>

        {/* Domain + filter info */}
        <div className="min-w-0 self-center">
          <div className="flex items-center gap-1.5">
            <FaviconDomain
              domain={entry.question?.name || ''}
              blocked={blocked}
              className={`text-xs font-mono ${blocked ? 'text-[var(--text-secondary)] font-normal' : 'text-[var(--text-primary)] font-medium'}`}
            />
            {entry.answer_dnssec && (
              <span title="DNSSEC Validated">
                <Lock className="w-3 h-3 text-[var(--text-tertiary)] shrink-0" />
              </span>
            )}
          </div>
          {filterListName && (
            <div className="text-[10px] text-[var(--text-tertiary)] truncate mt-0.5 flex items-center gap-1 font-sans">
              <span className="w-1 h-1 rounded-full bg-[var(--text-muted)]" />
              <span>{filterListName}</span>
            </div>
          )}
          {!blocked && entry.answer?.[0]?.value && entry.answer[0].value !== '0.0.0.0' && (
            <div className="text-[10px] text-[var(--text-tertiary)] font-mono truncate mt-0.5">
              → {entry.answer[0].value}
            </div>
          )}
        </div>

        {/* Type badge */}
        <span className="self-center">
          <span className="inline-block px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[10px] font-mono text-[var(--text-secondary)] font-medium">
            {qtype}
          </span>
        </span>

        {/* Latency */}
        <span className="text-[var(--text-secondary)] text-xs tabular-nums font-mono self-center">
          {entry.elapsedMs && parseFloat(entry.elapsedMs) > 0
            ? `${parseFloat(entry.elapsedMs).toFixed(0)}ms`
            : <span className="text-[var(--text-secondary)] text-[11px] font-mono font-medium">cache</span>
          }
        </span>

        {/* Cache */}
        <span className={`text-[10px] font-medium font-mono self-center ${entry.cached ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
          {entry.cached ? 'HIT' : 'MISS'}
        </span>

        {/* Status */}
        <div className="self-center">
          <StatusBadge entry={entry} reason={entry.reason} />
        </div>
      </div>

      {/* Mobile View (< md): Native list tile */}
      <div className="md:hidden flex flex-col gap-1.5 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <FaviconDomain
              domain={entry.question?.name || ''}
              blocked={blocked}
              className={`text-xs font-mono truncate ${blocked ? 'text-[var(--text-secondary)] font-normal line-through opacity-80' : 'text-[var(--text-primary)] font-semibold'}`}
            />
            {entry.answer_dnssec && (
              <Lock className="w-3 h-3 text-[var(--text-tertiary)] shrink-0" />
            )}
          </div>
          <div className="shrink-0 scale-90 origin-right">
            <StatusBadge entry={entry} reason={entry.reason} />
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-[var(--muted)] font-mono">
          <div className="flex items-center gap-1.5 truncate">
            <button
              onClick={e => { e.stopPropagation(); onClientClick(entry.client) }}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline truncate cursor-pointer font-sans"
            >
              {clientName}
            </button>
            <span>·</span>
            <span className="px-1 py-0.2 rounded bg-[var(--surface-2)] text-[10px]">{qtype}</span>
            <span>·</span>
            <span>{entry.elapsedMs && parseFloat(entry.elapsedMs) > 0 ? `${parseFloat(entry.elapsedMs).toFixed(0)}ms` : 'cache'}</span>
          </div>
          <span className="shrink-0 text-[10px] ml-2">
            {entry.time ? format(parseISO(entry.time), 'HH:mm:ss') : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Burst Group Row Component ────────────────────────────────────────────────
interface GroupRowProps {
  group: BurstGroup
  selectedEntry: QueryLogEntry | null
  filterNames: Record<number, string>
  onSelect: (entry: QueryLogEntry) => void
  onClientClick: (ip: string) => void
}

function BurstGroupRow({ group, selectedEntry, filterNames, onSelect, onClientClick }: GroupRowProps) {
  const [expanded, setExpanded] = useState(false)
  const types = Array.from(new Set(group.entries.map(e => e.question?.type).filter(Boolean)))
  const filterListName = group.rules[0] ? filterShort(filterNames[group.rules[0].filter_list_id] || '') : null

  return (
    <div className={`border-b border-[var(--border-subtle)] ${group.hasBlocked ? 'bg-[var(--bg-active)]/30' : ''}`}>
      {/* Desktop Group Row */}
      <div
        onClick={() => setExpanded(e => !e)}
        className="hidden md:grid gap-x-3 px-3.5 py-2.5 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors items-center"
        style={{ gridTemplateColumns: '84px 124px 1fr 56px 64px 48px 84px' }}
      >
        {/* Time */}
        <div className="flex items-center gap-1.5 text-[var(--text-tertiary)] font-mono text-[11px]">
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
          <span>{group.time ? format(parseISO(group.time), 'HH:mm:ss') : '—'}</span>
        </div>

        {/* Client */}
        <button
          onClick={e => { e.stopPropagation(); onClientClick(group.client) }}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-medium truncate text-left transition-colors cursor-pointer"
        >
          {group.clientName}
        </button>

        {/* Domain */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <FaviconDomain
              domain={group.domain}
              blocked={group.hasBlocked}
              className={`text-xs font-mono ${group.hasBlocked ? 'text-[var(--text-secondary)] font-normal' : 'text-[var(--text-primary)] font-medium'}`}
            />
            <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-[var(--bg-surface)] text-[var(--text-tertiary)] border border-[var(--border)]">
              {group.entries.length} queries
            </span>
          </div>
          {filterListName && (
            <div className="text-[10px] text-[var(--text-tertiary)] truncate mt-0.5 flex items-center gap-1 font-sans">
              <span className="w-1 h-1 rounded-full bg-[var(--text-muted)]" />
              <span>{filterListName}</span>
            </div>
          )}
        </div>

        {/* Types */}
        <div className="flex items-center gap-1 flex-wrap">
          {types.map(t => (
            <span key={t} className="px-1 py-0.2 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[9px] font-mono text-[var(--text-secondary)] font-medium">
              {t}
            </span>
          ))}
        </div>

        {/* Latency */}
        <span className="text-[var(--text-secondary)] text-xs tabular-nums font-mono">
          {group.avgLatency > 0 ? `${group.avgLatency.toFixed(0)}ms` : <span className="text-[var(--text-secondary)] text-[11px] font-mono font-medium">cache</span>}
        </span>

        {/* Cache */}
        <span className={`text-[10px] font-medium font-mono ${group.hasCached ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
          {group.hasCached ? 'HIT' : 'MISS'}
        </span>

        {/* Status */}
        <div>
          <StatusBadge reason={group.hasBlocked ? 'FilteredBlackList' : 'NotFilteredNotFound'} />
        </div>
      </div>

      {/* Mobile Group Row */}
      <div
        onClick={() => setExpanded(e => !e)}
        className="md:hidden flex flex-col gap-1.5 px-3 py-2.5 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
      >
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {expanded ? <ChevronUp className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />}
            <FaviconDomain
              domain={group.domain}
              blocked={group.hasBlocked}
              className={`text-xs font-mono truncate ${group.hasBlocked ? 'text-[var(--text-secondary)] font-normal line-through opacity-80' : 'text-[var(--text-primary)] font-semibold'}`}
            />
            <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-[var(--surface-2)] text-[var(--muted)] border border-[var(--border)] shrink-0">
              {group.entries.length}
            </span>
          </div>
          <div className="shrink-0 scale-90 origin-right">
            <StatusBadge reason={group.hasBlocked ? 'FilteredBlackList' : 'NotFilteredNotFound'} />
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-[var(--muted)] font-mono pl-5">
          <div className="flex items-center gap-1.5 truncate">
            <button
              onClick={e => { e.stopPropagation(); onClientClick(group.client) }}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline truncate cursor-pointer font-sans"
            >
              {group.clientName}
            </button>
            <span>·</span>
            <span>{group.avgLatency > 0 ? `${group.avgLatency.toFixed(0)}ms` : 'cache'}</span>
          </div>
          <span className="shrink-0 text-[10px]">
            {group.time ? format(parseISO(group.time), 'HH:mm:ss') : '—'}
          </span>
        </div>
      </div>

      {/* Expanded sub-queries */}
      {expanded && (
        <div className="bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] pl-6">
          {group.entries.map((entry, idx) => (
            <Row
              key={idx}
              entry={entry}
              selected={Boolean(selectedEntry?.time === entry.time && selectedEntry?.client === entry.client)}
              filterNames={filterNames}
              onClick={() => onSelect(entry)}
              onClientClick={onClientClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Page Component ───────────────────────────────────────────────────────
export default function LiveDNSPage() {
  usePageTitle('Live DNS')
  const [entries, setEntries] = useState<QueryLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [selected, setSelected] = useState<QueryLogEntry | null>(null)
  const [filterNames, setFilterNames] = useState<Record<number, string>>({})
  const [newEntryIds, setNewEntryIds] = useState<Set<string>>(new Set())
  const [qps, setQps] = useState(0)
  const [groupBursts, setGroupBursts] = useState(false)
  const [quickFilter, setQuickFilter] = useState<'all' | 'blocked' | 'allowed' | 'cached' | 'dnssec' | 'slow'>('all')
  const [selectedFilterList, setSelectedFilterList] = useState<string>('')
  const [blockReason, setBlockReason] = useState<string>('')
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { serverVersion } = useServer()

  const [filters, setFilters] = useState({
    search: searchParams.get('search') || '',
    client: searchParams.get('client') || '',
    status: (['filtered', 'notfiltered'].includes(searchParams.get('status') || '')
      ? searchParams.get('status')
      : '') as '' | 'filtered' | 'notfiltered',
  })

  // Synchronize URL search params if changed from other views
  useEffect(() => {
    const s = searchParams.get('search')
    const c = searchParams.get('client')
    const st = searchParams.get('status')
    setFilters(prev => ({
      search: s !== null ? s : prev.search,
      client: c !== null ? c : prev.client,
      status: (st === 'filtered' || st === 'notfiltered' || st === '') ? (st as '' | 'filtered' | 'notfiltered') : prev.status,
    }))
    if (st === 'notfiltered') setQuickFilter('allowed')
    else if (st === 'filtered') setQuickFilter('blocked')
  }, [searchParams])

  const scrollRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const qpsWindowRef = useRef<number[]>([])

  useEffect(() => {
    getFilterLists().then(setFilterNames).catch(() => {})
  }, [serverVersion])

  // Space bar to toggle pause
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        setPaused(p => !p)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Aggregate stats of which blocklists have filtered queries in the current stream
  const blocklistStats = useMemo(() => {
    const counts: Record<string, number> = {}
    entries.forEach(e => {
      if (e.rules && e.rules.length > 0) {
        e.rules.forEach(r => {
          counts[r.filter_list_id] = (counts[r.filter_list_id] || 0) + 1
        })
      } else if (e.filterId !== undefined && e.filterId !== 0) {
        counts[e.filterId] = (counts[e.filterId] || 0) + 1
      }
    })

    const allIds = new Set([...Object.keys(counts), ...Object.keys(filterNames)])
    return Array.from(allIds)
      .map(id => ({
        id,
        name: filterNames[Number(id)] || `Filter List #${id}`,
        count: counts[id] || 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [entries, filterNames])

  // Sync quickFilter pill clicks with status dropdown
  const handleSelectQuickFilter = (qf: typeof quickFilter) => {
    const next = quickFilter === qf ? 'all' : qf
    setQuickFilter(next)
    if (next === 'allowed') {
      setFilters(f => ({ ...f, status: 'notfiltered' }))
    } else if (next === 'blocked') {
      setFilters(f => ({ ...f, status: 'filtered' }))
    } else {
      setFilters(f => ({ ...f, status: '' }))
    }
  }

  // Sync status dropdown selection with quickFilter pills
  const handleStatusChange = (status: '' | 'filtered' | 'notfiltered') => {
    setFilters(f => ({ ...f, status }))
    if (status === 'notfiltered') {
      setQuickFilter('allowed')
    } else if (status === 'filtered') {
      setQuickFilter('blocked')
    } else if (quickFilter === 'allowed' || quickFilter === 'blocked') {
      setQuickFilter('all')
    }
  }

  const resetFilters = () => {
    setFilters({ search: '', client: '', status: '' })
    setSelectedFilterList('')
    setBlockReason('')
    setQuickFilter('all')
  }

  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectRef = useRef<() => void>(() => {})
  const [sseError, setSseError] = useState(false)

  const connect = useCallback(() => {
    esRef.current?.close()
    if (paused) return
    const es = new EventSource(getApiUrl('/querylog/stream'))
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data)
        if (Array.isArray(raw) && (raw[0] as unknown as { __event?: string })?.__event === 'server_switched') {
          setEntries([])
          setLoading(true)
          return
        }
        const newEntries: QueryLogEntry[] = raw
        if (!newEntries.length) return

        retryCountRef.current = 0 // reset backoff on success

        const now = Date.now()
        newEntries.forEach(() => qpsWindowRef.current.push(now))
        qpsWindowRef.current = qpsWindowRef.current.filter(t => now - t < 5000)
        setQps(qpsWindowRef.current.length / 5)

        // Use composite key to avoid collision on same-second entries
        const ids = new Set(newEntries.map(e => `${e.time}-${e.client}-${e.question?.name}`))
        setNewEntryIds(ids)
        setTimeout(() => setNewEntryIds(new Set()), 500)

        setEntries(prev => {
          const existingKeys = new Set(prev.map(x => `${x.time}-${x.client}-${x.question?.name}`))
          const fresh = newEntries.filter(x => !existingKeys.has(`${x.time}-${x.client}-${x.question?.name}`))
          return [...fresh, ...prev].slice(0, 500)
        })
        setLoading(false)
      } catch {
        // ignore parse errors from heartbeats
      }
    }
    es.onerror = () => {
      es.close()
      retryCountRef.current++
      if (retryCountRef.current > 10) {
        setSseError(true)
        return
      }
      const delay = Math.min(3000 * Math.pow(2, retryCountRef.current - 1), 30000)
      retryTimerRef.current = setTimeout(() => connectRef.current(), delay)
    }
  }, [paused])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    let isMounted = true
    setLoading(true)

    // Preload latest 100 queries immediately from querylog
    getQueryLog({ limit: 100 })
      .then(res => {
        if (isMounted && res.data && res.data.length > 0) {
          setEntries(res.data)
          setLoading(false)
        }
      })
      .catch(() => {})

    connect()
    return () => {
      isMounted = false
      esRef.current?.close()
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [connect, serverVersion])

  useEffect(() => {
    if (autoScroll && scrollRef.current) scrollRef.current.scrollTop = 0
  }, [entries, autoScroll])

  const handleScroll = () => {
    if (scrollRef.current && scrollRef.current.scrollTop > 40) setAutoScroll(false)
  }

  // Quick filter & dropdown filters logic
  const filteredEntries = useMemo(() => {
    const searchTrimmed = (filters.search || '').trim().toLowerCase()
    const clientTrimmed = (filters.client || '').trim().toLowerCase()

    return entries.filter(e => {
      // 1. Text search filter
      if (searchTrimmed) {
        const domain = e.question?.name?.toLowerCase() || ''
        const clientIp = e.client?.toLowerCase() || ''
        const clientName = e.client_info?.name?.toLowerCase() || ''
        const qtype = e.question?.type?.toLowerCase() || ''
        const answerMatch = e.answer?.some(a => a.value?.toLowerCase().includes(searchTrimmed))
        const ruleMatch = e.rules?.some(r => r.text?.toLowerCase().includes(searchTrimmed))

        if (
          !domain.includes(searchTrimmed) &&
          !clientIp.includes(searchTrimmed) &&
          !clientName.includes(searchTrimmed) &&
          !qtype.includes(searchTrimmed) &&
          !answerMatch &&
          !ruleMatch
        ) {
          return false
        }
      }

      // 2. Client filter
      if (clientTrimmed) {
        const clientIp = e.client?.toLowerCase() || ''
        const clientName = e.client_info?.name?.toLowerCase() || ''
        if (!clientIp.includes(clientTrimmed) && !clientName.includes(clientTrimmed)) {
          return false
        }
      }

      // 3. Status filter (dropdown)
      const blocked = isBlocked(e)
      if (filters.status === 'filtered' && !blocked) return false
      if (filters.status === 'notfiltered' && blocked) return false

      // 4. Quick filter chips
      if (quickFilter === 'blocked' && !blocked) return false
      if (quickFilter === 'allowed' && blocked) return false
      if (quickFilter === 'cached' && !e.cached) return false
      if (quickFilter === 'dnssec' && !e.answer_dnssec) return false
      if (quickFilter === 'slow' && parseFloat(e.elapsedMs || '0') < 20) return false

      // 5. Selected filter list
      if (selectedFilterList) {
        const matchesRule = e.rules?.some(r => String(r.filter_list_id) === selectedFilterList)
        const matchesFilterId = e.filterId !== undefined && String(e.filterId) === selectedFilterList
        if (!matchesRule && !matchesFilterId) return false
      }

      // 6. Block reason dropdown
      if (blockReason && e.reason !== blockReason) return false

      return true
    })
  }, [entries, filters.search, filters.client, filters.status, quickFilter, selectedFilterList, blockReason])

  // Grouped bursts logic
  const burstGroups = useMemo<BurstGroup[]>(() => {
    if (!groupBursts) return []
    const groups: BurstGroup[] = []

    filteredEntries.forEach(entry => {
      const domain = entry.question?.name || ''
      const client = entry.client
      const entryTime = new Date(entry.time).getTime()

      const match = groups.find(g =>
        g.domain === domain &&
        g.client === client &&
        Math.abs(new Date(g.time).getTime() - entryTime) < 1500
      )

      if (match) {
        match.entries.push(entry)
        if (isBlocked(entry)) match.hasBlocked = true
        if (entry.cached) match.hasCached = true
        if (entry.answer_dnssec) match.hasDnssec = true
        if (entry.rules?.length) match.rules = [...match.rules, ...entry.rules]
        const totalLatency = match.entries.reduce((s, e) => s + parseFloat(e.elapsedMs || '0'), 0)
        match.avgLatency = totalLatency / match.entries.length
      } else {
        groups.push({
          id: `${entry.time}-${domain}-${client}`,
          client,
          clientName: entry.client_info?.name || client,
          domain,
          time: entry.time,
          entries: [entry],
          hasBlocked: isBlocked(entry),
          hasCached: entry.cached,
          hasDnssec: entry.answer_dnssec,
          avgLatency: parseFloat(entry.elapsedMs || '0'),
          rules: entry.rules ? [...entry.rules] : [],
        })
      }
    })

    return groups
  }, [filteredEntries, groupBursts])

  // Compute live KPIs
  const blockedCount = entries.filter(e => isBlocked(e)).length
  const allowedCount = Math.max(0, entries.length - blockedCount)
  const cachedCount = entries.filter(e => e.cached).length
  const cachePct = entries.length ? ((cachedCount / entries.length) * 100).toFixed(0) : '0'
  const blockPct = entries.length ? ((blockedCount / entries.length) * 100).toFixed(0) : '0'
  const avgLatency = entries.length
    ? (entries.reduce((acc, cur) => acc + parseFloat(cur.elapsedMs || '0'), 0) / entries.length).toFixed(1)
    : '0'

  const handleBlock = async (domain: string) => {
    try {
      await blockDomain(domain)
      toast(`${domain} blocked`, { type: 'success', undoFn: () => handleUnblock(domain) })
      setSelected(null)
    } catch { toast('Failed to block domain', { type: 'error' }) }
  }

  const handleUnblock = async (domain: string) => {
    try {
      await unblockDomain(domain)
      toast(`${domain} whitelisted`, { type: 'success', undoFn: () => handleBlock(domain) })
      setSelected(null)
    } catch { toast('Failed to unblock domain', { type: 'error' }) }
  }

  const hasActiveFilters = Boolean(
    filters.search || filters.client || filters.status || selectedFilterList || blockReason || quickFilter !== 'all'
  )

  return (
    <div className="flex flex-col gap-4 text-[var(--text)]">
      {/* ── Page Heading matching sample.html (Desktop) ── */}
      <section className="page-heading shrink-0 hidden sm:flex">
        <div>
          <h1>Live DNS</h1>
          <div className="subtitle flex items-center gap-3 flex-wrap">
            <span>High-frequency real-time event pipeline and packet inspection.</span>
            <span className="flex items-center gap-1.5 font-medium text-[var(--text)] font-mono text-[11px]">
              <span className={`w-1.5 h-1.5 rounded-full ${paused ? 'bg-[var(--muted)]' : 'bg-[var(--green)] animate-pulse'}`} />
              <span>{paused ? 'Stream Paused' : `${qps.toFixed(1)} q/s throughput`}</span>
            </span>
          </div>
        </div>

        {/* Top Control Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Burst grouping toggle */}
          <button
            onClick={() => setGroupBursts(g => !g)}
            className={`secondary-btn !min-h-[38px] ${groupBursts ? '!bg-[var(--surface-3)] font-bold' : ''}`}
            title="Group simultaneous queries for the same domain and device"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Group Bursts</span>
          </button>

          {/* Export CSV */}
          <button
            onClick={() => exportQueryLog(filteredEntries)}
            className="secondary-btn !min-h-[38px]"
            title="Export captured query log to CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>

          {!autoScroll && (
            <button
              onClick={() => { setAutoScroll(true); if (scrollRef.current) scrollRef.current.scrollTop = 0 }}
              className="secondary-btn !min-h-[38px]"
            >
              <ArrowDown className="w-3.5 h-3.5" /> Latest
            </button>
          )}

          <button
            onClick={() => setPaused(p => !p)}
            title="Toggle pause (Space)"
            className={`${paused ? 'primary-btn' : 'secondary-btn'} !min-h-[38px]`}
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span>{paused ? 'Resume' : 'Pause'}</span>
            <kbd className="hidden sm:inline-block text-[10px] font-mono opacity-60 ml-0.5">Space</kbd>
          </button>
        </div>
      </section>

      {/* ── Mobile Native Timeline Controller ── */}
      <div className="sm:hidden space-y-2.5 shrink-0">
        {/* Top Control Bar: Status + Quick Actions */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                paused ? 'bg-[var(--muted)]' : 'bg-[var(--green)] animate-pulse'
              }`}
            />
            <span className="text-xs font-mono font-bold text-[var(--text)] uppercase tracking-wide">
              {paused ? 'Paused' : `${qps.toFixed(1)} Q/S`}
            </span>
            <span className="text-[11px] text-[var(--muted)] truncate font-mono">
              · {filteredEntries.length}q ({blockPct}%)
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setGroupBursts(g => !g)}
              className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 cursor-pointer transition-colors ${
                groupBursts
                  ? 'bg-[var(--surface-3)] border-[var(--strong-border)] text-[var(--text)]'
                  : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]'
              }`}
              title="Group Bursts"
            >
              <Layers className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setPaused(p => !p)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                paused
                  ? 'primary-btn !min-h-[30px] !text-xs !py-1'
                  : 'secondary-btn !min-h-[30px] !text-xs !py-1'
              }`}
            >
              {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              <span>{paused ? 'Resume' : 'Pause'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Key Metrics matching sample.html (Desktop) ── */}
      <section className="metrics !mb-0 shrink-0 hidden sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-3.5" aria-label="Live query metrics">
        <div className="card metric !p-3.5">
          <div className="metric-top"><span>Captured Queries</span><span className="metric-symbol">◈</span></div>
          <div className="metric-value font-mono !my-2">{filteredEntries.length.toLocaleString()}</div>
          <div className="metric-foot">Queries in buffer window</div>
        </div>
        <div className="card metric !p-3.5">
          <div className="metric-top"><span>Filtered Threats</span><span className="metric-symbol">↗</span></div>
          <div className="metric-value font-mono !my-2">{blockPct}%</div>
          <div className="metric-foot"><span className="delta">{blockedCount}</span> lookups blocked</div>
        </div>
        <div className="card metric !p-3.5">
          <div className="metric-top"><span>Cache Hits</span><span className="metric-symbol">◎</span></div>
          <div className="metric-value font-mono !my-2">{cachePct}%</div>
          <div className="metric-foot"><span className="delta">{cachedCount}</span> local memory hits</div>
        </div>
        <div className="card metric !p-3.5">
          <div className="metric-top"><span>Mean Latency</span><span className="metric-symbol">⇄</span></div>
          <div className="metric-value font-mono !my-2">{avgLatency} ms</div>
          <div className="metric-foot">Average lookup time</div>
        </div>
      </section>

      {/* SSE connection error banner */}
      {sseError && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--bg-active)] border border-[var(--border-strong)] rounded-xl text-xs text-[var(--text-primary)] shrink-0">
          <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--color-warning)]" />
          <span className="flex-1">Lost connection to live DNS stream after 10 retries.</span>
          <button onClick={() => { retryCountRef.current = 0; setSseError(false); connect() }} className="px-2.5 py-1 rounded-lg bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] transition-colors font-medium cursor-pointer">Reconnect</button>
        </div>
      )}

      {/* Filter and View Bar */}
      <div className="flex flex-col gap-2.5 shrink-0">
        {/* Desktop Filter Bar (md and up) */}
        <div className="hidden md:flex gap-2 flex-wrap items-center">
          {/* Domain search */}
          <div className="relative flex-1 min-w-44">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Filter domains (e.g. google, sentry, adobe)…"
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-lg pl-9 pr-8 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors"
            />
            {filters.search && (
              <button
                type="button"
                onClick={() => setFilters(f => ({ ...f, search: '' }))}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                title="Clear domain filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Client IP/name */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Device IP or name…"
              value={filters.client}
              onChange={e => setFilters(f => ({ ...f, client: e.target.value }))}
              className="w-40 bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-lg pl-9 pr-8 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors"
            />
            {filters.client && (
              <button
                type="button"
                onClick={() => setFilters(f => ({ ...f, client: '' }))}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                title="Clear client filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Dropdown */}
          <select
            value={filters.status}
            onChange={e => handleStatusChange(e.target.value as '' | 'filtered' | 'notfiltered')}
            className="bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none cursor-pointer transition-colors"
          >
            <option value="">Status: All</option>
            <option value="filtered">Status: Blocked Only</option>
            <option value="notfiltered">Status: Allowed Only</option>
          </select>

          {/* Block Reason Dropdown */}
          <select
            value={blockReason}
            onChange={e => setBlockReason(e.target.value)}
            className="bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none cursor-pointer transition-colors"
          >
            <option value="">Reason: Any</option>
            <option value="FilteredBlackList">Reason: Blocklist</option>
            <option value="FilteredSafeBrowsing">Reason: Malware / Phishing</option>
            <option value="FilteredParental">Reason: Parental Control</option>
            <option value="FilteredSafeSearch">Reason: SafeSearch</option>
          </select>

          {/* Which Blocklist Dropdown */}
          <select
            value={selectedFilterList}
            onChange={e => {
              setSelectedFilterList(e.target.value)
              if (e.target.value) handleStatusChange('filtered')
            }}
            className={`border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none cursor-pointer max-w-[210px] truncate transition-colors ${
              selectedFilterList
                ? 'bg-[var(--bg-active)] border-[var(--border-strong)] text-[var(--text-primary)] font-medium'
                : 'bg-[var(--bg-surface)] border-[var(--border)] hover:border-[var(--border-strong)] text-[var(--text-primary)]'
            }`}
            title="Filter queries by which blocklist blocked the domain"
          >
            <option value="">Blocklist: All Lists</option>
            {blocklistStats.map(bl => (
              <option key={bl.id} value={bl.id}>
                {bl.count > 0 ? `${bl.name} (${bl.count})` : bl.name}
              </option>
            ))}
          </select>

          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
        </div>

        {/* Mobile Filter Header (< md) */}
        <div className="md:hidden flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Filter domains or IP…"
                value={filters.search}
                onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-xl pl-9 pr-8 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors"
              />
              {filters.search && (
                <button
                  type="button"
                  onClick={() => setFilters(f => ({ ...f, search: '' }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  title="Clear domain filter"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(o => !o)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                mobileFiltersOpen || Boolean(filters.status || blockReason || selectedFilterList || filters.client)
                  ? 'bg-[var(--surface-3)] text-[var(--text)] border-[var(--strong-border)]'
                  : 'bg-[var(--surface)] text-[var(--muted)] border-[var(--border)]'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Filters</span>
              {(filters.status || blockReason || selectedFilterList || filters.client) && (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--text)]" />
              )}
            </button>
          </div>

          {/* Collapsible Mobile Advanced Filters */}
          {mobileFiltersOpen && (
            <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] space-y-2.5 animate-scale-in">
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder="Device IP or name…"
                  value={filters.client}
                  onChange={e => setFilters(f => ({ ...f, client: e.target.value }))}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg pl-9 pr-8 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
                />
                {filters.client && (
                  <button
                    type="button"
                    onClick={() => setFilters(f => ({ ...f, client: '' }))}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    title="Clear client filter"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={filters.status}
                  onChange={e => handleStatusChange(e.target.value as '' | 'filtered' | 'notfiltered')}
                  className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2.5 py-2 text-xs text-[var(--text-primary)] focus:outline-none cursor-pointer"
                >
                  <option value="">Status: All</option>
                  <option value="filtered">Blocked Only</option>
                  <option value="notfiltered">Allowed Only</option>
                </select>

                <select
                  value={blockReason}
                  onChange={e => setBlockReason(e.target.value)}
                  className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2.5 py-2 text-xs text-[var(--text-primary)] focus:outline-none cursor-pointer"
                >
                  <option value="">Reason: Any</option>
                  <option value="FilteredBlackList">Blocklist</option>
                  <option value="FilteredSafeBrowsing">Malware</option>
                  <option value="FilteredParental">Parental</option>
                  <option value="FilteredSafeSearch">SafeSearch</option>
                </select>
              </div>

              <select
                value={selectedFilterList}
                onChange={e => {
                  setSelectedFilterList(e.target.value)
                  if (e.target.value) handleStatusChange('filtered')
                }}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2.5 py-2 text-xs text-[var(--text-primary)] focus:outline-none cursor-pointer"
              >
                <option value="">Blocklist: All Lists</option>
                {blocklistStats.map(bl => (
                  <option key={bl.id} value={bl.id}>
                    {bl.count > 0 ? `${bl.name} (${bl.count})` : bl.name}
                  </option>
                ))}
              </select>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-[var(--text)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border)] rounded-lg cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Reset All Filters</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Refined Segmented View Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs no-scrollbar">
          <span className="text-[11px] text-[var(--text-tertiary)] font-medium mr-1 shrink-0">View:</span>
          {[
            { id: 'all' as const, label: `All Queries (${entries.length})` },
            { id: 'allowed' as const, label: `Allowed (${allowedCount})` },
            { id: 'blocked' as const, label: `Blocked (${blockedCount})` },
            { id: 'cached' as const, label: `Cache Hits (${cachedCount})` },
            { id: 'dnssec' as const, label: 'DNSSEC Verified' },
            { id: 'slow' as const, label: 'Latency > 20ms' },
          ].map(chip => {
            const isActive = quickFilter === chip.id
            let activeClass = 'bg-[var(--bg-active)] text-[var(--text-primary)] border-[var(--border-strong)] shadow-xs'
            if (chip.id === 'allowed' && isActive) {
              activeClass = 'bg-[var(--green-bg)] text-[var(--green)] border-[var(--green)]/30 font-semibold'
            } else if (chip.id === 'blocked' && isActive) {
              activeClass = 'bg-[var(--red-bg)] text-[var(--red)] border-[var(--red)]/30 font-semibold'
            }

            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => handleSelectQuickFilter(chip.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
                  isActive
                    ? activeClass
                    : 'bg-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border-transparent'
                }`}
              >
                {chip.label}
              </button>
            )
          })}

          {selectedFilterList && (
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-[var(--bg-active)] border border-[var(--border-strong)] text-[var(--text-primary)] text-xs font-medium ml-2 shrink-0">
              <span>List: {filterNames[Number(selectedFilterList)] || `Filter #${selectedFilterList}`}</span>
              <button
                type="button"
                onClick={() => setSelectedFilterList('')}
                className="hover:opacity-75 p-0.5 cursor-pointer"
                title="Remove filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Main Table Container */}
      <div className="flex-1 relative bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden flex flex-col min-h-0 shadow-sm">

        {/* Table Header (desktop only) */}
        <div
          className="hidden md:grid gap-x-3 px-3.5 py-2.5 bg-[var(--bg-surface)] border-b border-[var(--border)] text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider shrink-0"
          style={{ gridTemplateColumns: '84px 124px 1fr 56px 64px 48px 84px' }}
        >
          <span>Time</span>
          <span>Client</span>
          <span>Domain · Filter attribution</span>
          <span>Type</span>
          <span>Latency</span>
          <span>Cache</span>
          <span>Status</span>
        </div>

        {/* Rows Container */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto"
          style={{ marginRight: (typeof window !== 'undefined' && window.innerWidth >= 768 && selected) ? 336 : 0, transition: 'margin-right 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          {loading && filteredEntries.length === 0 ? (
            <div className="flex items-center justify-center h-36 text-[var(--text-tertiary)] text-xs gap-2">
              <span className="w-1.5 h-1.5 bg-[var(--text-secondary)] rounded-full animate-pulse" />
              Connecting to live stream…
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-44 gap-2 text-[var(--text-tertiary)]">
              <Globe className="w-7 h-7 opacity-50" />
              <span className="text-xs">No DNS queries match the active filters</span>
            </div>
          ) : groupBursts ? (
            burstGroups.map(group => (
              <BurstGroupRow
                key={group.id}
                group={group}
                selectedEntry={selected}
                filterNames={filterNames}
                onSelect={entry => setSelected(entry)}
                onClientClick={ip => navigate(`/clients/${encodeURIComponent(ip)}`)}
              />
            ))
          ) : (
            filteredEntries.map((entry, i) => (
              <Row
                key={`${entry.time}-${i}`}
                entry={entry}
                selected={Boolean(selected?.time === entry.time && selected?.client === entry.client)}
                filterNames={filterNames}
                onClick={() => setSelected(prev =>
                  prev?.time === entry.time && prev?.client === entry.client ? null : entry
                )}
                onClientClick={ip => navigate(`/clients/${encodeURIComponent(ip)}`)}
                isNew={newEntryIds.has(entry.time)}
              />
            ))
          )}
        </div>

        {/* Detail Panel */}
        <DetailPanel
          entry={selected}
          filterNames={filterNames}
          onClose={() => setSelected(null)}
          onBlock={handleBlock}
          onUnblock={handleUnblock}
          onViewClient={ip => navigate(`/clients/${encodeURIComponent(ip)}`)}
        />
      </div>

      {/* Footer Bar */}
      <div className="flex items-center justify-between shrink-0 text-[11px] text-[var(--text-tertiary)] px-1">
        <span>Click any row to inspect DNS answers and resolution pipeline</span>
        <div className="flex items-center gap-3 font-mono">
          {groupBursts && <span className="text-[var(--text-secondary)]">bursts grouped</span>}
          <span>{filteredEntries.length} buffered</span>
        </div>
      </div>
    </div>
  )
}
