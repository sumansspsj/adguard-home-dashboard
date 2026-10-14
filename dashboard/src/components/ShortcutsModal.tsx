import { useEffect } from 'react'
import { X, Command, Keyboard } from 'lucide-react'

interface ShortcutsModalProps {
  open: boolean
  onClose: () => void
}

const SHORTCUTS = [
  { key: '1 – 5', desc: 'Jump between console views (Overview, Live, Clients, Security, Settings)' },
  { key: '⌘ K / Ctrl K', desc: 'Open Command Palette & Global Search' },
  { key: '?', desc: 'Toggle keyboard shortcuts reference' },
  { key: 'Esc', desc: 'Close dialogs, drawers, and modal panels' },
]

export default function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--bg-overlay)] backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="w-full max-w-md bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[var(--bg-active)] border border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)]">
              <Keyboard className="w-4 h-4" />
            </div>
            <h2 id="shortcuts-title" className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close shortcuts dialog"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="divide-y divide-[var(--border-subtle)]">
            {SHORTCUTS.map(s => (
              <div key={s.key} className="flex items-center justify-between py-2.5 text-xs">
                <span className="text-[var(--text-secondary)] font-medium">{s.desc}</span>
                <kbd className="font-mono text-[11px] text-[var(--text-secondary)] bg-[var(--bg-active)] border border-[var(--border)] px-2 py-1 rounded shadow-inner ml-3 shrink-0">
                  {s.key}
                </kbd>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-muted)] font-mono">
            <span className="flex items-center gap-1">
              <Command className="w-3 h-3" /> Pro Command Console
            </span>
            <span>Press Esc to dismiss</span>
          </div>
        </div>
      </div>
    </div>
  )
}
