import { memo } from 'react'
import { formatDate } from '@/shared/utils/time'
import { mockUsers } from '../api/leads.mock'
import type { Lead } from '../types/leads.types'
import { cn } from '@/shared/utils'

function getOwnerName(ownerUserId: string): string {
  return mockUsers.find((u) => u.id === ownerUserId)?.name ?? ownerUserId
}

function getOwnerInitials(ownerUserId: string): string {
  const name = getOwnerName(ownerUserId)
  const parts = name.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

interface LeadCardProps {
  lead: Lead
  stageName?: string
  stageColor?: string
  onClick?: () => void
  className?: string
  /** Pipeline view: compact card without stage badge */
  variant?: 'default' | 'pipeline'
}

export const LeadCard = memo(function LeadCard({ lead, stageName, stageColor, onClick, className, variant = 'default' }: LeadCardProps) {
  const ownerName = getOwnerName(lead.ownerUserId)
  const ownerInitials = getOwnerInitials(lead.ownerUserId)
  const isPipeline = variant === 'pipeline'

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'rounded-lg border border-border bg-surface-1 p-3 text-left transition-all duration-150',
        'hover:border-accent/30 hover:shadow-md hover:bg-surface-1',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        onClick && 'cursor-pointer',
        isPipeline && 'border-border/80',
        className
      )}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick?.()}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-text text-sm truncate">
            {lead.firstName} {lead.lastName}
          </p>
          <p className="text-xs text-text-muted truncate mt-0.5">{lead.email}</p>
        </div>
        {!isPipeline && stageName && (
          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: stageColor ?? '#6b7280' }}
          >
            {stageName}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span
          className={cn(
            'shrink-0 text-xs font-medium px-2 py-0.5 rounded-full',
            lead.score >= 70 && 'bg-success/15 text-success',
            lead.score >= 40 && lead.score < 70 && 'bg-accent/15 text-accent',
            lead.score < 40 && 'bg-surface-2 text-text-muted'
          )}
        >
          {lead.score}
        </span>
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="shrink-0 w-6 h-6 rounded-full bg-surface-2 flex items-center justify-center text-[10px] font-medium text-text-muted"
            title={ownerName}
          >
            {ownerInitials}
          </span>
          <span className="text-xs text-text-muted truncate">{ownerName}</span>
        </div>
      </div>
      {lead.nextFollowupAt && (
        <p className="mt-2 text-[11px] text-text-muted border-t border-border/50 pt-2">
          Next: {formatDate(lead.nextFollowupAt)}
        </p>
      )}
    </div>
  )
})
