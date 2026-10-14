import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  message: string
  sub?: string
  undoFn?: () => void
  duration?: number
}

interface ToastCtx {
  toasts: Toast[]
  toast: (msg: string, opts?: Partial<Omit<Toast, 'id' | 'message'>>) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const duration = opts.duration ?? 4000
    setToasts(prev => [...prev, { id, message, type: 'success', ...opts }])

    if (duration > 0) {
      const timer = setTimeout(() => {
        dismiss(id)
      }, duration)
      timersRef.current.set(id, timer)
    }
    return id
  }, [dismiss])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
    </ToastContext.Provider>
  )
}

// oxlint-disable-next-line react/only-export-components
export function useToast(): ToastCtx {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
