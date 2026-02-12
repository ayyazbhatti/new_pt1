import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Input } from '@/shared/ui/input'
import { Transaction } from '../types/finance'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { approveTransaction, rejectTransaction } from '../api/finance.api'
import { Loader2 } from 'lucide-react'

interface ApproveRejectModalProps {
  transaction: Transaction
  action: 'approve' | 'reject'
  onSuccess?: () => void
}

export function ApproveRejectModal({ transaction, action, onSuccess }: ApproveRejectModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [rejectionReason, setRejectionReason] = useState('')
  const [rejectionNote, setRejectionNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleConfirm = async () => {
    if (action === 'approve') {
      setIsSubmitting(true)
      try {
        await approveTransaction(transaction.id)
        toast.success(`Transaction ${transaction.id} approved successfully`)
        onSuccess?.()
        closeModal(`approve-tx-${transaction.id}`)
      } catch (error: any) {
        const errorMessage = error?.response?.data?.error?.message || 'Failed to approve transaction'
        toast.error(errorMessage)
      } finally {
        setIsSubmitting(false)
      }
    } else {
      if (!rejectionReason) {
        toast.error('Please select a rejection reason')
        return
      }
      setIsSubmitting(true)
      try {
        await rejectTransaction(transaction.id, rejectionReason, rejectionNote || undefined)
        toast.success(`Transaction ${transaction.id} rejected`)
        onSuccess?.()
        closeModal(`reject-tx-${transaction.id}`)
      } catch (error: any) {
        const errorMessage = error?.response?.data?.error?.message || 'Failed to reject transaction'
        toast.error(errorMessage)
      } finally {
        setIsSubmitting(false)
      }
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
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {action === 'approve' ? 'Approving...' : 'Rejecting...'}
            </>
          ) : (
            action === 'approve' ? 'Approve' : 'Reject'
          )}
        </Button>
      </div>
    </div>
  )
}

