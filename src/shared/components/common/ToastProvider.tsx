import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, Clock, X } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading'

export interface Toast {
  id: string
  type: ToastType
  title: string
  description?: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
  persistent?: boolean
}

interface ToastContextValue {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => string
  removeToast: (id: string) => void
  updateToast: (id: string, updates: Partial<Toast>) => void
  clearAllToasts: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const DEFAULT_DURATION = 5000

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

// ---------------------------------------------------------------------------
// Type-specific config (icon + colors)
// ---------------------------------------------------------------------------

function getToastConfig(type: ToastType) {
  const configs = {
    success: {
      icon: CheckCircle,
      bg: 'bg-green-500/10',
      border: 'border-green-500/20',
      iconColor: 'text-green-400',
      titleColor: 'text-green-100',
      descColor: 'text-green-200',
    },
    error: {
      icon: XCircle,
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
      iconColor: 'text-red-400',
      titleColor: 'text-red-100',
      descColor: 'text-red-200',
    },
    warning: {
      icon: AlertTriangle,
      bg: 'bg-yellow-500/10',
      border: 'border-yellow-500/20',
      iconColor: 'text-yellow-400',
      titleColor: 'text-yellow-100',
      descColor: 'text-yellow-200',
    },
    info: {
      icon: Info,
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/20',
      iconColor: 'text-blue-400',
      titleColor: 'text-blue-100',
      descColor: 'text-blue-200',
    },
    loading: {
      icon: Clock,
      bg: 'bg-slate-500/10',
      border: 'border-slate-500/20',
      iconColor: 'text-slate-400',
      titleColor: 'text-slate-100',
      descColor: 'text-slate-200',
    },
  }
  return configs[type]
}

// ---------------------------------------------------------------------------
// ToastItem
// ---------------------------------------------------------------------------

interface ToastItemProps {
  toast: Toast
  onRemove: (id: string) => void
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setIsVisible(true), 10)
    return () => clearTimeout(t)
  }, [])

  const handleRemove = useCallback(() => {
    if (isLeaving) return
    setIsLeaving(true)
    leaveTimeoutRef.current = setTimeout(() => {
      onRemove(toast.id)
    }, 300)
  }, [toast.id, onRemove, isLeaving])

  useEffect(() => {
    return () => {
      if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current)
    }
  }, [])

  const config = getToastConfig(toast.type)
  const Icon = config.icon

  return (
    <div
      className={`
        max-w-sm w-full rounded-lg border shadow-lg backdrop-blur-sm p-4
        bg-slate-800 ${config.bg} ${config.border}
        transform transition-all duration-300 ease-in-out
        ${isVisible && !isLeaving ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
    >
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          {toast.type === 'loading' ? (
            <div
              className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"
              aria-hidden
            />
          ) : (
            <Icon className={`w-5 h-5 ${config.iconColor}`} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`font-medium ${config.titleColor}`}>{toast.title}</p>
          {toast.description && (
            <p className={`text-sm mt-0.5 ${config.descColor}`}>{toast.description}</p>
          )}
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick()
                handleRemove()
              }}
              className="mt-2 text-sm font-medium text-blue-400 hover:text-blue-300"
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleRemove}
          className="flex-shrink-0 text-slate-400 hover:text-slate-300 p-1 rounded"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ToastContainer
// ---------------------------------------------------------------------------

function ToastContainer() {
  const { toasts, removeToast } = useToast()
  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
      <div className="pointer-events-auto flex flex-col items-end space-y-2">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return ctx
}

export function useToastActions() {
  const { addToast, removeToast, updateToast, clearAllToasts } = useToast()

  const showSuccess = useCallback(
    (title: string, description?: string) =>
      addToast({ type: 'success', title, description }),
    [addToast]
  )

  const showError = useCallback(
    (title: string, description?: string) =>
      addToast({ type: 'error', title, description }),
    [addToast]
  )

  const showWarning = useCallback(
    (title: string, description?: string) =>
      addToast({ type: 'warning', title, description }),
    [addToast]
  )

  const showInfo = useCallback(
    (title: string, description?: string) =>
      addToast({ type: 'info', title, description }),
    [addToast]
  )

  const showLoading = useCallback(
    (title: string, description?: string) => {
      const id = addToast({
        type: 'loading',
        title,
        description,
        persistent: true,
      })
      return { id, dismiss: () => removeToast(id) }
    },
    [addToast, removeToast]
  )

  const showPromise = useCallback(
    async <T,>(
      promise: Promise<T>,
      messages: { loading: string; success: string; error: string }
    ): Promise<T> => {
      const id = addToast({
        type: 'loading',
        title: messages.loading,
        persistent: true,
      })
      try {
        const result = await promise
        removeToast(id)
        addToast({ type: 'success', title: messages.success })
        return result
      } catch (err) {
        removeToast(id)
        addToast({
          type: 'error',
          title: messages.error,
          description: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    },
    [addToast, removeToast]
  )

  return {
    addToast,
    removeToast,
    updateToast,
    clearAllToasts,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    showLoading,
    showPromise,
  }
}

// ---------------------------------------------------------------------------
// Global toast ref for use outside React tree (e.g. mutation callbacks)
// ---------------------------------------------------------------------------

const toastApiRef = { current: null as ToastContextValue | null }

export function getToastApi(): ToastContextValue | null {
  return toastApiRef.current
}

/** Options passed as second arg for compatibility with react-hot-toast call sites */
type ToastOpts = { duration?: number; description?: string; style?: Record<string, unknown> }

function normalizeToastArgs(
  title: string,
  second?: string | ToastOpts
): { title: string; description?: string; duration?: number } {
  if (second == null) return { title }
  if (typeof second === 'string') return { title, description: second }
  return {
    title,
    description: second.description,
    duration: second.duration,
  }
}

function toastSuccess(title: string, descriptionOrOpts?: string | ToastOpts) {
  const { title: t, description, duration } = normalizeToastArgs(title, descriptionOrOpts)
  return toastApiRef.current?.addToast({ type: 'success', title: t, description, duration })
}
function toastError(title: string, descriptionOrOpts?: string | ToastOpts) {
  const { title: t, description, duration } = normalizeToastArgs(title, descriptionOrOpts)
  return toastApiRef.current?.addToast({ type: 'error', title: t, description, duration })
}
function toastWarning(title: string, descriptionOrOpts?: string | ToastOpts) {
  const { title: t, description, duration } = normalizeToastArgs(title, descriptionOrOpts)
  return toastApiRef.current?.addToast({ type: 'warning', title: t, description, duration })
}
function toastInfo(title: string, descriptionOrOpts?: string | ToastOpts) {
  const { title: t, description, duration } = normalizeToastArgs(title, descriptionOrOpts)
  return toastApiRef.current?.addToast({ type: 'info', title: t, description, duration })
}
function toastLoading(title: string, description?: string) {
  return (
    toastApiRef.current?.addToast({
      type: 'loading',
      title,
      description,
      persistent: true,
    }) ?? ''
  )
}
function toastDismiss(id: string) {
  toastApiRef.current?.removeToast(id)
}
function toastCustom(options: Omit<Toast, 'id'>) {
  return toastApiRef.current?.addToast(options) ?? ''
}

/** Default call: toast('message') or toast('message', { duration }) shows info toast */
function toastCallable(message: string, opts?: ToastOpts) {
  const { title, description, duration } = normalizeToastArgs(message, opts)
  return toastApiRef.current?.addToast({ type: 'info', title, description, duration })
}

/** Drop-in replacement for react-hot-toast: import { toast } from '@/shared/components/common' */
export const toast = Object.assign(toastCallable, {
  success: toastSuccess,
  error: toastError,
  warning: toastWarning,
  info: toastInfo,
  loading: toastLoading,
  dismiss: toastDismiss,
  custom: toastCustom,
})

// ---------------------------------------------------------------------------
// ToastProvider
// ---------------------------------------------------------------------------

interface ToastProviderProps {
  children: React.ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const removeToast = useCallback((id: string) => {
    const tid = timeoutsRef.current.get(id)
    if (tid) {
      clearTimeout(tid)
      timeoutsRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = generateId()
      const duration = t.duration ?? DEFAULT_DURATION
      const toastEntry: Toast = {
        ...t,
        id,
        duration,
      }
      setToasts((prev) => [...prev, toastEntry])

      if (!t.persistent && duration > 0) {
        const tid = setTimeout(() => removeToast(id), duration)
        timeoutsRef.current.set(id, tid)
      }
      return id
    },
    [removeToast]
  )

  const updateToast = useCallback((id: string, updates: Partial<Toast>) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    )
  }, [])

  const clearAllToasts = useCallback(() => {
    timeoutsRef.current.forEach((tid) => clearTimeout(tid))
    timeoutsRef.current.clear()
    setToasts([])
  }, [])

  const value: ToastContextValue = {
    toasts,
    addToast,
    removeToast,
    updateToast,
    clearAllToasts,
  }

  useEffect(() => {
    toastApiRef.current = value
    return () => {
      toastApiRef.current = null
      timeoutsRef.current.forEach((tid) => clearTimeout(tid))
      timeoutsRef.current.clear()
    }
  }, [addToast, removeToast, updateToast, clearAllToasts])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  )
}
