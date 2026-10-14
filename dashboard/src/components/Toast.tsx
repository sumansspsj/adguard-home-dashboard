import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useToast, type ToastType } from '../contexts/ToastContext'

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 text-[var(--text-primary)] shrink-0" aria-hidden="true" />,
  error: <XCircle className="w-4 h-4 text-[var(--color-danger)] shrink-0" aria-hidden="true" />,
  warning: <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] shrink-0" aria-hidden="true" />,
  info: <Info className="w-4 h-4 text-[var(--text-primary)] shrink-0" aria-hidden="true" />,
}

const borders: Record<ToastType, string> = {
  success: 'border-[var(--border-strong)]',
  error: 'border-[var(--border-strong)]',
  warning: 'border-[var(--border-strong)]',
  info: 'border-[var(--border-strong)]',
}

export default function ToastContainer() {
  const { toasts, dismiss } = useToast()

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none"
    >
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            role="status"
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 bg-[var(--bg-elevated)] border ${borders[t.type]} rounded-xl shadow-2xl max-w-xs min-w-[240px]`}
          >
            {icons[t.type]}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[var(--text-primary)] font-medium">{t.message}</div>
              {t.sub && <div className="text-xs text-[var(--text-tertiary)] mt-0.5">{t.sub}</div>}
              {t.undoFn && (
                <button
                  type="button"
                  onClick={() => { t.undoFn!(); dismiss(t.id) }}
                  className="text-xs text-[var(--text-primary)] underline hover:opacity-85 mt-1 font-medium"
                >
                  Undo
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0 p-0.5 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
