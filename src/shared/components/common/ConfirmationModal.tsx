import { ReactNode, useCallback, useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export type ConfirmationType = 'danger' | 'warning' | 'info'

const typeConfig: Record<
  ConfirmationType,
  { iconBg: string; iconColor: string; confirmClasses: string }
> = {
  danger: {
    iconBg: 'bg-red-100 dark:bg-red-900/20',
    iconColor: 'text-red-600 dark:text-red-400',
    confirmClasses:
      'px-6 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 focus:ring-offset-surface disabled:opacity-50',
  },
  warning: {
    iconBg: 'bg-yellow-100 dark:bg-yellow-900/20',
    iconColor: 'text-yellow-600 dark:text-yellow-400',
    confirmClasses:
      'px-6 py-2 text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 focus:ring-offset-surface disabled:opacity-50',
  },
  info: {
    iconBg: 'bg-blue-100 dark:bg-blue-900/20',
    iconColor: 'text-blue-600 dark:text-blue-400',
    confirmClasses:
      'px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-surface disabled:opacity-50',
  },
}

export interface ConfirmationModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: ConfirmationType
  isLoading?: boolean
  onSecondary?: () => void
  secondaryText?: string
  secondaryActions?: Array<{ text: string; onClick: () => void }>
  customFooter?: ReactNode
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'danger',
  isLoading = false,
  onSecondary,
  secondaryText,
  secondaryActions,
  customFooter,
}: ConfirmationModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = 'confirmation-modal-title'
  const descId = 'confirmation-modal-desc'
  const config = typeConfig[type]

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
      className="fixed inset-0 z-50 overflow-hidden bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
      aria-hidden="true"
    >
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-labelledby={titleId}
          aria-describedby={descId}
          tabIndex={-1}
          className="w-full max-w-[calc(100vw-1rem)] sm:max-w-md max-h-[90vh] flex flex-col rounded-xl border border-border bg-surface shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border p-6">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${config.iconBg}`}>
                <AlertTriangle className={`w-6 h-6 ${config.iconColor}`} />
              </div>
              <h2 id={titleId} className="text-lg font-semibold text-text">
                {title}
              </h2>
            </div>
            {!isLoading && (
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-surface-2 text-text-dim hover:text-text transition-colors focus:outline-none focus:ring-2 focus:ring-accent/60"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto min-h-0">
            <p id={descId} className="text-text-dim leading-relaxed whitespace-pre-line">
              {message}
            </p>
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-border p-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3">
            {customFooter ?? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isLoading}
                  className="px-4 py-2 text-sm font-medium text-text-dim hover:text-text hover:bg-surface-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-accent/60 disabled:opacity-50"
                >
                  {cancelText}
                </button>
                {secondaryActions?.map((action, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={action.onClick}
                    disabled={isLoading}
                    className="px-4 py-2 text-sm font-medium text-text-dim hover:text-text hover:bg-surface-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-accent/60 disabled:opacity-50"
                  >
                    {action.text}
                  </button>
                ))}
                {onSecondary && secondaryText && (
                  <button
                    type="button"
                    onClick={onSecondary}
                    disabled={isLoading}
                    className="px-4 py-2 text-sm font-medium text-text-dim hover:text-text hover:bg-surface-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-accent/60 disabled:opacity-50"
                  >
                    {secondaryText}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={isLoading}
                  className={config.confirmClasses}
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Processing...
                    </span>
                  ) : (
                    confirmText
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
