import { useState, useEffect } from 'react'
import { X, Server, Check, AlertCircle, Loader2, Wifi, Shield } from 'lucide-react'
import { testServerConnection, addServer, updateServer, getBackendBaseUrl, type ServerTestResult } from '../api'
import { useServer } from '../contexts/ServerContext'
import { useToast } from '../contexts/ToastContext'
import axios from 'axios'

export default function ServerModal() {
  const { isModalOpen, closeServerModal, editingServer, refreshServers, switchActiveServer } = useServer()
  const { toast } = useToast()

  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [autoSwitch, setAutoSwitch] = useState(true)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ServerTestResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editingServer) {
      setName(editingServer.name || '')
      setHost(editingServer.host || '')
      setUsername(editingServer.username || '')
      setPassword('')
      setAutoSwitch(false)
    } else {
      setName('')
      setHost('')
      setUsername('admin')
      setPassword('')
      setAutoSwitch(true)
    }
    setTestResult(null)
    setError(null)
  }, [editingServer, isModalOpen])

  if (!isModalOpen) return null

  const handleTest = async () => {
    if (!host.trim()) {
      setError('Host URL is required (e.g. http://192.168.1.115:80)')
      return
    }
    setError(null)
    setTesting(true)
    setTestResult(null)

    try {
      const res = await testServerConnection({
        host: host.trim(),
        username: username.trim(),
        password: password,
      })
      setTestResult(res)
    } catch (err: unknown) {
      let message = 'Connection test failed'
      if (axios.isAxiosError(err)) {
        if (!err.response) {
          message = `Cannot reach Dashboard Gateway (${getBackendBaseUrl()}). Verify your PC server is running and both devices are on the same Wi-Fi.`
        } else {
          message = err.response.data?.error || err.message
        }
      } else if (err instanceof Error) {
        message = err.message
      }
      setTestResult({
        ok: false,
        latencyMs: 0,
        error: message,
      })
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!host.trim()) {
      setError('Host URL is required')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      if (editingServer) {
        const payload: { name?: string; host?: string; username?: string; password?: string } = {
          name: name.trim() || undefined,
          host: host.trim(),
          username: username.trim(),
        }
        if (password) {
          payload.password = password
        }
        await updateServer(editingServer.id, payload)
        toast('Server configuration updated', { type: 'success' })
        await refreshServers()
        closeServerModal()
      } else {
        let defaultHostLabel = host.trim()
        try {
          const u = new URL(host.trim().startsWith('http') ? host.trim() : `http://${host.trim()}`)
          defaultHostLabel = u.hostname || host.trim()
        } catch {
          // fallback to raw host
        }
        const res = await addServer({
          name: name.trim() || `Node (${defaultHostLabel})`,
          host: host.trim(),
          username: username.trim(),
          password,
          autoSwitch,
        })
        toast(`Server ${res.server.name} added successfully`, { type: 'success' })
        await refreshServers()
        if (autoSwitch) {
          await switchActiveServer(res.server.id)
        }
        closeServerModal()
      }
    } catch (err: unknown) {
      let message = 'Failed to save server'
      if (axios.isAxiosError(err)) {
        if (!err.response) {
          message = `Cannot reach Dashboard Gateway (${getBackendBaseUrl()}). Verify your PC server is running and both devices are on the same Wi-Fi.`
        } else {
          message = err.response.data?.error || err.message
        }
      } else if (err instanceof Error) {
        message = err.message
      }
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--bg-overlay)] backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeServerModal()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="server-modal-title"
    >
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--shadow-xl)] w-full max-w-lg p-6 animate-scale-in text-[var(--text)] relative max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 mb-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-[var(--text)]">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h2 id="server-modal-title" className="text-base font-bold tracking-tight text-[var(--text)]">
                {editingServer ? 'Edit AdGuard Home Instance' : 'Connect AdGuard Home Instance'}
              </h2>
              <p className="text-xs text-[var(--muted)]">
                {editingServer
                  ? 'Update connection parameters or credentials'
                  : 'Add a new primary or secondary DNS gateway node'}
              </p>
            </div>
          </div>
          <button
            onClick={closeServerModal}
            className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--red-bg)] border border-[var(--red)]/30 text-[var(--red)] text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] uppercase font-bold tracking-wider text-[var(--muted)] mb-1.5">
              Node Display Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Primary Gateway, Home Lab, DNS-02"
              className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--muted)] focus:outline-hidden focus:border-[var(--text)] transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase font-bold tracking-wider text-[var(--muted)] mb-1.5">
              Host URL <span className="text-[var(--text)]">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="http://192.168.1.115:80 or https://dns.local"
                required
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--muted)] focus:outline-hidden focus:border-[var(--text)] transition-colors font-mono"
              />
            </div>
            <p className="text-[11px] text-[var(--muted)] mt-1">
              Include protocol and port if non-standard (e.g. <code>http://192.168.1.100:80</code> or <code>http://10.0.0.1:3000</code>)
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] uppercase font-bold tracking-wider text-[var(--muted)] mb-1.5">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--muted)] focus:outline-hidden focus:border-[var(--text)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase font-bold tracking-wider text-[var(--muted)] mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={editingServer?.hasPassword ? '•••••••• (leave blank to keep)' : 'Password'}
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--muted)] focus:outline-hidden focus:border-[var(--text)] transition-colors"
              />
            </div>
          </div>

          {!editingServer && (
            <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoSwitch}
                onChange={(e) => setAutoSwitch(e.target.checked)}
                className="w-4 h-4 rounded border-[var(--border)] text-[var(--text)] accent-white cursor-pointer"
              />
              <span className="text-xs text-[var(--text-2)]">
                Switch to this server immediately after saving
              </span>
            </label>
          )}

          {/* Connection Test Section */}
          <div className="p-3.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--text)] flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-[var(--muted)]" />
                Connection Diagnostics
              </span>
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="secondary-btn text-xs py-1 px-2.5 flex items-center gap-1.5"
              >
                {testing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test Connection'
                )}
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
                  <div className="space-y-1">
                    <div className="flex items-center justify-between font-semibold">
                      <span className="flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5" />
                        Connected Successfully
                      </span>
                      <span className="font-mono text-[11px]">{testResult.latencyMs}ms</span>
                    </div>
                    {testResult.data && (
                      <div className="text-[11px] opacity-90 flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5">
                        <span>Version: <b>{testResult.data.version}</b></span>
                        <span>DNS Port: <b>{testResult.data.dns_port}</b></span>
                        <span>
                          Protection: <b>{testResult.data.protection_enabled ? 'Active' : 'Disabled'}</b>
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Unable to reach node</p>
                      <p className="text-[11px] opacity-90">{testResult.error || 'Connection failed'}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={closeServerModal}
              disabled={submitting}
              className="secondary-btn text-xs py-2 px-4"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="primary-btn text-xs py-2 px-4 flex items-center gap-1.5"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <Shield className="w-3.5 h-3.5" />
              {editingServer ? 'Save Changes' : 'Add Server'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
