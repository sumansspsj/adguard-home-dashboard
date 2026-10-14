import { useState, useEffect, useCallback } from 'react'
import {
  type DnsBenchmarkResult,
  type ResolverComparisonResponse,
  type ResolverRaceResult,
  getDnsBenchmark,
  getResolverComparison,
  runResolverRace,
} from '../api'
import {
  Zap, X, RefreshCw,
  ArrowUpRight, Gauge, Trophy, Shield, Activity, Flame
} from 'lucide-react'
import { useToast } from '../contexts/ToastContext'

interface SpeedTestModalProps {
  open: boolean
  onClose: () => void
}

export default function SpeedTestModal({ open, onClose }: SpeedTestModalProps) {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<'race' | 'benchmark'>('race')
  const [dnsResults, setDnsResults] = useState<DnsBenchmarkResult[]>([])
  const [resolverData, setResolverData] = useState<ResolverComparisonResponse | null>(null)
  const [racing, setRacing] = useState(false)
  const [benchmarking, setBenchmarking] = useState(false)

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  // Fetch fresh data whenever opened
  useEffect(() => {
    if (!open) return
    let isMounted = true

    Promise.all([
      getResolverComparison().catch(() => null),
      getDnsBenchmark().catch(() => null),
    ]).then(([comp, bench]) => {
      if (!isMounted) return
      if (comp) setResolverData(comp)
      if (bench?.results) setDnsResults(bench.results)
    })

    return () => { isMounted = false }
  }, [open])

  // Run live resolver race
  const handleTriggerRace = useCallback(async () => {
    setRacing(true)
    try {
      const res = await runResolverRace()
      if (res.race) {
        setResolverData(prev => prev ? {
          ...prev,
          latestRace: res.race,
          timeline: res.timeline,
          leaderboard: prev.leaderboard.map(p => {
            const key = p.id as keyof ResolverRaceResult
            const liveMs = typeof res.race[key] === 'number' ? res.race[key] as number : p.liveLatencyMs
            return { ...p, liveLatencyMs: liveMs }
          }).sort((a, b) => a.liveLatencyMs - b.liveLatencyMs),
        } : null)
        toast(`Race complete: ${res.race.winnerName || 'Quad9'} was fastest at ${res.race.marginMs || ''}ms!`, { type: 'success' })
      }
    } catch {
      toast('Failed to complete live resolver race', { type: 'error' })
    } finally {
      setRacing(false)
    }
  }, [toast])

  // Run full DNS benchmark
  const handleRunBenchmark = useCallback(async () => {
    setBenchmarking(true)
    try {
      const data = await getDnsBenchmark()
      setDnsResults(data.results || [])
      toast('DNS latency benchmark updated', { type: 'success' })
    } catch {
      toast('Failed to run benchmark', { type: 'error' })
    } finally {
      setBenchmarking(false)
    }
  }, [toast])

  if (!open) return null

  const leaderboard = resolverData?.leaderboard || []
  const fastest = leaderboard[0]

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="speedtest-modal-title"
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-lg bg-[var(--surface)] border border-[var(--strong-border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-2)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[var(--surface-3)] border border-[var(--border)] flex items-center justify-center text-[var(--text)]">
              <Zap className="w-4 h-4 text-[var(--text)]" />
            </div>
            <div>
              <h2 id="speedtest-modal-title" className="text-sm font-semibold text-[var(--text)] tracking-tight flex items-center gap-2">
                <span>DNS Speed Race & Latency Benchmark</span>
              </h2>
              <p className="text-[11px] text-[var(--muted)] mt-0.5">
                Multi-hop resolver race and response time telemetry
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close benchmark modal"
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center border-b border-[var(--border)] px-5 pt-2 bg-[var(--surface-2)] gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('race')}
            className={`pb-2.5 px-2 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
              activeTab === 'race'
                ? 'border-[var(--text)] text-[var(--text)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Upstream Race Engine</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('benchmark')}
            className={`pb-2.5 px-2 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
              activeTab === 'benchmark'
                ? 'border-[var(--text)] text-[var(--text)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <Gauge className="w-3.5 h-3.5" />
            <span>Cache vs Public DNS</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-5 overflow-y-auto space-y-4">

          {/* TAB 1: UPSTREAM RESOLVER RACE */}
          {activeTab === 'race' && (
            <div className="space-y-4">
              {/* Winner Announcement Card */}
              {fastest && (
                <div className="p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[var(--green-bg)] border border-[var(--green)]/30 flex items-center justify-center text-[var(--green)] shrink-0">
                      <Trophy className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-[var(--muted)] tracking-wider">Fastest Live Resolver</div>
                      <div className="text-sm font-bold text-[var(--text)] flex items-center gap-2">
                        <span>{fastest.name}</span>
                        <span className="text-xs font-mono text-[var(--green)] font-semibold">
                          {fastest.liveLatencyMs.toFixed(1)} ms
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--muted)] font-mono mt-0.5">
                        {fastest.protocol} · {fastest.host}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleTriggerRace}
                    disabled={racing}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--fg)] text-[var(--bg)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${racing ? 'animate-spin' : ''}`} />
                    <span>Run Race</span>
                  </button>
                </div>
              )}

              {/* Leaderboard List */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  Live Probe Leaderboard
                </div>

                {leaderboard.map((prov, idx) => {
                  const isWinner = idx === 0
                  return (
                    <div
                      key={prov.id}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                        isWinner
                          ? 'bg-[var(--surface-2)] border-[var(--green)]/40 shadow-xs'
                          : 'bg-[var(--surface-2)] border-[var(--border)]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                          isWinner
                            ? 'bg-[var(--green-bg)] text-[var(--green)] border border-[var(--green)]/30'
                            : 'bg-[var(--surface-3)] text-[var(--muted)] border border-[var(--border)]'
                        }`}>
                          #{idx + 1}
                        </span>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[var(--text)] truncate">{prov.name}</span>
                            {isWinner && (
                              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[var(--green-bg)] text-[var(--green)] border border-[var(--green)]/30 font-bold">
                                FASTEST
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-[var(--muted)] truncate mt-0.5">
                            {prov.host} · {prov.tag}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className={`text-sm font-mono font-bold ${isWinner ? 'text-[var(--green)]' : 'text-[var(--text)]'}`}>
                          {prov.liveLatencyMs.toFixed(1)} ms
                        </div>
                        <div className="text-[9px] text-[var(--muted)] font-mono">
                          {prov.querySharePct}% share
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Security features tip */}
              <div className="p-3 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl flex items-start gap-2.5 text-xs text-[var(--text-2)]">
                <Shield className="w-4 h-4 text-[var(--green)] shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                  AdGuard Home uses concurrent resolution: queries are distributed to the lowest-latency upstream with DNSSEC cryptographic verification and automatic fallback.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: LOCAL CACHE VS PUBLIC BENCHMARK */}
          {activeTab === 'benchmark' && (
            <div className="space-y-4">
              {/* WiFiman Forwarding Card */}
              <div className="p-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[var(--surface-3)] border border-[var(--border)] flex items-center justify-center text-[var(--text)] shrink-0">
                      <Activity className="w-4.5 h-4.5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-bold text-[var(--text)] tracking-tight">Internet Speed Test (WiFiman)</h3>
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface-3)] text-[var(--muted)] border border-[var(--border)] font-medium">
                          UBIQUITI
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--muted)] mt-0.5 leading-relaxed">
                        Full-bandwidth download/upload speed test and bufferbloat latency testing.
                      </p>
                    </div>
                  </div>
                </div>

                <a
                  href="https://wifiman.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 px-4 rounded-xl bg-[var(--fg)] text-[var(--bg)] text-xs font-semibold transition-all flex items-center justify-center gap-1.5 hover:opacity-90 cursor-pointer"
                >
                  <span>Launch Official WiFiman Speed Test</span>
                  <ArrowUpRight className="w-4 h-4" />
                </a>
              </div>

              {/* DNS Benchmark Leaderboard */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-[var(--text)]">DNS Resolvers Round-Trip Benchmark</span>
                    <p className="text-[11px] text-[var(--muted)] mt-0.5">
                      Local AdGuard RAM cache vs public Anycast resolvers
                    </p>
                  </div>

                  <button
                    onClick={handleRunBenchmark}
                    disabled={benchmarking}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text)] border border-[var(--border)] text-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${benchmarking ? 'animate-spin' : ''}`} />
                    <span>Benchmark</span>
                  </button>
                </div>

                {benchmarking ? (
                  <div className="py-12 text-center text-xs text-[var(--muted)] flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-[var(--text)]" />
                    <span>Testing round-trip latency across resolvers…</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {dnsResults.map((r, idx) => {
                      const isWinner = idx === 0 && r.status === 'ok'
                      const isLocal = r.isLocal

                      return (
                        <div
                          key={r.name}
                          className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                            isWinner
                              ? 'bg-[var(--surface-2)] border-[var(--green)]/40'
                              : 'bg-[var(--surface-2)] border-[var(--border)]'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold ${
                              isWinner
                                ? 'bg-[var(--green-bg)] text-[var(--green)] border border-[var(--green)]/30'
                                : 'bg-[var(--surface-3)] text-[var(--muted)]'
                            }`}>
                              {idx + 1}
                            </span>

                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-[var(--text)]">{r.name}</span>
                                {isLocal && (
                                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface-3)] text-[var(--muted)] border border-[var(--border)]">
                                    LOCAL GATEWAY
                                  </span>
                                )}
                                {isWinner && (
                                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[var(--green-bg)] text-[var(--green)] border border-[var(--green)]/30 font-semibold">
                                    FASTEST
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] font-mono text-[var(--muted)] mt-0.5">
                                {r.host} · {r.provider}
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            {r.status === 'ok' ? (
                              <div className={`text-sm font-mono font-bold ${isWinner ? 'text-[var(--green)]' : 'text-[var(--text)]'}`}>
                                {r.timeMs} ms
                              </div>
                            ) : (
                              <div className="text-xs font-mono text-[var(--red)]">Error</div>
                            )}
                            <div className="text-[9px] text-[var(--muted)] font-mono">
                              round-trip
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
