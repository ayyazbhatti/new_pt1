import { useState } from 'react'
import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Transaction } from '../types/finance'
import { useModalStore } from '@/app/store'
import { useCanAccess } from '@/shared/utils/permissions'
import { ApproveRejectModal } from './ApproveRejectModal'
import { formatDateTime, formatCurrency } from '../utils/formatters'
import { CheckCircle, X } from 'lucide-react'

interface TransactionDetailsModalProps {
  transaction: Transaction
}

export function TransactionDetailsModal({ transaction }: TransactionDetailsModalProps) {
  const openModal = useModalStore((state) => state.openModal)
  const closeModal = useModalStore((state) => state.closeModal)
  const canApprove = useCanAccess('deposits:approve')
  const canReject = useCanAccess('deposits:reject')
  const [adminNotes, setAdminNotes] = useState(transaction.adminNotes || '')

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
      completed: 'success',
      pending: 'warning',
      rejected: 'danger',
      failed: 'danger',
    }
    return <Badge variant={variants[status] || 'neutral'}>{status}</Badge>
  }

  const handleApprove = () => {
    openModal(
      `approve-tx-${transaction.id}`,
      <ApproveRejectModal transaction={transaction} action="approve" />,
      {
        title: 'Approve Transaction',
        size: 'sm',
      }
    )
  }

  const handleReject = () => {
    openModal(
      `reject-tx-${transaction.id}`,
      <ApproveRejectModal transaction={transaction} action="reject" />,
      {
        title: 'Reject Transaction',
        size: 'sm',
      }
    )
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-surface-2">
        <div className="text-sm font-semibold text-text mb-3">Summary</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-text-muted mb-1">Transaction ID</div>
            <div className="font-mono text-sm text-text">{transaction.id}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Status</div>
            {getStatusBadge(transaction.status)}
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">User</div>
            <div className="text-sm text-text">{transaction.user.name || transaction.user.email}</div>
            <div className="text-xs text-text-muted">{transaction.user.email}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Reference</div>
            <div className="font-mono text-sm text-text">{transaction.reference}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Created</div>
            <div className="text-sm text-text-muted">{formatDateTime(transaction.createdAt)}</div>
          </div>
          {transaction.updatedAt && (
            <div>
              <div className="text-xs text-text-muted mb-1">Updated</div>
              <div className="text-sm text-text-muted">{formatDateTime(transaction.updatedAt)}</div>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-4 bg-surface-2">
        <div className="text-sm font-semibold text-text mb-3">Financial</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-text-muted mb-1">Amount</div>
            <div className="font-mono font-semibold text-text">
              {formatCurrency(transaction.amount, transaction.currency)}
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Fee</div>
            <div className="font-mono text-text">
              {formatCurrency(transaction.fee, transaction.currency)}
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Net Amount</div>
            <div
              className={`font-mono font-semibold ${
                transaction.netAmount >= 0 ? 'text-success' : 'text-danger'
              }`}
            >
              {transaction.netAmount >= 0 ? '+' : ''}
              {formatCurrency(transaction.netAmount, transaction.currency)}
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Currency</div>
            <div className="font-mono text-text">{transaction.currency}</div>
          </div>
        </div>
      </Card>

      {transaction.methodDetails && (
        <Card className="p-4 bg-surface-2">
          <div className="text-sm font-semibold text-text mb-3">Method Details</div>
          <div className="space-y-2">
            {transaction.method === 'bank' && (
              <>
                {transaction.methodDetails.iban && (
                  <div>
                    <div className="text-xs text-text-muted mb-1">IBAN</div>
                    <div className="font-mono text-sm text-text">{transaction.methodDetails.iban}</div>
                  </div>
                )}
                {transaction.methodDetails.account && (
                  <div>
                    <div className="text-xs text-text-muted mb-1">Account</div>
                    <div className="font-mono text-sm text-text">{transaction.methodDetails.account}</div>
                  </div>
                )}
                {transaction.methodDetails.bankName && (
                  <div>
                    <div className="text-xs text-text-muted mb-1">Bank Name</div>
                    <div className="text-sm text-text">{transaction.methodDetails.bankName}</div>
                  </div>
                )}
              </>
            )}
            {transaction.method === 'crypto' && (
              <>
                {transaction.methodDetails.network && (
                  <div>
                    <div className="text-xs text-text-muted mb-1">Network</div>
                    <div className="text-sm text-text">{transaction.methodDetails.network}</div>
                  </div>
                )}
                {transaction.methodDetails.address && (
                  <div>
                    <div className="text-xs text-text-muted mb-1">Address</div>
                    <div className="font-mono text-sm text-text break-all">
                      {transaction.methodDetails.address}
                    </div>
                  </div>
                )}
                {transaction.methodDetails.txHash && (
                  <div>
                    <div className="text-xs text-text-muted mb-1">Transaction Hash</div>
                    <div className="font-mono text-sm text-text break-all">
                      {transaction.methodDetails.txHash}
                    </div>
                  </div>
                )}
              </>
            )}
            {transaction.method === 'card' && (
              <>
                {transaction.methodDetails.provider && (
                  <div>
                    <div className="text-xs text-text-muted mb-1">Provider</div>
                    <div className="text-sm text-text">{transaction.methodDetails.provider}</div>
                  </div>
                )}
                {transaction.methodDetails.maskedCard && (
                  <div>
                    <div className="text-xs text-text-muted mb-1">Card</div>
                    <div className="font-mono text-sm text-text">{transaction.methodDetails.maskedCard}</div>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      )}

      <Card className="p-4 bg-surface-2">
        <div className="text-sm font-semibold text-text mb-3">Admin Notes</div>
        <textarea
          value={adminNotes}
          onChange={(e) => setAdminNotes(e.target.value)}
          className="flex min-h-[100px] w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Add admin notes..."
        />
      </Card>

      {transaction.status === 'pending' && (
        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button variant="outline" onClick={() => closeModal(`tx-details-${transaction.id}`)}>
            Close
          </Button>
          {canApprove && (
            <Button
              variant="outline"
              className="text-success hover:text-success hover:bg-success/10"
              onClick={handleApprove}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Approve
            </Button>
          )}
          {canReject && (
            <Button
              variant="outline"
              className="text-danger hover:text-danger hover:bg-danger/10"
              onClick={handleReject}
            >
              <X className="h-4 w-4 mr-2" />
              Reject
            </Button>
          )}
        </div>
      )}
      {transaction.status !== 'pending' && (
        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button variant="outline" onClick={() => closeModal(`tx-details-${transaction.id}`)}>
            Close
          </Button>
        </div>
      )}
    </div>
  )
}

