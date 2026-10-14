import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Sparkles, ShieldCheck, ShieldAlert, AlertTriangle, RefreshCw,
  Send, Bot, User, CheckCircle2, Copy, Check,
  Cpu, HardDrive, Network, Lock, Info, Activity, MessageSquare, Download
} from 'lucide-react'
import {
  getCachedAiReport,
  generateAiReport,
  sendAiChat,
  applyAiRule,
  type AIReportData,
  type AIRecommendation
} from '../api'
import { useToast } from '../contexts/ToastContext'
import { useServer } from '../contexts/ServerContext'
import MarkdownMessage from '../components/MarkdownMessage'
import { usePageTitle } from '../hooks/usePageTitle'

const STARTER_PROMPTS = [
  'Which upstream DNS servers am I using right now?',
  'How fast are my upstream DNS servers performing?',
  'Why is sentry.io generating so many queries?',
  'Are any devices on my LAN acting suspiciously or beaconing?',
  'How do I block Samsung Smart TV telemetry without breaking Netflix?',
  'What custom DNS rules should I add for maximum privacy?'
]

const getTimeString = () =>
  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function AIReport() {
  usePageTitle('DNS Intelligence')
  const { toast } = useToast()
  const { serverVersion, activeServer } = useServer()
  const [activeTab, setActiveTab] = useState<'audit' | 'chat'>('audit')
  const [report, setReport] = useState<AIReportData | null>(null)
  const [loadingAudit, setLoadingAudit] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)

  // Enforced rules tracking
  const [enforcedRules, setEnforcedRules] = useState<Record<string, boolean>>({})
  const [enforcingId, setEnforcingId] = useState<string | null>(null)

  const handleExportBriefing = () => {
    if (!report) return
    const content = `# AdGuard Home AI Security Intelligence Briefing
Date: ${new Date(report.generatedAt || Date.now()).toLocaleString()}
Model: ${report.model || 'Google Gemini'}
Security Score: ${report.securityScore} (${report.securityGrade})
Threat Level: ${report.threatLevel}

## Telemetry Snapshot
- Total 24h Queries: ${report.statsSnapshot?.totalQueries}
- Blocked Requests: ${report.statsSnapshot?.blockedQueries} (${report.statsSnapshot?.blockRate})
- Average Latency: ${report.statsSnapshot?.avgLatencyMs} ms
- Active Monitored Devices: ${report.statsSnapshot?.activeDevices}

## Executive Intelligence Briefing
${report.executiveSummary}

## Top Threat & Tracker Vectors
${(report.topThreatVectors || []).map(v => `- [${v.risk.toUpperCase()}] ${v.domain} (${v.category}): ${v.impact} [Source: ${v.sourceDevice}]`).join('\n')}

## AI Recommended Firewall Rules
${(report.aiRecommendations || []).map(r => `### ${r.title} (${r.severity.toUpperCase()})\n${r.description}\nRule: \`${r.rule || 'N/A'}\`\n`).join('\n')}

## DNS Hygiene Recommendations
${(report.dnsHygieneTips || []).map(t => `- ${t}`).join('\n')}
`
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `adguard-ai-security-briefing-${new Date().toISOString().slice(0, 10)}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast('Intelligence briefing exported as Markdown', { type: 'success' })
  }

  // Chat state
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'model'; text: string; time: string }>>([
    {
      role: 'model',
      text: 'Hello! I am your Antigravity AI Network Copilot powered by Google Gemini. I have direct visibility into your live AdGuard Home telemetry, upstream DNS resolvers, and blocked trackers. Ask me anything about your active DNS servers, client anomalies, or rule optimizations.',
      time: 'Just now'
    }
  ])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  const handleGenerateAudit = useCallback(async () => {
    setLoadingAudit(true)
    setAuditError(null)
    try {
      const res = await generateAiReport()
      if (res.ok && res.report) {
        setReport(res.report)
        toast('AI Security Audit updated successfully', { type: 'success' })
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { details?: string; error?: string } }; message?: string }
      const msg = axiosErr.response?.data?.details || axiosErr.response?.data?.error || (err instanceof Error ? err.message : 'Failed to generate audit')
      setAuditError(msg)
      toast(msg, { type: 'error' })
    } finally {
      setLoadingAudit(false)
    }
  }, [toast])

  // Load cached audit on mount, or trigger first audit if none exists
  useEffect(() => {
    let mounted = true
    getCachedAiReport()
      .then(res => {
        if (mounted && res.report) {
          setReport(res.report)
        } else if (mounted) {
          handleGenerateAudit()
        }
      })
      .catch(() => {
        if (mounted) handleGenerateAudit()
      })
    return () => { mounted = false }
  }, [handleGenerateAudit, serverVersion])

  useEffect(() => {
    if (activeTab === 'chat') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, activeTab])

  const handleEnforceRule = async (rec: AIRecommendation) => {
    if (!rec.rule) return
    setEnforcingId(rec.id)
    try {
      await applyAiRule(rec.rule)
      setEnforcedRules(prev => ({ ...prev, [rec.id]: true }))
      toast(`Rule enforced: ${rec.rule}`, { type: 'success' })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to enforce rule'
      toast(`Failed to enforce rule: ${msg}`, { type: 'error' })
    } finally {
      setEnforcingId(null)
    }
  }

  const handleSendChat = async (promptText?: string) => {
    const textToSend = (promptText || chatInput).trim()
    if (!textToSend || chatLoading) return

    const userMsg = {
      role: 'user' as const,
      text: textToSend,
      time: getTimeString()
    }

    setMessages(prev => [...prev, userMsg])
    if (!promptText) setChatInput('')
    setChatLoading(true)

    try {
      const history = messages.map(m => ({ role: m.role, text: m.text }))
      const res = await sendAiChat(textToSend, history)
      if (res.ok && res.reply) {
        setMessages(prev => [
          ...prev,
          {
            role: 'model',
            text: res.reply,
            time: getTimeString()
          }
        ])
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { details?: string; error?: string } }; message?: string }
      const errReply = axiosErr.response?.data?.details || axiosErr.response?.data?.error || (err instanceof Error ? err.message : 'Network error while contacting Gemini.')
      setMessages(prev => [
        ...prev,
        {
          role: 'model',
          text: `⚠️ **Error:** ${errReply}`,
          time: getTimeString()
        }
      ])
    } finally {
      setChatLoading(false)
    }
  }

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIndex(idx)
    setTimeout(() => setCopiedIndex(null), 2000)
    toast('Copied to clipboard', { type: 'info' })
  }

  // Visual grade color resolver
  const getGradeColor = (grade: string = 'B') => {
    if (grade.startsWith('A')) return 'text-[var(--text-primary)] border-[var(--border-strong)] bg-[var(--bg-active)]'
    if (grade.startsWith('B')) return 'text-[var(--text-primary)] border-[var(--border)] bg-[var(--bg-surface)]'
    if (grade.startsWith('C')) return 'text-[var(--text-secondary)] border-[var(--border)] bg-[var(--bg-surface)]'
    return 'text-[var(--text-primary)] border-[var(--border-strong)] bg-[var(--bg-active)]'
  }

  const getThreatBadge = (level: string = 'LOW') => {
    switch (level.toUpperCase()) {
      case 'CRITICAL':
      case 'HIGH':
        return { text: 'HIGH RISK', class: 'bg-[var(--bg-active)] text-[var(--text-primary)] border-[var(--border-strong)] font-semibold' }
      case 'ELEVATED':
        return { text: 'ELEVATED', class: 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)] font-medium' }
      case 'GUARDED':
      case 'MODERATE':
        return { text: 'GUARDED', class: 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)]' }
      default:
        return { text: 'LOW RISK', class: 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border-subtle)]' }
    }
  }

  const getSeverityBadge = (sev: string = 'low') => {
    switch (sev.toLowerCase()) {
      case 'critical':
      case 'high':
        return 'bg-[var(--bg-active)] text-[var(--text-primary)] border-[var(--border-strong)] font-semibold'
      case 'medium':
        return 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)]'
      default:
        return 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border-subtle)]'
    }
  }

  return (
    <div className="space-y-6 text-[var(--text)]">
      {/* ── Page Heading matching sample.html (Desktop) ── */}
      <section className="page-heading hidden sm:flex">
        <div>
          <h1>DNS Intelligence</h1>
          <div className="subtitle">
            Automated heuristic threat assessment, anomalous lookup detection, and rule enforcement engine.
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs text-[var(--muted)] font-mono">
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] font-semibold text-[10.5px]">
              <ShieldCheck className="w-3 h-3 text-[var(--text)]" />
              Automated Intelligence
            </span>
            <span>·</span>
            <span>Node: {activeServer?.name || 'Local'}</span>
            <span>·</span>
            <span>Model: {report?.model || 'Gemini Flash'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* View Mode Toggle */}
          <div className="flex items-center p-0.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-[9px] text-xs">
            <button
              onClick={() => setActiveTab('audit')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'audit'
                  ? 'bg-[var(--surface-3)] text-[var(--text)] shadow-xs'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Security Audit</span>
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'chat'
                  ? 'bg-[var(--surface-3)] text-[var(--text)] shadow-xs'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Copilot Chat</span>
            </button>
          </div>

          {report && (
            <button
              onClick={handleExportBriefing}
              className="secondary-btn"
              title="Export intelligence briefing as Markdown"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export Briefing</span>
            </button>
          )}

          <button
            onClick={handleGenerateAudit}
            disabled={loadingAudit}
            className="primary-btn"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingAudit ? 'animate-spin' : ''}`} />
            <span>{loadingAudit ? 'Auditing Telemetry...' : 'Run Fresh Audit'}</span>
          </button>
        </div>
      </section>

      {/* ── Mobile Tab Segment (X-Style) ── */}
      <div className="sm:hidden space-y-2.5">
        <div className="flex items-center p-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-full text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'audit'
                ? 'bg-[var(--text)] text-[var(--bg)] shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Security Audit</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'chat'
                ? 'bg-[var(--text)] text-[var(--bg)] shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Copilot Chat</span>
          </button>
        </div>

        {activeTab === 'audit' && (
          <button
            type="button"
            onClick={handleGenerateAudit}
            disabled={loadingAudit}
            className="w-full primary-btn !min-h-[38px] flex items-center justify-center gap-2 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingAudit ? 'animate-spin' : ''}`} />
            <span>{loadingAudit ? 'Auditing Telemetry...' : 'Run Fresh AI Audit'}</span>
          </button>
        )}
      </div>

      {auditError && (
        <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)] flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-[var(--text-primary)] shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-[var(--text-primary)]">Audit generation encountered an error:</span> {auditError}
          </div>
          <button
            onClick={handleGenerateAudit}
            className="text-[11px] underline hover:text-[var(--text-primary)] cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── TAB 1: EXECUTIVE SECURITY AUDIT ───────────────────────────────── */}
      {activeTab === 'audit' && (
        <div className="space-y-6">
          {/* Hero Scoreboard */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Health Score & Grade Card */}
            <div className="md:col-span-4 p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] relative overflow-hidden flex flex-col justify-between group hover:border-[var(--border-strong)] transition-all">
              <div>
                <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)] mb-2">
                  <span className="font-medium tracking-tight">Security Posture Grade</span>
                  {report && (
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${getThreatBadge(report.threatLevel).class}`}>
                      {getThreatBadge(report.threatLevel).text}
                    </span>
                  )}
                </div>

                <div className="flex items-baseline gap-4 mt-2">
                  <div className={`text-5xl font-black tracking-tight font-mono px-3 py-1 rounded-xl border ${getGradeColor(report?.securityGrade)}`}>
                    {loadingAudit ? '—' : (report?.securityGrade || 'A')}
                  </div>
                  <div>
                    <div className="text-2xl font-bold font-mono text-[var(--text-primary)] tabular-nums">
                      {loadingAudit ? '...' : (report?.securityScore ?? 90)}
                      <span className="text-xs text-[var(--text-muted)] font-normal"> / 100</span>
                    </div>
                    <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                      AdGuard Hygiene Index
                    </div>
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mt-5 space-y-1.5">
                <div className="w-full bg-[var(--border-subtle)] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--text-primary)] rounded-full transition-all duration-700"
                    style={{ width: `${loadingAudit ? 40 : (report?.securityScore ?? 90)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-[var(--text-muted)]">
                  <span>Defensive Coverage</span>
                  <span>{loadingAudit ? 'Calculating...' : `${report?.securityScore ?? 90}% Optimal`}</span>
                </div>
              </div>
            </div>

            {/* Telemetry Stats Matrix */}
            <div className="md:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] flex flex-col justify-between">
                <div className="text-[11px] text-[var(--text-tertiary)] flex items-center justify-between">
                  <span>24h Queries</span>
                  <Activity className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                </div>
                <div className="mt-2 text-xl font-bold font-mono text-[var(--text-primary)] tabular-nums">
                  {report?.statsSnapshot?.totalQueries.toLocaleString() ?? '—'}
                </div>
                <div className="text-[10px] text-[var(--text-muted)]">Total gateway queries</div>
              </div>

              <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] flex flex-col justify-between">
                <div className="text-[11px] text-[var(--text-tertiary)] flex items-center justify-between">
                  <span>Blocked Trackers</span>
                  <ShieldCheck className="w-3.5 h-3.5 text-[var(--text-primary)]" />
                </div>
                <div className="mt-2 text-xl font-bold font-mono text-[var(--text-primary)] tabular-nums">
                  {report?.statsSnapshot?.blockedQueries.toLocaleString() ?? '—'}
                </div>
                <div className="text-[10px] text-[var(--text-tertiary)] font-mono">
                  {report?.statsSnapshot?.blockRate ?? '—'} block rate
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] flex flex-col justify-between">
                <div className="text-[11px] text-[var(--text-tertiary)] flex items-center justify-between">
                  <span>Active Clients</span>
                  <HardDrive className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                </div>
                <div className="mt-2 text-xl font-bold font-mono text-[var(--text-primary)] tabular-nums">
                  {report?.statsSnapshot?.activeDevices ?? '—'}
                </div>
                <div className="text-[10px] text-[var(--text-muted)]">LAN endpoints analyzed</div>
              </div>

              <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] flex flex-col justify-between">
                <div className="text-[11px] text-[var(--text-tertiary)] flex items-center justify-between">
                  <span>Avg Latency</span>
                  <Cpu className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                </div>
                <div className="mt-2 text-xl font-bold font-mono text-[var(--text-primary)] tabular-nums">
                  {report?.statsSnapshot?.avgLatencyMs ?? '—'}
                  <span className="text-xs text-[var(--text-muted)] font-normal"> ms</span>
                </div>
                <div className="text-[10px] text-[var(--text-muted)]">DNS upstream lookup</div>
              </div>
            </div>
          </div>

          {/* Executive Intelligence Briefing */}
          <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] space-y-3 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] flex items-center gap-2">
                <Bot className="w-4 h-4 text-[var(--text-primary)]" />
                Executive Intelligence Briefing
              </h2>
              {report?.generatedAt && (
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  Generated {new Date(report.generatedAt).toLocaleTimeString()}
                </span>
              )}
            </div>

            {loadingAudit ? (
              <div className="py-8 flex flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
                <RefreshCw className="w-5 h-5 animate-spin text-[var(--text-primary)]" />
                <span className="text-xs font-mono">Synthesizing network telemetry...</span>
              </div>
            ) : (
              <div className="text-xs leading-relaxed text-[var(--text-secondary)]">
                <MarkdownMessage content={report?.executiveSummary || 'No audit generated yet. Click "Run Fresh Audit" above.'} />
              </div>
            )}
          </div>

          {/* Two-Column: Top Threat Vectors & Client Risk Analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Top Threat & Telemetry Vectors */}
            <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-[var(--text-primary)]" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Active Threat & Tracker Vectors
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  {report?.topThreatVectors?.length || 0} identified
                </span>
              </div>

              <div className="space-y-3">
                {(report?.topThreatVectors || []).map((vector, i) => (
                  <div
                    key={i}
                    className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-colors space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider">
                          {vector.category}
                        </span>
                        <div className="text-xs font-mono font-semibold text-[var(--text-primary)] break-all">
                          {vector.domain}
                        </div>
                      </div>
                      <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border shrink-0 ${getSeverityBadge(vector.risk)}`}>
                        {vector.risk}
                      </span>
                    </div>

                    <p className="text-[11px] text-[var(--text-tertiary)] leading-snug">
                      {vector.impact}
                    </p>

                    <div className="flex items-center justify-between pt-1 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)]">
                      <span>Source: <span className="font-mono text-[var(--text-secondary)]">{vector.sourceDevice || 'Gateway'}</span></span>
                      {vector.evidence && <span>{vector.evidence}</span>}
                    </div>
                  </div>
                ))}
                {(!report?.topThreatVectors || report.topThreatVectors.length === 0) && !loadingAudit && (
                  <div className="text-center py-6 text-xs text-[var(--text-muted)]">
                    No critical threat vectors detected. Network is clean.
                  </div>
                )}
              </div>
            </div>

            {/* Client Risk & Behavior Analysis */}
            <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                <div className="flex items-center gap-2">
                  <Network className="w-4 h-4 text-[var(--text-primary)]" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Device Risk & Behavior Profiler
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  {report?.clientRiskAnalysis?.length || 0} devices
                </span>
              </div>

              <div className="space-y-3">
                {(report?.clientRiskAnalysis || []).map((client, i) => (
                  <div
                    key={i}
                    className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-colors space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-lg flex items-center justify-center font-mono font-bold text-xs border ${getGradeColor(client.riskGrade)}`}>
                          {client.riskGrade}
                        </span>
                        <div>
                          <div className="text-xs font-semibold text-[var(--text-primary)]">
                            {client.clientName || 'Unknown Device'}
                          </div>
                          <div className="text-[10px] font-mono text-[var(--text-muted)]">
                            {client.clientIp}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="text-[11px] text-[var(--text-tertiary)] leading-snug">
                      <strong className="text-[var(--text-secondary)] font-medium">Activity:</strong> {client.dominantBehavior}
                    </div>

                    {client.anomaly && (
                      <div className="text-[11px] text-[var(--text-primary)] bg-[var(--bg-active)] border border-[var(--border-strong)] p-2 rounded-lg font-medium">
                        <strong>Observed:</strong> {client.anomaly}
                      </div>
                    )}

                    <div className="text-[11px] text-[var(--text-primary)] pt-1 border-t border-[var(--border-subtle)]">
                      <strong>Recommendation:</strong> {client.actionRecommended}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* AI Recommendations & 1-Click Enforcement */}
          <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-[var(--text-secondary)]" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  AI Hardening Recommendations & 1-Click Enforcement
                </h3>
              </div>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                Direct integration with AdGuard User Rules
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(report?.aiRecommendations || []).map((rec) => {
                const isEnforced = enforcedRules[rec.id]
                const isEnforcing = enforcingId === rec.id

                return (
                  <div
                    key={rec.id}
                    className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-all flex flex-col justify-between space-y-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-[var(--text-primary)]">
                          {rec.title}
                        </span>
                        <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border shrink-0 ${getSeverityBadge(rec.severity)}`}>
                          {rec.severity}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--text-tertiary)] leading-snug">
                        {rec.description}
                      </p>
                    </div>

                    {rec.rule && (
                      <div className="p-2 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] flex items-center justify-between gap-2">
                        <code className="text-[11px] font-mono text-[var(--text-primary)] break-all select-all">
                          {rec.rule}
                        </code>
                        <button
                          onClick={() => handleCopy(rec.rule!, 999)}
                          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 cursor-pointer"
                          title="Copy rule"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)]">
                      <span className="text-[10px] text-[var(--text-muted)]">
                        Benefit: <span className="text-[var(--text-secondary)]">{rec.impact}</span>
                      </span>

                      {rec.rule ? (
                        <button
                          onClick={() => handleEnforceRule(rec)}
                          disabled={isEnforced || isEnforcing}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                            isEnforced
                              ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)] cursor-default font-semibold'
                              : 'bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover-bg)] text-[var(--btn-primary-text)] border border-[var(--btn-primary-border)] shadow-xs'
                          }`}
                        >
                          {isEnforced ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Enforced</span>
                            </>
                          ) : (
                            <>
                              <ShieldCheck className={`w-3.5 h-3.5 ${isEnforcing ? 'animate-spin' : ''}`} />
                              <span>{isEnforcing ? 'Applying...' : 'Enforce Rule'}</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
                          Policy Advice
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Proactive DNS Hygiene Checklist */}
          {report?.dnsHygieneTips && report.dnsHygieneTips.length > 0 && (
            <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] flex items-center gap-2">
                <Info className="w-4 h-4 text-[var(--text-primary)]" />
                Proactive Network Hygiene Matrix
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {report.dnsHygieneTips.map((tip, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] flex items-start gap-2.5"
                  >
                    <CheckCircle2 className="w-4 h-4 text-[var(--text-primary)] shrink-0 mt-0.5" />
                    <span>{tip}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: INTERACTIVE AI NETWORK COPILOT (CHAT) ─────────────────── */}
      {activeTab === 'chat' && (
        <div className="flex flex-col h-[700px] rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden">
          {/* Chat Header */}
          <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-primary)]">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <span>Antigravity AI Copilot</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-primary)]" />
                </div>
                <div className="text-[10px] text-[var(--text-tertiary)]">
                  Live DNS Telemetry Synced · Google Gemini
                </div>
              </div>
            </div>

            <button
              onClick={() => setMessages([{
                role: 'model',
                text: 'Chat history reset. How can I assist with your DNS rules or network security?',
                time: getTimeString()
              }])}
              className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              Clear Conversation
            </button>
          </div>

          {/* Quick Starter Chips */}
          <div className="px-5 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="text-[10px] font-mono uppercase text-[var(--text-muted)] shrink-0">Ask Copilot:</span>
            {STARTER_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                onClick={() => handleSendChat(prompt)}
                disabled={chatLoading}
                className="shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] border border-[var(--border)] text-[var(--text-secondary)] transition-all text-left whitespace-nowrap cursor-pointer"
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Message Stream */}
          <div className="flex-1 p-5 overflow-y-auto space-y-4">
            {messages.map((m, idx) => {
              const isUser = m.role === 'user'
              return (
                <div
                  key={idx}
                  className={`flex gap-3 max-w-3xl ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
                >
                  <div className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center text-xs ${
                    isUser
                      ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)]'
                      : 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)]'
                  }`}>
                    {isUser ? <User className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                  </div>

                  <div className={`space-y-1.5 ${isUser ? 'items-end text-right' : 'items-start text-left'}`}>
                    <div className={`p-4 rounded-2xl text-xs leading-relaxed ${
                      isUser
                        ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] rounded-tr-none shadow-xs'
                        : 'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded-tl-none space-y-2'
                    }`}>
                      <MarkdownMessage content={m.text} isUser={isUser} />

                      {!isUser && (
                        <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)] mt-2 text-[10px] text-[var(--text-tertiary)]">
                          <span>{m.time}</span>
                          <button
                            onClick={() => handleCopy(m.text, idx)}
                            className="hover:text-[var(--text-primary)] flex items-center gap-1 cursor-pointer"
                          >
                            {copiedIndex === idx ? (
                              <>
                                <Check className="w-3 h-3 text-[var(--text-primary)]" />
                                <span className="text-[var(--text-primary)] font-medium">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}

            {chatLoading && (
              <div className="flex gap-3 max-w-xl mr-auto">
                <div className="w-7 h-7 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-primary)]">
                  <Sparkles className="w-3.5 h-3.5 animate-spin" />
                </div>
                <div className="p-3.5 rounded-2xl rounded-tl-none bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text-tertiary)] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--text-primary)] animate-ping" />
                  Gemini is thinking...
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Chat Input Bar */}
          <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleSendChat()
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask Gemini about rules, telemetry, IoT trackers, or security posture..."
                disabled={chatLoading}
                className="flex-1 bg-[var(--bg-base)] border border-[var(--border)] hover:border-[var(--border-strong)] focus:border-[var(--border-strong)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-all"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || chatLoading}
                className="px-4 py-2.5 rounded-xl bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover-bg)] text-[var(--btn-primary-text)] border border-[var(--btn-primary-border)] font-medium text-xs flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-xs cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
