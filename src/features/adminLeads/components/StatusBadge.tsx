import { cn } from '@/shared/utils'
import type { LeadStatus } from '../types/leads'
import { LEAD_STATUS_LABELS } from '../types/leads'

const STATUS_CLASSES: Record<LeadStatus, string> = {
  new: 'bg-blue-500/20 text-blue-400',
  contacted: 'bg-slate-500/20 text-slate-300',
  qualified: 'bg-green-500/20 text-green-400',
  proposal_sent: 'bg-amber-500/20 text-amber-400',
  negotiation: 'bg-amber-500/20 text-amber-400',
  converted: 'bg-success/20 text-success',
  lost: 'bg-danger/20 text-danger',
}

interface StatusBadgeProps {
  status: LeadStatus
  size?: 'sm' | 'default'
  className?: string
}

export function StatusBadge({ status, size = 'default', className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        STATUS_CLASSES[status],
        className
      )}
      aria-label={LEAD_STATUS_LABELS[status]}
    >
      {LEAD_STATUS_LABELS[status]}
    </span>
  )
}
