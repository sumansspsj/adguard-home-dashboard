import { useState } from 'react'
import { Server, Wifi, Check, AlertCircle, Loader2, X, Globe } from 'lucide-react'
import { getBackendHost, setBackendBaseUrl } from '../api'
import axios from 'axios'

interface BackendConfigModalProps {
  open: boolean
  onClose: () => void
  onSaved?: () => void
}

export default function BackendConfigModal({ open, onClose, onSaved }: BackendConfigModalProps) {
  const [url, setUrl] = useState(() => getBackendHost())
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setUrl(getBackendHost())
      setTestResult(null)
    }
  }

  if (!open) return null

  const handleTest = async () => {
    const clean = url.trim().replace(/\/+$/, '')
    if (!clean) return
    setTesting(true)
    setTestResult(null)

    const start = Date.now()
    try {
      const res = await axios.get(`${clean}/api/health`, { timeout: 4500 })
      const latency = Date.now() - start
      if (res.data?.ok) {
        setTestResult({ ok: true, latencyMs: latency })
      } else {
        setTestResult({ ok: false, error: 'Gateway returned an unexpected response format.' })
      }
    } catch (err: unknown) {
      let message = 'Connection failed'
      if (axios.isAxiosError(err)) {
        if (!err.response) {
          message = `Cannot reach gateway at ${clean}. Verify that the backend server is running and accessible.`
        } else {
          message = `Gateway error (${err.response.status}): ${err.response.data?.error || err.message}`
        }
      } else if (err instanceof Error) {
        message = err.message
      }
      setTestResult({ ok: false, error: message })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = () => {
    setSaving(true)
    const clean = url.trim().replace(/\/+$/, '')
    setBackendBaseUrl(clean)
    setSaving(false)
    if (onSaved) onSaved()
    onClose()
    window.location.reload()
  }

  const handleResetDefault = () => {
    setBackendBaseUrl('')
    setUrl(typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'http://localhost:8080')
    setTestResult(null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--bg-overlay)] backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--shadow-xl)] w-full max-w-md p-6 animate-scale-in text-[var(--text)] relative">
        <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-[var(--text)]">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-[var(--text)]">
                Dashboard Gateway Connection
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Web &amp; Remote API Gateway Configuration
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] uppercase font-bold tracking-wider text-[var(--muted)] mb-1.5">
              Gateway Server URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:8080"
              className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--muted)] font-mono focus:outline-hidden focus:border-[var(--text)] transition-colors"
            />

            {/* Quick Presets */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[10px] text-[var(--muted)] uppercase font-semibold mr-1">Presets:</span>
              <button
                type="button"
                onClick={() => setUrl(typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173')}
                className="text-[11px] font-mono px-2 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] hover:border-[var(--strong-border)] cursor-pointer"
              >
                Current Host (Default)
              </button>
              <button
                type="button"
                onClick={() => setUrl('http://localhost:8080')}
                className="text-[11px] font-mono px-2 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--strong-border)] cursor-pointer"
              >
                localhost:8080
              </button>
            </div>

            <div className="mt-2.5 p-2.5 rounded-lg bg-[var(--surface-2)]/60 border border-[var(--border)] text-[11px] text-[var(--muted)] space-y-1">
              <p className="flex items-center gap-1.5 text-[var(--text)] font-semibold">
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span>How this works:</span>
              </p>
              <p>
                • <b>Dashboard Gateway</b>: Runs the Node.js API server to proxy AdGuard Home requests and provide real-time telemetry.
              </p>
              <p>
                • <b>Standard Web Mode</b>: In standard deployments, requests route directly to the host serving this dashboard. Override this URL only when hosting the UI and API on separate machines.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--text)] flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-[var(--muted)]" />
                Network Diagnostics
              </span>
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="secondary-btn text-xs py-1 px-2.5 flex items-center gap-1.5 cursor-pointer"
              >
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Test Reachability'}
              </button>
            </div>

            {testResult && (
              <div
                className={`p-2.5 rounded-md border text-xs ${
                  testResult.ok
                    ? 'bg-[var(--surface-2)] border-[var(--strong-border)] text-[var(--text)]'
                    : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]'
                }`}
              >
                {testResult.ok ? (
                  <div className="flex items-center justify-between font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" />
                      Gateway Reachable &amp; Online
                    </span>
                    <span className="font-mono text-[11px]">{testResult.latencyMs}ms</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{testResult.error || 'Server unreachable at this address'}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={handleResetDefault}
              className="text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              Reset to default
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="secondary-btn text-xs py-2 px-3.5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="primary-btn text-xs py-2 px-4 flex items-center gap-1.5 cursor-pointer"
              >
                <Server className="w-3.5 h-3.5" />
                <span>Save &amp; Connect</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
