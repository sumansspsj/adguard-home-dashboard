import { lazy, Suspense, useEffect, useState, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import BottomNav from './components/BottomNav'
import ErrorBoundary from './components/ErrorBoundary'
import ToastContainer from './components/Toast'
import CommandPalette from './components/CommandPalette'
import ShortcutsModal from './components/ShortcutsModal'
import ServerModal from './components/ServerModal'
import BackendConfigModal from './components/BackendConfigModal'
import ProtectionPauseModal from './components/ProtectionPauseModal'
import { ToastProvider } from './contexts/ToastContext'
import { ServerProvider, useServer } from './contexts/ServerContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { getHealth, getStatus, getClients, getStats, getApiUrl } from './api'
import { Loader2 } from 'lucide-react'

const OverviewPage     = lazy(() => import('./pages/Overview'))
const LiveDNSPage      = lazy(() => import('./pages/LiveDNS'))
const ClientsPage      = lazy(() => import('./pages/Clients'))
const ClientDetailPage = lazy(() => import('./pages/ClientDetail'))
const SecurityPage     = lazy(() => import('./pages/Security'))
const SettingsPage     = lazy(() => import('./pages/Settings'))
const WorldMapPage     = lazy(() => import('./pages/WorldMap'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64 gap-3 text-[var(--text-tertiary)]">
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  )
}

/** Wraps page content with enter animation */
function AnimatedPage({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  return (
    <div key={location.pathname} className="page-enter">
      {children}
    </div>
  )
}

function AppInner() {
  const { serverVersion } = useServer()
  const navigate = useNavigate()
  const location = useLocation()
  const [online, setOnline] = useState(false)
  const [protectionEnabled, setProtectionEnabled] = useState(true)
  const [protectionModalOpen, setProtectionModalOpen] = useState(false)
  const [queryRate, setQueryRate] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [clients, setClients] = useState<{ name: string; ip: string }[]>([])
  const [topDomains, setTopDomains] = useState<[string, number][]>([])
  const [backendModalOpen, setBackendModalOpen] = useState(false)
  const rateWindowRef = useRef<number[]>([])

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const handleOpenModal = () => setBackendModalOpen(true)
    window.addEventListener('agh:open-backend-modal', handleOpenModal)
    return () => window.removeEventListener('agh:open-backend-modal', handleOpenModal)
  }, [])

  // Listen to protection state updates from any view
  useEffect(() => {
    const handleToggle = (e: Event) => {
      const custom = e as CustomEvent<{ enabled?: boolean }>
      if (typeof custom.detail?.enabled === 'boolean') {
        setProtectionEnabled(custom.detail.enabled)
      }
    }
    window.addEventListener('agh:protection-toggled', handleToggle)
    return () => window.removeEventListener('agh:protection-toggled', handleToggle)
  }, [])


  // Health + protection state tracking
  useEffect(() => {
    const check = () => {
      getStatus()
        .then((st) => {
          setOnline(true)
          setProtectionEnabled(Boolean(st.protection_enabled))
        })
        .catch(() => {
          getHealth()
            .then(() => setOnline(true))
            .catch(() => setOnline(false))
        })
    }
    check()
    const id = setInterval(check, 10_000)
    return () => clearInterval(id)
  }, [serverVersion])

  // Track query rate from SSE
  useEffect(() => {
    rateWindowRef.current = []
    setQueryRate(0)
    const es = new EventSource(getApiUrl('/querylog/stream'))
    es.onmessage = (e) => {
      try {
        const entries = JSON.parse(e.data)
        if (Array.isArray(entries) && entries.length > 0) {
          const now = Date.now()
          rateWindowRef.current.push(now)
          // Keep only last 10 seconds
          rateWindowRef.current = rateWindowRef.current.filter(t => now - t < 10000)
          setQueryRate(rateWindowRef.current.length / 10)
        }
      } catch {
        // Safe to ignore non-JSON heartbeats and control comments
      }
    }
    return () => es.close()
  }, [serverVersion])

  // Prefetch clients + top domains for CommandPalette
  useEffect(() => {
    getClients().then(c => {
      const allClients = [
        ...c.clients.map(cl => ({ name: cl.name, ip: cl.ids?.[0] || '' })),
        ...c.auto_clients.map(ac => ({ name: ac.name || ac.ip, ip: ac.ip })),
      ].filter(cl => cl.ip)
      setClients(allClients)
    }).catch(() => {})

    getStats().then(s => {
      const domains = (s.top_queried_domains || [])
        .flatMap(o => Object.entries(o) as [string, number][])
        .slice(0, 10)
      setTopDomains(domains)
    }).catch(() => {})
  }, [serverVersion])

  // Re-fetch global telemetry whenever the active server is switched
  useEffect(() => {
    const handleSwitch = () => {
      getHealth().then(() => setOnline(true)).catch(() => setOnline(false))
      getClients().then(c => {
        const allClients = [
          ...c.clients.map(cl => ({ name: cl.name, ip: cl.ids?.[0] || '' })),
          ...c.auto_clients.map(ac => ({ name: ac.name || ac.ip, ip: ac.ip })),
        ].filter(cl => cl.ip)
        setClients(allClients)
      }).catch(() => {})
      getStats().then(s => {
        const domains = (s.top_queried_domains || [])
          .flatMap(o => Object.entries(o) as [string, number][])
          .slice(0, 10)
        setTopDomains(domains)
      }).catch(() => {})
    }
    window.addEventListener('agh:server-switched', handleSwitch)
    return () => window.removeEventListener('agh:server-switched', handleSwitch)
  }, [])

  // Global keyboard shortcuts (1-8 quick navigation, Cmd+K, ?, Esc)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      const isInput = activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || (activeEl as HTMLElement)?.isContentEditable

      const isMac = navigator.platform.toUpperCase().includes('MAC')
      const mod = isMac ? e.metaKey : e.ctrlKey

      if (mod && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen(p => !p)
        return
      }

      if (e.key === 'Escape') {
        setPaletteOpen(false)
        setShortcutsOpen(false)
        setMobileMenuOpen(false)
        return
      }

      if (isInput) return

      if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen(s => !s)
        return
      }

      const keyRoutes: Record<string, string> = {
        '1': '/',
        '2': '/live',
        '3': '/clients',
        '4': '/security',
        '5': '/settings',
      }

      if (keyRoutes[e.key]) {
        e.preventDefault()
        navigate(keyRoutes[e.key])
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [navigate])

  return (
    <div className="flex min-h-screen bg-[var(--bg-base)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only fixed top-2 left-2 z-[999] px-3 py-1.5 rounded-lg bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] font-medium text-xs shadow-lg"
      >
        Skip to main content
      </a>

      {/* Desktop Sidebar + Mobile Slide Drawer */}
      <Sidebar
        online={online}
        queryRate={queryRate}
        onOpenPalette={() => setPaletteOpen(true)}
        mobileOpen={mobileMenuOpen}
        onToggleMobile={setMobileMenuOpen}
      />

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <TopBar
          online={online}
          protectionEnabled={protectionEnabled}
          queryRate={queryRate}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main
          id="main-content"
          className="flex-1 overflow-y-auto min-w-0 p-[16px_clamp(14px,3vw,36px)_calc(76px+env(safe-area-inset-bottom,0px))] lg:p-[24px_clamp(16px,3vw,36px)_42px] max-w-[1600px] w-full mx-auto"
        >

        {!online && (
          <div className="mb-4 px-3.5 py-2.5 rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--muted)] flex items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-[var(--border-strong)] shrink-0" />
              <span className="truncate">
                Backend API unreachable. Tap to configure server endpoint IP.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setBackendModalOpen(true)}
              className="primary-btn text-xs py-1 px-3 shrink-0 cursor-pointer"
            >
              Configure Gateway
            </button>
          </div>
        )}

        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <AnimatedPage>
              <Routes>
                <Route path="/"             element={<OverviewPage />} />
                <Route path="/live"         element={<LiveDNSPage />} />
                <Route path="/map"          element={<WorldMapPage />} />
                <Route path="/clients"      element={<ClientsPage />} />
                <Route path="/clients/:ip"  element={<ClientDetailPage />} />
                <Route path="/security"     element={<SecurityPage />} />
                <Route path="/settings"     element={<SettingsPage />} />

                {/* Streamlined Backward-Compatibility Redirects */}
                <Route path="/analytics"    element={<Navigate to="/?tab=analytics" replace />} />
                <Route path="/domains"      element={<Navigate to="/security?tab=domains" replace />} />
                <Route path="/rules"        element={<Navigate to="/security?tab=rules" replace />} />
                <Route path="/ai-report"    element={<Navigate to="/settings?tab=intelligence" replace />} />
                <Route path="/live-dns"     element={<Navigate to="/live" replace />} />
                <Route path="*"             element={<Navigate to="/" replace />} />
              </Routes>
            </AnimatedPage>
          </Suspense>
        </ErrorBoundary>
      </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <BottomNav
        onOpenMobileMenu={() => setMobileMenuOpen(true)}
        isMobileMenuOpen={mobileMenuOpen}
        online={online}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        clients={clients}
        topDomains={topDomains}
        onProtectionToggle={() => {
          setPaletteOpen(false)
          setProtectionModalOpen(true)
        }}
      />

      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      <ProtectionPauseModal
        open={protectionModalOpen}
        onClose={() => setProtectionModalOpen(false)}
        onToggle={(enabled) => {
          setProtectionEnabled(enabled)
          window.dispatchEvent(new CustomEvent('agh:protection-toggled', { detail: { enabled } }))
        }}
        currentlyEnabled={protectionEnabled}
      />

      <ServerModal />
      <BackendConfigModal
        open={backendModalOpen}
        onClose={() => setBackendModalOpen(false)}
      />
      <ToastContainer />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <ServerProvider>
            <AppInner />
          </ServerProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
