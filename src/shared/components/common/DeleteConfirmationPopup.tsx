import { useCallback, useEffect, useRef } from 'react'
import { XCircle, X } from 'lucide-react'

export interface PositionDetailsData {
  symbol: string
  direction: 'long' | 'short'
  quantity: number
  entryPrice: number
  currentPrice?: number
  pnl?: number
  margin?: number
}

export interface DeleteConfirmationPopupProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  isLoading?: boolean
  itemName?: string
  positionDetails?: PositionDetailsData
  confirmLabel?: string
}

export function DeleteConfirmationPopup({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  isLoading = false,
  itemName,
  positionDetails,
  confirmLabel = 'Confirm',
}: DeleteConfirmationPopupProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = 'delete-confirmation-title'
  const descId = 'delete-confirmation-desc'

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
      aria-hidden="true"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className="w-full max-w-[calc(100vw-1rem)] sm:max-w-md max-h-[90vh] flex flex-col rounded-xl border border-border bg-surface shadow-xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-warning/10">
              <XCircle className="w-6 h-6 text-warning" />
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
        <div className="p-6 overflow-y-auto min-h-0 space-y-4">
          {message && (
            <p id={descId} className="text-text-dim leading-relaxed whitespace-pre-line">
              {message}
            </p>
          )}
          {itemName && !positionDetails && (
            <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text">
              {itemName}
            </div>
          )}
          {positionDetails && (
            <div
              className="rounded-lg border border-border bg-surface-2 p-4 space-y-2 text-sm"
              aria-hidden
            >
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="text-text-dim">Symbol</span>
                <span className="text-text font-medium">{positionDetails.symbol}</span>
                <span className="text-text-dim">Direction</span>
                <span className="text-text font-medium capitalize">{positionDetails.direction}</span>
                <span className="text-text-dim">Quantity</span>
                <span className="text-text font-medium">{positionDetails.quantity.toLocaleString()}</span>
                <span className="text-text-dim">Entry</span>
                <span className="text-text font-medium">{positionDetails.entryPrice.toLocaleString()}</span>
                {positionDetails.currentPrice != null && (
                  <>
                    <span className="text-text-dim">Current</span>
                    <span className="text-text font-medium">{positionDetails.currentPrice.toLocaleString()}</span>
                  </>
                )}
                {positionDetails.margin != null && (
                  <>
                    <span className="text-text-dim">Margin</span>
                    <span className="text-text font-medium">{positionDetails.margin.toLocaleString()}</span>
                  </>
                )}
              </div>
              {positionDetails.pnl != null && (
                <p
                  className={
                    positionDetails.pnl >= 0
                      ? 'text-success font-medium'
                      : 'text-danger font-medium'
                  }
                >
                  P&amp;L: {positionDetails.pnl >= 0 ? '+' : ''}
                  {positionDetails.pnl.toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-border p-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-text-dim hover:text-text hover:bg-surface-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-accent/60 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="px-6 py-2 text-sm font-medium text-white bg-warning hover:bg-warning/90 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-warning focus:ring-offset-surface disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Closing...
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
