import { DepositRequest } from '../types'
import { Button } from '@/shared/ui/button/Button'
import { Loader2 } from 'lucide-react'
import { cn } from '@/shared/utils'

interface DepositRequestRowProps {
  request: DepositRequest
  onApprove: (requestId: string) => Promise<void>
  isApproving: boolean
}

export function DepositRequestRow({
  request,
  onApprove,
  isApproving,
}: DepositRequestRowProps) {
  const handleApprove = async () => {
    await onApprove(request.requestId)
  }

  return (
    <tr className="border-b border-border hover:bg-surface-2/30 transition-colors">
      <td className="px-4 py-3 text-sm font-mono text-text">
        <div className="flex flex-col">
          <span>{request.userId.slice(0, 8)}...</span>
          <span className="text-xs text-text-muted/70 mt-0.5">Req: {request.requestId.slice(0, 8)}...</span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm font-semibold text-text">
        ${request.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </td>
      <td className="px-4 py-3 text-sm text-text-muted max-w-xs truncate">
        {request.note || '-'}
      </td>
      <td className="px-4 py-3 text-sm text-text-muted">
        {new Date(request.createdAt).toLocaleString('en-US', {
          month: 'short',
          day: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            'inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold',
            request.status === 'PENDING' &&
              'bg-warning/20 text-warning border border-warning/30',
            request.status === 'APPROVED' &&
              'bg-success/20 text-success border border-success/30',
            request.status === 'REJECTED' &&
              'bg-danger/20 text-danger border border-danger/30'
          )}
        >
          {request.status}
        </span>
      </td>
      <td className="px-4 py-3">
        {request.status === 'PENDING' ? (
          <Button
            variant="success"
            size="sm"
            onClick={handleApprove}
            disabled={isApproving}
          >
            {isApproving ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                Approving...
              </>
            ) : (
              'Approve'
            )}
          </Button>
        ) : (
          <span className="text-xs text-text-muted">-</span>
        )}
      </td>
    </tr>
  )
}

