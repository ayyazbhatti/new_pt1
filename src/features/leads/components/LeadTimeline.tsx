import { Phone, Mail, StickyNote, ArrowRight, UserPlus, Circle } from 'lucide-react'
import { useLeadActivities } from '../hooks/useLeadById'
import { formatRelative } from '@/shared/utils/time'
import { mockUsers } from '../api/leads.mock'
import { cn } from '@/shared/utils'
import type { LeadActivityType } from '../types/leads.types'

function getActorName(userId: string): string {
  return mockUsers.find((u) => u.id === userId)?.name ?? userId
}

const iconMap: Record<LeadActivityType, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  note: StickyNote,
  stage_change: ArrowRight,
  assign: UserPlus,
  created: Circle,
}

interface LeadTimelineProps {
  leadId: string
  className?: string
}

export function LeadTimeline({ leadId, className }: LeadTimelineProps) {
  const { data: activities, isLoading } = useLeadActivities(leadId)

  if (isLoading) {
    return (
      <div className={cn('space-y-3', className)}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded bg-surface-2 animate-pulse" />
        ))}
      </div>
    )
  }

  if (!activities?.length) {
    return (
      <div className={cn('rounded-lg border border-border bg-surface-1 p-6 text-center text-text-muted text-sm', className)}>
        No activity yet.
      </div>
    )
  }

  return (
    <div className={cn('space-y-0', className)}>
      {activities.map((a) => {
        const Icon = iconMap[a.type] ?? Circle
        return (
          <div key={a.id} className="flex gap-3 py-2 first:pt-0">
            <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
              <Icon className="w-4 h-4 text-text-muted" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text">
                <span className="font-medium capitalize">{a.type.replace('_', ' ')}</span>
                {' · '}
                <span className="text-text-muted">{getActorName(a.actorUserId)}</span>
              </p>
              {a.type === 'call' && typeof a.payload?.outcome === 'string' && (
                <p className="text-xs text-text-muted mt-0.5">Outcome: {a.payload.outcome}</p>
              )}
              {a.type === 'stage_change' && (
                <p className="text-xs text-text-muted mt-0.5">
                  Stage changed
                </p>
              )}
              <p className="text-xs text-text-muted mt-0.5">{formatRelative(a.createdAt)}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
