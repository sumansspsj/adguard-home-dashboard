import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Monitor, Globe, LayoutDashboard, Radio, BarChart2, Shield, Settings, Zap, X } from 'lucide-react'

interface Action {
  id: string
  label: string
  sub?: string
  icon: React.ReactNode
  onSelect: () => void
  category: string
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  clients: { name: string; ip: string }[]
  topDomains: [string, number][]
  onProtectionToggle: () => void
}

export default function CommandPalette({ open, onClose, clients, topDomains, onProtectionToggle }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [prevOpen, setPrevOpen] = useState(open)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setQuery('')
      setSelected(0)
    }
  }

  const nav = (path: string) => { navigate(path); onClose() }

  const baseActions: Action[] = [
    { id: 'overview', label: 'Overview', sub: 'Executive dashboard & live pulse', icon: <LayoutDashboard className="w-4 h-4" />, onSelect: () => nav('/'), category: 'Navigation' },
    { id: 'analytics', label: 'Analytics & Benchmarks', sub: 'Latency profiler, resolver race & query velocity', icon: <BarChart2 className="w-4 h-4" />, onSelect: () => nav('/?tab=analytics'), category: 'Navigation' },
    { id: 'live', label: 'Live DNS', sub: 'Real-time query stream & inspector', icon: <Radio className="w-4 h-4" />, onSelect: () => nav('/live'), category: 'Navigation' },
    { id: 'clients', label: 'Clients', sub: 'All network devices & fleet roster', icon: <Monitor className="w-4 h-4" />, onSelect: () => nav('/clients'), category: 'Navigation' },
    { id: 'security', label: 'Security & Rules', sub: 'Blocked services & firewall policies', icon: <Shield className="w-4 h-4" />, onSelect: () => nav('/security'), category: 'Navigation' },
    { id: 'domains', label: 'Domain Destinations & Geo', sub: 'Country mapping & top domains directory', icon: <Globe className="w-4 h-4" />, onSelect: () => nav('/security?tab=domains'), category: 'Navigation' },
    { id: 'rules', label: 'DNS Firewall Rules', sub: 'Custom allowlist and denylist rules editor', icon: <Shield className="w-4 h-4" />, onSelect: () => nav('/security?tab=rules'), category: 'Navigation' },
    { id: 'settings', label: 'Settings', sub: 'System runtime & node cluster configuration', icon: <Settings className="w-4 h-4" />, onSelect: () => nav('/settings'), category: 'Navigation' },
    { id: 'ai-report', label: 'AI Security Intelligence', sub: 'Gemini security audit, threat copilot & rule generation', icon: <Zap className="w-4 h-4" />, onSelect: () => nav('/settings?tab=intelligence'), category: 'Navigation' },
    { id: 'toggle', label: 'Toggle Protection', sub: 'Enable or disable DNS filtering', icon: <Zap className="w-4 h-4" />, onSelect: () => { onProtectionToggle(); onClose() }, category: 'Actions' },
  ]

  const clientActions: Action[] = clients.map(c => ({
    id: `client-${c.ip}`,
    label: c.name || c.ip,
    sub: c.ip,
    icon: <Monitor className="w-4 h-4" />,
    onSelect: () => nav(`/clients/${encodeURIComponent(c.ip)}`),
    category: 'Clients',
  }))

  const domainActions: Action[] = topDomains.slice(0, 8).map(([d, count]) => ({
    id: `domain-${d}`,
    label: d,
    sub: `${count.toLocaleString()} queries — view in Live DNS`,
    icon: <Globe className="w-4 h-4" />,
    onSelect: () => nav(`/live?search=${encodeURIComponent(d)}`),
    category: 'Recent Domains',
  }))

  const allActions = [...baseActions, ...clientActions, ...domainActions]

  const filtered = query.trim()
    ? allActions.filter(a =>
        a.label.toLowerCase().includes(query.toLowerCase()) ||
        (a.sub?.toLowerCase().includes(query.toLowerCase())) ||
        a.category.toLowerCase().includes(query.toLowerCase())
      )
    : allActions

  // Group by category
  const grouped: Record<string, Action[]> = {}
  filtered.forEach(a => {
    if (!grouped[a.category]) grouped[a.category] = []
    grouped[a.category].push(a)
  })

  // Flat list for keyboard navigation
  const flat = Object.values(grouped).flat()

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [open])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!open) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, flat.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
      if (e.key === 'Enter' && flat[selected]) { flat[selected].onSelect() }
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, flat, selected, onClose])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[100] bg-[var(--bg-overlay)] backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <div className="fixed inset-0 z-[101] flex items-start justify-center pt-[15vh] pointer-events-none">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Command search palette"
              initial={{ opacity: 0, scale: 0.97, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -8 }}
              transition={{ duration: 0.15 }}
              className="pointer-events-auto w-full max-w-lg bg-[var(--bg-elevated)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border)]">
                <Search className="w-4 h-4 text-[var(--text-muted)] shrink-0" aria-hidden="true" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => {
                    setQuery(e.target.value)
                    setSelected(0)
                  }}
                  placeholder="Search pages, clients, domains…"
                  aria-label="Search pages, clients, domains"
                  className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                />
                <button
                  onClick={onClose}
                  aria-label="Close command palette"
                  className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Results */}
              <div className="max-h-96 overflow-y-auto py-2">
                {flat.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">No results for "{query}"</div>
                ) : (
                  Object.entries(grouped).map(([category, actions]) => (
                    <div key={category}>
                      <div className="px-4 py-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
                        {category}
                      </div>
                      {actions.map(action => {
                        const isSelected = flat[selected]?.id === action.id
                        return (
                          <button
                            key={action.id}
                            onClick={action.onSelect}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                              isSelected
                                ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                            }`}
                          >
                            <span className={`shrink-0 ${isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                              {action.icon}
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{action.label}</div>
                              {action.sub && <div className="text-xs text-[var(--text-muted)] truncate">{action.sub}</div>}
                            </div>
                            {isSelected && <span className="ml-auto text-xs text-[var(--text-muted)]">↵</span>}
                          </button>
                        )
                      })}
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center gap-4 px-4 py-2 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)]">
                <span>↑↓ Navigate</span>
                <span>↵ Open</span>
                <span>Esc Close</span>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
