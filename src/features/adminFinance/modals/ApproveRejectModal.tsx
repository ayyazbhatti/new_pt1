import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Input } from '@/shared/ui/input'
import { Transaction } from '../types/finance'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'

interface ApproveRejectModalProps {
  transaction: Transaction
  action: 'approve' | 'reject'
}

export function ApproveRejectModal({ transaction, action }: ApproveRejectModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [rejectionReason, setRejectionReason] = useState('')
  const [rejectionNote, setRejectionNote] = useState('')

  const handleConfirm = () => {
    if (action === 'approve') {
      toast.success(`Transaction ${transaction.id} approved`)
      closeModal(`approve-tx-${transaction.id}`)
    } else {
      if (!rejectionReason) {
        toast.error('Please select a rejection reason')
        return
      }
      toast.success(`Transaction ${transaction.id} rejected`)
      closeModal(`reject-tx-${transaction.id}`)
    }
  }

  return (
    <div className="space-y-4">
      {action === 'approve' ? (
        <div className="text-sm text-text">
          Confirm approval. This will {transaction.type === 'deposit' ? 'credit' : 'debit'} the user wallet.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-sm text-text">
            Reject transaction {transaction.id}. Please provide a reason.
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Reason *</label>
            <Select value={rejectionReason} onValueChange={setRejectionReason}>
              <SelectTrigger>
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="insufficient_balance">Insufficient Balance</SelectItem>
                <SelectItem value="invalid_account">Invalid Account</SelectItem>
                <SelectItem value="fraud_suspected">Fraud Suspected</SelectItem>
                <SelectItem value="kyc_required">KYC Required</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Additional Notes</label>
            <textarea
              value={rejectionNote}
              onChange={(e) => setRejectionNote(e.target.value)}
              className="flex min-h-[80px] w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Add additional notes..."
            />
          </div>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-4">
        <Button
          variant="outline"
          onClick={() => closeModal(`${action}-tx-${transaction.id}`)}
        >
          Cancel
        </Button>
        <Button
          variant={action === 'approve' ? 'primary' : 'danger'}
          onClick={handleConfirm}
        >
          {action === 'approve' ? 'Approve' : 'Reject'}
        </Button>
      </div>
    </div>
  )
}

