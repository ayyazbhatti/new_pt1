import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Card } from '@/shared/ui/card'
import { Wallet, AdjustmentType, ReasonCategory, Currency, WalletType } from '../types/finance'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { formatCurrency } from '../utils/formatters'

interface ManualAdjustmentModalProps {
  wallet?: Wallet
}

export function ManualAdjustmentModal({ wallet }: ManualAdjustmentModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [userId, setUserId] = useState(wallet?.userId || '')
  const [userEmail, setUserEmail] = useState(wallet?.userEmail || '')
  const [walletType, setWalletType] = useState<WalletType>(wallet?.walletType || 'spot')
  const [currency, setCurrency] = useState<Currency>(wallet?.currency || 'USD')
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('credit')
  const [amount, setAmount] = useState('')
  const [reasonCategory, setReasonCategory] = useState<ReasonCategory>('correction')
  const [adminNote, setAdminNote] = useState('')

  const handleApply = () => {
    if (!userId || !userEmail) {
      toast.error('Please select a user')
      return
    }
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount')
      return
    }
    if (!adminNote.trim()) {
      toast.error('Admin note is required')
      return
    }
    toast.success(`Manual adjustment applied: ${adjustmentType === 'credit' ? '+' : '-'}${formatCurrency(parseFloat(amount), currency)}`)
    closeModal(wallet ? `adjust-${wallet.id}` : 'manual-adjustment')
  }

  const adjustmentAmount = amount ? parseFloat(amount) : 0
  const effectAmount = adjustmentType === 'credit' ? adjustmentAmount : -adjustmentAmount

  return (
    <div className="space-y-4">
      {!wallet && (
        <div>
          <label className="text-sm font-medium text-text mb-2 block">User Email *</label>
          <Input
            type="email"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            placeholder="user@example.com"
          />
        </div>
      )}
      {wallet && (
        <div>
          <label className="text-sm font-medium text-text mb-2 block">User</label>
          <Input value={wallet.userEmail} disabled />
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Wallet Type *</label>
          <Select value={walletType} onValueChange={(value) => setWalletType(value as WalletType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="spot">Spot</SelectItem>
              <SelectItem value="margin">Margin</SelectItem>
              <SelectItem value="funding">Funding</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Currency *</label>
          <Select value={currency} onValueChange={(value) => setCurrency(value as Currency)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
              <SelectItem value="BTC">BTC</SelectItem>
              <SelectItem value="USDT">USDT</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Adjustment Type *</label>
        <Select
          value={adjustmentType}
          onValueChange={(value) => setAdjustmentType(value as AdjustmentType)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="credit">Credit (+)</SelectItem>
            <SelectItem value="debit">Debit (-)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Amount *</label>
        <Input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Reason Category *</label>
        <Select
          value={reasonCategory}
          onValueChange={(value) => setReasonCategory(value as ReasonCategory)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="correction">Correction</SelectItem>
            <SelectItem value="bonus">Bonus</SelectItem>
            <SelectItem value="fee_refund">Fee Refund</SelectItem>
            <SelectItem value="chargeback">Chargeback</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Admin Note *</label>
        <textarea
          value={adminNote}
          onChange={(e) => setAdminNote(e.target.value)}
          className="flex min-h-[100px] w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Required: Explain the reason for this adjustment..."
        />
      </div>
      {amount && (
        <Card className="p-4 bg-surface-2">
          <div className="text-sm font-semibold text-text mb-2">Effect Preview</div>
          <div className="text-sm text-text-muted">
            Available balance will change by{' '}
            <span className={`font-mono font-semibold ${effectAmount >= 0 ? 'text-success' : 'text-danger'}`}>
              {effectAmount >= 0 ? '+' : ''}
              {formatCurrency(effectAmount, currency)}
            </span>
          </div>
        </Card>
      )}
      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button
          variant="outline"
          onClick={() => closeModal(wallet ? `adjust-${wallet.id}` : 'manual-adjustment')}
        >
          Cancel
        </Button>
        <Button onClick={handleApply}>Apply Adjustment</Button>
      </div>
    </div>
  )
}

