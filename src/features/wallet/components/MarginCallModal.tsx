import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '@/shared/ui/button/Button'
import { AlertTriangle } from 'lucide-react'
import type { AccountSummaryResponse } from '../api'

interface MarginCallModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDepositClick: () => void
  accountSummary: AccountSummaryResponse | null
  threshold: number
  currentLevel: number | null
}

export function MarginCallModal({
  open,
  onOpenChange,
  onDepositClick,
  accountSummary,
  threshold,
  currentLevel,
}: MarginCallModalProps) {
  const handleDeposit = () => {
    onOpenChange(false)
    onDepositClick()
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-[100] w-full max-w-md shadow-xl">
          <Dialog.Title className="text-lg font-semibold text-text mb-2 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-danger shrink-0" />
            Margin call
          </Dialog.Title>
          <Dialog.Description className="text-sm text-text-muted mb-4">
            Your margin level is below the {threshold}% threshold. Add funds to reduce liquidation risk.
          </Dialog.Description>

          <div className="space-y-3 mb-6 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Current margin level</span>
              <span className="font-mono text-text">
                {currentLevel != null ? `${currentLevel.toFixed(2)}%` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Margin call level</span>
              <span className="font-mono text-text">{threshold}%</span>
            </div>
            {accountSummary != null && (
              <>
                <div className="flex justify-between">
                  <span className="text-text-muted">Equity</span>
                  <span className="font-mono text-text">
                    ${accountSummary.equity.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Margin used</span>
                  <span className="font-mono text-text">
                    ${accountSummary.marginUsed.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Free margin</span>
                  <span className="font-mono text-text">
                    ${accountSummary.freeMargin.toFixed(2)}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={handleDeposit}>Deposit</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
