import { cn } from '@/shared/utils'
import type { LeadSource } from '../types/leads'
import { LEAD_SOURCE_LABELS } from '../types/leads'

interface SourceBadgeProps {
  source: LeadSource
  className?: string
}

export function SourceBadge({ source, className }: SourceBadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center rounded-md bg-surface-2 px-2 py-0.5 text-xs text-text-muted', className)}
    >
      {LEAD_SOURCE_LABELS[source]}
    </span>
  )
}
