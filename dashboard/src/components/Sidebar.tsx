import { NavLink } from 'react-router-dom'
import { useState } from 'react'
import {
  LayoutDashboard, Radio, Monitor, Shield, Settings, X, Command
} from 'lucide-react'
import NetworkPulse from './NetworkPulse'

const navItems = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, keyHint: '1' },
  { to: '/live', label: 'Live DNS', icon: Radio, keyHint: '2' },
  { to: '/clients', label: 'Clients', icon: Monitor, keyHint: '3' },
  { to: '/security', label: 'Security & Rules', icon: Shield, keyHint: '4' },
  { to: '/settings', label: 'Settings', icon: Settings, keyHint: '5' },
]

interface SidebarContentProps {
  online: boolean
  queryRate: number
  onOpenPalette?: () => void
  badges: Record<string, string | number>
  onCloseMobile?: () => void
}

function SidebarContent({ online, queryRate, onOpenPalette, badges, onCloseMobile }: SidebarContentProps) {
  return (
    <div className="flex flex-col h-full gap-5">
      {/* Brand Header */}
      <div className="flex items-center justify-between">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>ADGUARD</span>
        </div>
        {onCloseMobile && (
          <button
            className="lg:hidden text-[var(--muted)] hover:text-[var(--text)] p-1 rounded-md"
            onClick={onCloseMobile}
            aria-label="Close navigation menu"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Cmd+K Quick Search Trigger */}
      {onOpenPalette && (
        <button
          onClick={onOpenPalette}
          aria-label="Open command search"
          className="w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] rounded-[10px] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--strong-border)] text-[var(--text-2)] hover:text-[var(--text)] text-xs transition-colors cursor-pointer"
        >
          <Command className="w-4 h-4 text-[var(--muted)]" />
          <span className="flex-1 text-left text-[var(--muted)]">Search commands…</span>
          <kbd className="hidden sm:inline-block text-[10px] font-mono text-[var(--muted)] bg-[var(--surface)] border border-[var(--border)] px-1.5 py-0.5 rounded-[5px]">⌘K</kbd>
        </button>
      )}

      {/* Core Navigation */}
      <div>
        <div className="nav-label">Navigation</div>
        <nav className="nav" aria-label="Main navigation">
          {navItems.map(({ to, label, icon: Icon, keyHint }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={onCloseMobile}
              className={({ isActive }) =>
                `group flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-[10px] text-[13px] transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[var(--surface-2)] text-[var(--text)] font-[650]'
                    : 'text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] font-normal'
                }`
              }
            >
              <Icon className="w-[18px] h-[18px] shrink-0 text-[var(--muted)] group-hover:text-[var(--text)] transition-colors" />
              <span className="flex-1">{label}</span>
              <kbd className="hidden sm:inline-block opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono text-[var(--muted)] px-1 rounded bg-[var(--surface)] border border-[var(--border)]">
                {keyHint}
              </kbd>
              {badges[to] !== undefined && (
                <span className="text-[10px] font-mono text-[var(--muted)] tabular-nums">
                  {badges[to]}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Bottom Area: Pulse & Profile */}
      <div className="side-bottom space-y-3 mt-auto">
        {/* Live Network Throughput */}
        <div className="px-1 pt-3 border-t border-[var(--border)]">
          <div className="flex items-center justify-between text-[11px] text-[var(--muted)] mb-1.5 font-mono">
            <span>Throughput</span>
            <span className="text-[var(--text)] font-semibold tabular-nums">{queryRate.toFixed(1)} q/s</span>
          </div>
          <NetworkPulse rate={queryRate} />
        </div>

        {/* Profile Card */}
        <div className="profile">
          <div className="avatar" aria-hidden="true">AG</div>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('agh:open-backend-modal'))}
            className="min-w-0 flex-1 text-left cursor-pointer group bg-transparent border-0 p-0"
            title="Configure Dashboard Backend API Host"
          >
            <div className="profile-name truncate group-hover:text-[var(--text)]">DNS Server</div>
            <div className="profile-sub flex items-center gap-1.5 truncate">
              <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-[var(--green)] animate-pulse' : 'bg-[var(--red)]'}`} />
              <span className={`group-hover:underline ${online ? 'text-[var(--text-2)]' : 'badtext'}`}>{online ? 'Active · Gateway' : 'Offline · Tap to set IP'}</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}

interface SidebarProps {
  online: boolean
  queryRate?: number
  onOpenPalette?: () => void
  badges?: Record<string, string | number>
  mobileOpen?: boolean
  onToggleMobile?: (open: boolean) => void
}

export default function Sidebar({
  online,
  queryRate = 0,
  onOpenPalette,
  badges = {},
  mobileOpen,
  onToggleMobile,
}: SidebarProps) {
  const [internalMobileOpen, setInternalMobileOpen] = useState(false)
  const isMobileOpen = mobileOpen !== undefined ? mobileOpen : internalMobileOpen

  const setOpen = (open: boolean) => {
    if (onToggleMobile) onToggleMobile(open)
    setInternalMobileOpen(open)
  }

  return (
    <>
      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-[var(--bg-overlay)] backdrop-blur-xs transition-opacity"
          onClick={() => setOpen(false)}
          role="presentation"
        />
      )}

      {/* Mobile Drawer */}
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 flex flex-col w-[280px] bg-[var(--surface)] border-r border-[var(--border)] p-[clamp(16px,4vw,24px)_16px] transform transition-transform duration-200 ease-out shadow-2xl ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)',
        }}
      >
        <SidebarContent
          online={online}
          queryRate={queryRate}
          onOpenPalette={onOpenPalette}
          badges={badges}
          onCloseMobile={() => setOpen(false)}
        />
      </aside>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-[238px] shrink-0 border-r border-[var(--border)] bg-[var(--surface)] h-screen sticky top-0 p-[25px_16px]">
        <SidebarContent
          online={online}
          queryRate={queryRate}
          onOpenPalette={onOpenPalette}
          badges={badges}
        />
      </aside>
    </>
  )
}
