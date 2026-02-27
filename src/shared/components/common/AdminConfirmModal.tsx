import { ReactNode, useCallback, useEffect, useRef } from 'react'
import { Trash2, AlertTriangle, X } from 'lucide-react'

export type AdminConfirmType = 'danger' | 'warning'

const typeConfig: Record<
  AdminConfirmType,
  { iconBg: string; iconColor: string; Icon: typeof Trash2; confirmClasses: string }
> = {
  danger: {
    iconBg: 'bg-red-400/10',
    iconColor: 'text-red-400',
    Icon: Trash2,
    confirmClasses:
      'px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center space-x-2 text-sm sm:text-base',
  },
  warning: {
    iconBg: 'bg-yellow-400/10',
    iconColor: 'text-yellow-400',
    Icon: AlertTriangle,
    confirmClasses:
      'px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center space-x-2 text-sm sm:text-base',
  },
}

export interface AdminConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: AdminConfirmType
  isLoading?: boolean
  loadingLabel?: string
  /** When true, confirm button is disabled (e.g. when validation fails) */
  confirmDisabled?: boolean
  children?: ReactNode
}

export function AdminConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'danger',
  isLoading = false,
  loadingLabel = 'Deleting...',
  confirmDisabled = false,
  children,
}: AdminConfirmModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = 'admin-confirm-title'
  const descId = 'admin-confirm-desc'
  const config = typeConfig[type]
  const Icon = config.Icon

  useEffect(() => {
    if (!isOpen) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isLoading, onClose])

  useEffect(() => {
    if (isOpen && panelRef.current) {
      const t = setTimeout(() => panelRef.current?.focus(), 100)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isLoading) onClose()
    },
    [onClose, isLoading]
  )

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"
      onClick={handleBackdropClick}
      aria-hidden="true"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className="w-full max-w-[calc(100vw-1rem)] sm:max-w-md bg-slate-800 rounded-lg border border-slate-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 sm:p-4 md:p-6">
          {/* Header: icon + title + message */}
          <div className="flex items-start space-x-3 mb-4">
            <div className={`p-2 sm:p-3 rounded-full flex-shrink-0 ${config.iconBg}`}>
              <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${config.iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 id={titleId} className="text-base sm:text-lg font-semibold text-white">
                {title}
              </h2>
              <p id={descId} className="text-xs sm:text-sm text-slate-400 mt-1 break-words">
                {message}
              </p>
            </div>
          </div>

          {children}

          {/* Footer */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 sm:space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors disabled:opacity-50 text-sm sm:text-base"
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isLoading || confirmDisabled}
              className={config.confirmClasses}
            >
              {isLoading ? (
                <>
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  <span>{loadingLabel}</span>
                </>
              ) : (
                confirmText
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
