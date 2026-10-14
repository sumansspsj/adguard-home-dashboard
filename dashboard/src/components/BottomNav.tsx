import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Radio, Monitor, Shield, Settings } from 'lucide-react'

interface BottomNavProps {
  onOpenMobileMenu?: () => void
  isMobileMenuOpen?: boolean
  online?: boolean
}

export default function BottomNav(_props?: BottomNavProps) {
  const navItems = [
    { to: '/', label: 'Overview', icon: LayoutDashboard },
    { to: '/live', label: 'Live DNS', icon: Radio },
    { to: '/clients', label: 'Clients', icon: Monitor },
    { to: '/security', label: 'Security', icon: Shield },
    { to: '/settings', label: 'Settings', icon: Settings },
  ]

  return (
    <nav
      aria-label="Mobile bottom navigation"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--surface)]/95 backdrop-blur-lg border-t border-[var(--border)] transition-colors select-none"
      style={{
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 4px)',
      }}
    >
      <div className="grid grid-cols-5 h-[54px] max-w-md mx-auto px-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center py-1 px-1 transition-all duration-150 cursor-pointer active:scale-95 ${
                isActive
                  ? 'text-[var(--text)] font-semibold'
                  : 'text-[var(--muted)] hover:text-[var(--text)] font-normal'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute top-0.5 w-6 h-[2px] bg-[var(--text)] rounded-full animate-fade-in" />
                )}
                <div className={`w-7 h-6 flex items-center justify-center transition-colors ${isActive ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>
                  <Icon className={`w-[19px] h-[19px] ${isActive ? 'stroke-[2.4]' : 'stroke-[1.8]'}`} />
                </div>
                <span className={`text-[10px] tracking-tight truncate max-w-full leading-none mt-0.5 ${isActive ? 'text-[var(--text)] font-semibold' : 'text-[var(--muted)]'}`}>
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
