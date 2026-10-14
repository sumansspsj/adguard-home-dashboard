import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Shield, ShieldOff, Clock, X } from 'lucide-react'
import { toggleProtection } from '../api'
import { useToast } from '../contexts/ToastContext'

interface ProtectionPauseModalProps {
  open: boolean
  onClose: () => void
  onToggle: (enabled: boolean) => void
  currentlyEnabled: boolean
}

const PAUSE_OPTIONS = [
  { label: '30 seconds', seconds: 30 },
  { label: '1 minute', seconds: 60 },
  { label: '5 minutes', seconds: 300 },
  { label: '30 minutes', seconds: 1800 },
  { label: 'Until re-enabled', seconds: 0 },
]

export default function ProtectionPauseModal({ open, onClose, onToggle, currentlyEnabled }: ProtectionPauseModalProps) {
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  const handlePause = async (seconds: number) => {
    setLoading(true)
    try {
      await toggleProtection(false, seconds)
      onToggle(false)
      window.dispatchEvent(new CustomEvent('agh:protection-toggled', { detail: { enabled: false } }))
      const label = seconds > 0 ? PAUSE_OPTIONS.find(o => o.seconds === seconds)?.label : 'indefinitely'
      toast(`Protection paused ${label}`, {
        type: 'warning',
        sub: seconds > 0 ? `Auto-resumes in ${label}` : 'Toggle manually to resume',
        duration: 5000,
      })

      if (seconds > 0) {
        setTimeout(async () => {
          await toggleProtection(true).catch(() => {})
          onToggle(true)
          window.dispatchEvent(new CustomEvent('agh:protection-toggled', { detail: { enabled: true } }))
          toast('Protection resumed', { type: 'success' })
        }, seconds * 1000)
      }
      onClose()
    } catch {
      toast('Failed to toggle protection', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleEnable = async () => {
    setLoading(true)
    try {
      await toggleProtection(true)
      onToggle(true)
      window.dispatchEvent(new CustomEvent('agh:protection-toggled', { detail: { enabled: true } }))
      toast('Protection enabled', { type: 'success' })
      onClose()
    } catch {
      toast('Failed to enable protection', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[90] bg-[var(--bg-overlay)] backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <div className="fixed inset-0 z-[91] flex items-center justify-center pointer-events-none p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="pointer-events-auto w-full max-w-sm bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  {currentlyEnabled
                    ? <Shield className="w-4 h-4 text-[var(--text-primary)]" />
                    : <ShieldOff className="w-4 h-4 text-[var(--text-primary)]" />}
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {currentlyEnabled ? 'Pause Protection' : 'Enable Protection'}
                  </span>
                </div>
                <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-2">
                {currentlyEnabled ? (
                  <>
                    <p className="text-xs text-[var(--text-tertiary)] mb-4">
                      DNS filtering will be paused. All queries will be allowed while paused.
                    </p>
                    {PAUSE_OPTIONS.map(opt => (
                      <button
                        key={opt.seconds}
                        onClick={() => handlePause(opt.seconds)}
                        disabled={loading}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-[var(--text-primary)] border border-[var(--border)] hover:bg-[var(--bg-hover)] transition-all disabled:opacity-50 text-left cursor-pointer"
                      >
                        <Clock className="w-4 h-4 shrink-0 text-[var(--text-muted)]" />
                        {opt.label}
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <p className="text-xs text-[var(--text-tertiary)] mb-4">
                      Protection is currently disabled. All DNS queries are allowed.
                    </p>
                    <button
                      onClick={handleEnable}
                      disabled={loading}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold text-[var(--btn-primary-text)] bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <Shield className="w-4 h-4" />
                      Enable Protection Now
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
