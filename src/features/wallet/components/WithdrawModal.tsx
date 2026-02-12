import { useState } from 'react'
import { ModalShell } from '@/shared/ui/modal/ModalShell'
import { Input } from '@/shared/ui/input/Input'
import { Button } from '@/shared/ui/button/Button'
import { useWithdrawalFlow } from '../hooks/useWithdrawalFlow'
import { useWalletStore } from '@/shared/store/walletStore'
import { Loader2 } from 'lucide-react'
import { cn } from '@/shared/utils'

interface WithdrawModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WithdrawModal({ open, onOpenChange }: WithdrawModalProps) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ amount?: string; note?: string }>({})
  const { submitWithdrawal, isSubmitting } = useWithdrawalFlow()
  const { balance, currency, available } = useWalletStore()

  const validate = (): boolean => {
    const newErrors: { amount?: string; note?: string } = {}

    // Amount validation
    if (!amount || amount.trim() === '') {
      newErrors.amount = 'Amount is required'
    } else {
      const numAmount = parseFloat(amount)
      if (isNaN(numAmount)) {
        newErrors.amount = 'Amount must be a number'
      } else if (numAmount < 10) {
        newErrors.amount = 'Minimum amount is $10'
      } else if (numAmount > 1000000) {
        newErrors.amount = 'Maximum amount is $1,000,000'
      } else if (numAmount > (available ?? balance ?? 0)) {
        newErrors.amount = 'Insufficient balance'
      } else {
        // Check decimals
        const decimals = amount.split('.')[1]
        if (decimals && decimals.length > 2) {
          newErrors.amount = 'Maximum 2 decimal places allowed'
        }
      }
    }

    // Note validation
    if (note && note.length > 120) {
      newErrors.note = 'Note must be 120 characters or less'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validate()) {
      return
    }

    await submitWithdrawal(parseFloat(amount), note.trim() || undefined)
    
    // Reset form
    setAmount('')
    setNote('')
    setErrors({})
    onOpenChange(false)
  }

  const handleAmountChange = (value: string) => {
    // Only allow numbers and one decimal point
    const cleaned = value.replace(/[^0-9.]/g, '')
    // Ensure only one decimal point
    const parts = cleaned.split('.')
    if (parts.length > 2) {
      return
    }
    setAmount(cleaned)
    if (errors.amount) {
      setErrors({ ...errors, amount: undefined })
    }
  }

  const availableBalance = available ?? balance ?? 0
  const amountNum = parseFloat(amount) || 0
  const isValid = amount && !errors.amount && !errors.note && amountNum >= 10 && amountNum <= 1000000 && amountNum <= availableBalance

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Withdraw"
      description="Send a withdrawal request to admin"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Amount Input */}
        <div className="space-y-2">
          <label htmlFor="withdraw-amount" className="text-sm font-medium text-text">
            Amount <span className="text-danger">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">$</span>
            <Input
              id="withdraw-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="0.00"
              className="pl-8"
              disabled={isSubmitting}
              autoFocus
            />
          </div>
          {errors.amount && (
            <p className="text-xs text-danger">{errors.amount}</p>
          )}
          <p className="text-xs text-text-muted">
            Minimum: $10.00 | Maximum: $1,000,000.00
          </p>
        </div>

        {/* Note Input */}
        <div className="space-y-2">
          <label htmlFor="withdraw-note" className="text-sm font-medium text-text">
            Note (Optional)
          </label>
          <Input
            id="withdraw-note"
            type="text"
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              if (errors.note) {
                setErrors({ ...errors, note: undefined })
              }
            }}
            placeholder="Add a note for the admin..."
            maxLength={120}
            disabled={isSubmitting}
          />
          {errors.note && (
            <p className="text-xs text-danger">{errors.note}</p>
          )}
          <p className="text-xs text-text-muted">
            {note.length}/120 characters
          </p>
        </div>

        {/* Summary */}
        <div className="rounded-lg border border-border bg-surface-2/50 p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Currency:</span>
            <span className="font-medium text-text">{currency}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Current Balance:</span>
            <span className="font-semibold text-text">
              ${(balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Available:</span>
            <span className="font-medium text-text">
              ${availableBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          {amountNum > 0 && (
            <div className="flex justify-between text-sm pt-2 border-t border-border">
              <span className="text-text-muted">Balance After:</span>
              <span className={cn(
                "font-semibold",
                (availableBalance - amountNum) < 0 ? "text-danger" : "text-text"
              )}>
                ${(availableBalance - amountNum).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setAmount('')
              setNote('')
              setErrors({})
              onOpenChange(false)
            }}
            disabled={isSubmitting}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!isValid || isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              'Send Request'
            )}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

