import { useLocation, useNavigate } from 'react-router-dom'
import { Search, ArrowLeft, Menu, Activity, Globe } from 'lucide-react'
import ServerSwitcher from './ServerSwitcher'

interface TopBarProps {
  online?: boolean
  protectionEnabled?: boolean
  queryRate?: number
  onOpenPalette?: () => void
  onOpenShortcuts?: () => void
  onOpenMobileMenu?: () => void
}

const routeTitles: Record<string, string> = {
  '/': 'Overview',
  '/live': 'Live DNS',
  '/clients': 'Clients',
  '/security': 'Security & Rules',
  '/settings': 'Settings',
  '/domains': 'Security & Rules',
  '/analytics': 'Overview',
  '/ai-report': 'Settings',
}

export default function TopBar({
  online = true,
  protectionEnabled = true,
  queryRate = 0,
  onOpenPalette,
  onOpenMobileMenu,
}: TopBarProps) {
  const location = useLocation()
  const navigate = useNavigate()

  let pageTitle = routeTitles[location.pathname]
  const isSubRoute = !pageTitle || location.pathname.startsWith('/clients/')

  if (!pageTitle && location.pathname.startsWith('/clients/')) {
    const raw = location.pathname.replace('/clients/', '')
    pageTitle = `Client: ${decodeURIComponent(raw)}`
  }
  if (!pageTitle) {
    pageTitle = 'Dashboard'
  }

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/')
    }
  }

  return (
    <header
      className="sticky top-0 z-30 w-full bg-[var(--bg)]/95 backdrop-blur-md border-b border-[var(--border)] px-3 sm:px-6 py-2.5 transition-colors select-none shrink-0"
      style={{
        paddingTop: 'max(env(safe-area-inset-top, 0px), 10px)',
      }}
    >
      <div className="flex items-center justify-between gap-2 sm:gap-4 max-w-[1600px] mx-auto w-full">
        {/* Left: Mobile Menu / Back Button + Title */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* Mobile hamburger menu toggle */}
          {!isSubRoute && onOpenMobileMenu && (
            <button
              type="button"
              onClick={onOpenMobileMenu}
              className="lg:hidden p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface-3)] cursor-pointer active:scale-95 transition-transform"
              aria-label="Open navigation menu"
              title="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}

          {/* Sub-route back button */}
          {isSubRoute && (
            <button
              type="button"
              onClick={handleBack}
              className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface-3)] cursor-pointer active:scale-95 transition-transform"
              aria-label="Go back to previous page"
              title="Go back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}

          {/* Page Title & Breadcrumb */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm sm:text-base font-bold text-[var(--text)] truncate tracking-tight">
              {pageTitle}
            </span>

            {/* Live Status indicator */}
            <div className="hidden sm:flex items-center gap-1.5 pl-2 border-l border-[var(--border)] text-xs font-mono">
              {!online ? (
                <span className="badtext flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                  <span>Offline</span>
                </span>
              ) : protectionEnabled ? (
                <span className="goodtext flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />
                  <span>Protected</span>
                </span>
              ) : (
                <span className="badtext flex items-center gap-1 text-[var(--red)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                  <span>Protection Paused</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Center / Right: Switcher + Telemetry + Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Active Node Switcher */}
          <ServerSwitcher />

          {/* Real-time Query Rate (SSE Throughput) */}
          {queryRate > 0 && (
            <div className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[11px] font-mono text-[var(--muted)]">
              <Activity className="w-3 h-3 text-[var(--green)]" />
              <span>{queryRate.toFixed(1)} q/s</span>
            </div>
          )}

          {/* Search Commands / Command Palette Shortcut */}
          {onOpenPalette && (
            <>
              {/* Desktop Search Button */}
              <button
                type="button"
                onClick={onOpenPalette}
                className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
                aria-label="Search commands (⌘K)"
                title="Search commands (⌘K)"
              >
                <Search className="w-3.5 h-3.5" />
                <span className="text-[11px]">Search…</span>
                <kbd className="text-[10px] font-mono px-1 py-0.2 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)]">
                  ⌘K
                </kbd>
              </button>

              {/* Mobile Search Button */}
              <button
                type="button"
                onClick={onOpenPalette}
                className="sm:hidden p-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)] cursor-pointer active:scale-95 transition-transform"
                aria-label="Search commands"
                title="Search commands"
              >
                <Search className="w-4 h-4" />
              </button>
            </>
          )}

          {/* Gateway Endpoint Configuration Button */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('agh:open-backend-modal'))}
            className="p-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] cursor-pointer active:scale-95 transition-transform"
            aria-label="Configure Gateway Endpoint"
            title="Gateway Endpoint URL"
          >
            <Globe className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
