import { X, CreditCard, ArrowDownCircle, Clock, CheckCircle, XCircle } from 'lucide-react'
import { useTerminalStore } from '../store'
import { useQuery } from '@tanstack/react-query'
import { fetchDepositHistory, type DepositHistoryItem } from '@/features/wallet/api'
import { cn } from '@/shared/utils'
import { Spinner } from '@/shared/ui/loading'

const PANEL_WIDTH = 288

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase()
  if (s === 'completed' || s === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
        <CheckCircle className="h-3 w-3" />
        Completed
      </span>
    )
  }
  if (s === 'rejected' || s === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">
        <XCircle className="h-3 w-3" />
        Rejected
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-500">
      <Clock className="h-3 w-3" />
      Pending
    </span>
  )
}

export function PaymentPanel() {
  const { paymentPanelOpen, setPaymentPanelOpen } = useTerminalStore()
  const { data: deposits, isLoading, error, refetch, isError } = useQuery({
    queryKey: ['account', 'deposits'],
    queryFn: fetchDepositHistory,
    enabled: paymentPanelOpen,
    retry: 1,
  })

  if (!paymentPanelOpen) return null

  return (
    <div
      className={cn(
        'h-full min-h-0 flex flex-col shrink-0',
        'bg-background/95 backdrop-blur-sm',
        'border-l border-white/10 shadow-[-4px_0_24px_rgba(0,0,0,0.25)]',
        'animate-fade-in'
      )}
      style={{ width: PANEL_WIDTH }}
      role="dialog"
      aria-label="Deposit history panel"
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3.5 border-b border-white/10 bg-gradient-to-r from-white/[0.03] to-transparent">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <CreditCard className="h-4 w-4" />
          </div>
          <h2 className="text-sm font-semibold text-text truncate">Deposit History</h2>
        </div>
        <button
          type="button"
          onClick={() => setPaymentPanelOpen(false)}
          className="shrink-0 p-2 rounded-lg text-text-muted hover:text-text hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
          title="Close panel"
          aria-label="Close deposit history panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="px-4 py-3">
          <p className="text-xs text-text-muted mb-3">
            Your recent deposit requests and their status.
          </p>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Spinner className="h-8 w-8 text-accent mb-3" />
              <p className="text-sm text-text-muted">Loading…</p>
            </div>
          ) : isError && error ? (
            <div className="py-6 text-center space-y-2">
              <p className="text-sm text-danger">
                {(error as Error)?.message || 'Failed to load deposit history.'}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="text-xs font-medium text-accent hover:underline"
              >
                Retry
              </button>
            </div>
          ) : !deposits || deposits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ArrowDownCircle className="h-10 w-10 text-text-muted/50 mb-3" />
              <p className="text-sm font-medium text-text">No deposits yet</p>
              <p className="text-xs text-text-muted mt-1">Use the Deposit button below to add funds.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {deposits.map((item: DepositHistoryItem) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-text">
                          ${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className="text-xs text-text-muted">{item.currency}</span>
                      </div>
                      <p className="text-[11px] font-mono text-text-muted mt-0.5 truncate" title={item.reference}>
                        {item.reference}
                      </p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="text-[11px] text-text-muted/80 mt-2">
                    {formatDate(item.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
