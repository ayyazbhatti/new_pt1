import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import {
  Wallet,
  ArrowDownToLine,
  CreditCard,
  Building2,
  FileCheck,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
} from 'lucide-react'
import { useDepositFlow } from '@/features/wallet/hooks/useDepositFlow'
import { useWalletStore } from '@/shared/store/walletStore'
import { fetchDepositHistory, fetchBalance, type DepositHistoryItem } from '@/features/wallet/api'
import { useAuthStore } from '@/shared/store/auth.store'
import { cn } from '@/shared/utils'

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase()
  if (s === 'completed' || s === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
        <CheckCircle className="h-3 w-3" />
        Completed
      </span>
    )
  }
  if (s === 'rejected' || s === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2.5 py-1 text-xs font-medium text-danger">
        <XCircle className="h-3 w-3" />
        Rejected
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-500">
      <Clock className="h-3 w-3" />
      Pending
    </span>
  )
}

const DEPOSIT_HISTORY_QUERY_KEY = ['account', 'deposits']

const MIN_AMOUNT = 10
const MAX_AMOUNT = 1_000_000

type PaymentMethodId = 'bank' | 'card' | 'crypto' | 'request'

const PAYMENT_METHODS: { id: PaymentMethodId; label: string; icon: React.ElementType; min: number; max: number; disabled?: boolean; badge?: string; subtext?: string }[] = [
  { id: 'bank', label: 'Bank transfer', icon: Building2, min: 100, max: 10_000, disabled: true },
  { id: 'card', label: 'Credit / debit card', icon: CreditCard, min: 50, max: 5_000, disabled: true },
  { id: 'crypto', label: 'Cryptocurrency', icon: ArrowDownToLine, min: 25, max: 20_000, disabled: true },
  { id: 'request', label: 'Deposit request', icon: FileCheck, min: MIN_AMOUNT, max: MAX_AMOUNT, badge: 'Requires approval', subtext: 'Admin approval required' },
]

export function UserDepositPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const { balance, currency, setWalletData, setLoading } = useWalletStore()
  const { submitDeposit, isSubmitting } = useDepositFlow()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ amount?: string; note?: string }>({})
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodId>('request')

  useEffect(() => {
    if (!user?.id) return
    fetchBalance()
      .then((res) => {
        const r = res as { available?: number; currency?: string; locked?: number; equity?: number; marginUsed?: number; freeMargin?: number }
        setWalletData({
          balance: r.available ?? 0,
          currency: r.currency ?? 'USD',
          available: r.available ?? 0,
          locked: r.locked ?? 0,
          equity: r.equity ?? r.available ?? 0,
          margin_used: r.marginUsed ?? 0,
          free_margin: r.freeMargin ?? r.available ?? 0,
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user?.id, setWalletData, setLoading])

  const { data: deposits, isLoading: historyLoading, error: historyError, refetch: refetchHistory } = useQuery({
    queryKey: DEPOSIT_HISTORY_QUERY_KEY,
    queryFn: fetchDepositHistory,
  })

  const selectedMethodConfig = PAYMENT_METHODS.find((m) => m.id === selectedMethod)
  const currentMin = selectedMethodConfig?.min ?? MIN_AMOUNT
  const currentMax = selectedMethodConfig?.max ?? MAX_AMOUNT

  const validate = (): boolean => {
    const newErrors: { amount?: string; note?: string } = {}
    if (!amount || amount.trim() === '') {
      newErrors.amount = 'Amount is required'
    } else {
      const numAmount = parseFloat(amount)
      if (isNaN(numAmount)) {
        newErrors.amount = 'Amount must be a number'
      } else if (numAmount < currentMin) {
        newErrors.amount = `Minimum amount is $${currentMin.toLocaleString()}`
      } else if (numAmount > currentMax) {
        newErrors.amount = `Maximum amount is $${currentMax.toLocaleString()}`
      } else {
        const decimals = amount.split('.')[1]
        if (decimals && decimals.length > 2) {
          newErrors.amount = 'Maximum 2 decimal places allowed'
        }
      }
    }
    if (note && note.length > 120) {
      newErrors.note = 'Note must be 120 characters or less'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleAmountChange = (value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, '')
    const parts = cleaned.split('.')
    if (parts.length > 2) return
    setAmount(cleaned)
    if (errors.amount) setErrors({ ...errors, amount: undefined })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    await submitDeposit(parseFloat(amount), note.trim() || undefined)
    setAmount('')
    setNote('')
    setErrors({})
    queryClient.invalidateQueries({ queryKey: DEPOSIT_HISTORY_QUERY_KEY })
  }

  const canSubmit = selectedMethod === 'request'
  const isValid = amount && !errors.amount && !errors.note && parseFloat(amount) >= currentMin && parseFloat(amount) <= currentMax

  return (
    <ContentShell>
      <PageHeader
        title="Deposit funds"
        description="Add funds to your account"
      />

      {/* Two-column: Left = payment methods list, Right = enter amount */}
      <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Left: Select payment method — stacked cards, fixed width on large screens */}
        <section className="lg:w-[320px] lg:shrink-0">
          <h2 className="mb-3 text-base font-semibold text-text">Select payment method</h2>
          <div className="space-y-2">
            {PAYMENT_METHODS.map((method) => {
              const Icon = method.icon
              const isSelected = selectedMethod === method.id
              const isDisabled = method.disabled
              return (
                <button
                  key={method.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => !isDisabled && setSelectedMethod(method.id)}
                  className={cn(
                    'w-full rounded-lg border px-4 py-3 text-left transition-colors',
                    isDisabled && 'cursor-not-allowed opacity-60',
                    !isDisabled && 'hover:border-border hover:bg-surface-2/50',
                    isSelected && !isDisabled && 'border-accent bg-accent/10 ring-1 ring-accent/20'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                      isSelected && !isDisabled ? 'bg-accent/20' : 'bg-surface-2'
                    )}>
                      <Icon className={cn('h-5 w-5', isSelected && !isDisabled ? 'text-accent' : 'text-text-muted')} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('font-medium', isSelected && !isDisabled ? 'text-text' : 'text-text-muted')}>
                          {method.label}
                        </span>
                        {method.badge && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-accent bg-accent/15">
                            {method.badge}
                          </span>
                        )}
                      </div>
                      {method.subtext && (
                        <p className="mt-0.5 text-xs text-text-muted">{method.subtext}</p>
                      )}
                      <p className="mt-1 text-xs text-text-muted">
                        Min: ${method.min.toLocaleString()} • Max: ${method.max.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* Right: Enter amount — single card, form only */}
        <section className="min-w-0 flex-1">
          <h2 className="mb-3 text-base font-semibold text-text">Enter amount</h2>
          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2">
              <span className="text-sm text-text-muted">Balance</span>
              <span className="font-semibold text-text">
                ${(balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency ?? 'USD'}
              </span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="deposit-amount" className="text-sm font-medium text-text">
                  Amount (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">$</span>
                  <Input
                    id="deposit-amount"
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => handleAmountChange(e.target.value)}
                    placeholder="0.00"
                    className="pl-8"
                    disabled={isSubmitting || !canSubmit}
                  />
                </div>
                {errors.amount && <p className="text-xs text-danger">{errors.amount}</p>}
                <p className="text-xs text-text-muted">
                  Min: ${currentMin.toLocaleString()} • Max: ${currentMax.toLocaleString()}
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="deposit-note" className="text-sm font-medium text-text">
                  Note <span className="font-normal text-text-muted">(optional)</span>
                </label>
                <Input
                  id="deposit-note"
                  type="text"
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value)
                    if (errors.note) setErrors({ ...errors, note: undefined })
                  }}
                  placeholder="Note for admin"
                  maxLength={120}
                  disabled={isSubmitting}
                  className="text-sm"
                />
                {errors.note && <p className="text-xs text-danger">{errors.note}</p>}
              </div>

              <Button
                type="submit"
                variant="primary"
                disabled={!canSubmit || !isValid || isSubmitting}
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Continue to payment'
                )}
              </Button>
            </form>
          </Card>
        </section>
      </div>

      {/* Recent deposits — full width below */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-text">Recent deposits</h2>
        <Card className="overflow-hidden">
          {historyLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
              <Loader2 className="mb-3 h-8 w-8 animate-spin" />
              <p className="text-sm">Loading…</p>
            </div>
          ) : historyError ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-danger">
                {(historyError as Error)?.message || 'Failed to load deposit history.'}
              </p>
              <Button variant="outline" size="sm" onClick={() => refetchHistory()}>
                Retry
              </Button>
            </div>
          ) : !deposits || deposits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Wallet className="mb-3 h-10 w-10 text-text-muted/50" />
              <p className="text-sm font-medium text-text-muted">No deposits yet</p>
              <p className="mt-1 text-xs text-text-muted">
                Your deposit requests will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {(deposits as DepositHistoryItem[]).map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-2/20">
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="font-semibold text-text">
                      ${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-sm text-text-muted">{formatDate(item.createdAt)}</span>
                  </div>
                  <StatusBadge status={item.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </ContentShell>
  )
}
