import { useState, useRef, useEffect } from 'react'
import { Server, ChevronDown, Check, Plus, Settings, Smartphone } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useServer } from '../contexts/ServerContext'

function safeHost(urlStr?: string): string {
  if (!urlStr) return 'Connected'
  try {
    const u = new URL(urlStr.startsWith('http') ? urlStr : `http://${urlStr}`)
    return u.hostname || urlStr
  } catch {
    return urlStr
  }
}

export default function ServerSwitcher() {
  const { servers, activeServer, switchActiveServer, openServerModal } = useServer()
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleSelect = async (id: string) => {
    if (activeServer?.id === id) {
      setOpen(false)
      return
    }
    await switchActiveServer(id)
    setOpen(false)
  }

  const displayName = activeServer?.name || 'AdGuard Home'
  const displayHost = safeHost(activeServer?.host)

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between gap-2 px-2.5 py-1 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-xs text-[var(--text)] transition-colors select-none focus:outline-hidden cursor-pointer min-w-0"
        aria-label="Switch active AdGuard Home node"
        aria-expanded={open}
      >
        <div className="flex flex-col text-left min-w-0">
          <div className="flex items-center gap-1.5 font-bold text-xs text-[var(--text)] leading-tight">
            <span className="w-2 h-2 rounded-full bg-[var(--green)] shrink-0" />
            <span className="max-w-[110px] sm:max-w-[160px] truncate">{displayName}</span>
            <ChevronDown className={`w-3 h-3 text-[var(--muted)] transition-transform duration-150 shrink-0 ${open ? 'rotate-180' : ''}`} />
          </div>
          <span className="text-[9.5px] font-mono text-[var(--muted)] truncate max-w-[110px] sm:max-w-[160px] leading-tight mt-0.5">
            {activeServer ? `${activeServer.name.split(' ')[0]} • ${displayHost}` : 'Connected'}
          </span>
        </div>
      </button>

      {open && (
        <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1.5 w-72 p-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xl)] z-50 animate-scale-in text-[var(--text)]">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[var(--border)] mb-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--muted)]">
              AdGuard Home Nodes
            </span>
            <span className="text-[10px] font-mono text-[var(--muted)] px-1.5 py-0.5 rounded bg-[var(--surface-2)]">
              {servers.length} configured
            </span>
          </div>

          <div className="max-h-60 overflow-y-auto space-y-0.5 py-0.5">
            {servers.map((s) => {
              const isActive = activeServer?.id === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleSelect(s.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[var(--surface-2)] text-[var(--text)] font-semibold border border-[var(--border)]'
                      : 'hover:bg-[var(--surface-2)] text-[var(--text-2)] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Server className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`} />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-[var(--text)]">
                        {s.name}
                      </p>
                      <p className="truncate text-[10px] font-mono text-[var(--muted)]">
                        {s.host}
                      </p>
                    </div>
                  </div>
                  {isActive && <Check className="w-3.5 h-3.5 text-[var(--text)] shrink-0 ml-2" />}
                </button>
              )
            })}
          </div>

          <div className="border-t border-[var(--border)] mt-1 pt-1 space-y-0.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                openServerModal()
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[var(--muted)]" />
              <span>Connect New Server...</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                window.dispatchEvent(new CustomEvent('agh:open-backend-modal'))
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
            >
              <Smartphone className="w-3.5 h-3.5 text-[var(--muted)]" />
              <span>Mobile / Gateway Endpoint...</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/settings')
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Settings className="w-3.5 h-3.5" />
                Manage Nodes
              </span>
              <span className="text-[10px] font-mono opacity-80">{displayHost}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
