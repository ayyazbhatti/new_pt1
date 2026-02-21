import { useMemo } from 'react'
import { LeadCard } from './LeadCard'
import type { Lead, LeadStage } from '../types/leads.types'
import { cn } from '@/shared/utils'
import { EmptyState } from '@/shared/ui/empty'

interface LeadStageColumnProps {
  stage: LeadStage
  leads: Lead[]
  onLeadClick?: (lead: Lead) => void
  className?: string
}

function formatSla(minutes: number | null): string {
  if (minutes == null) return ''
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

export function LeadStageColumn({ stage, leads, onLeadClick, className }: LeadStageColumnProps) {
  const count = useMemo(() => leads.length, [leads.length])
  const slaLabel = formatSla(stage.slaMinutes)

  return (
    <div
      className={cn(
        'flex flex-col w-[300px] min-w-[300px] shrink-0 rounded-xl border border-border bg-surface-2/80 overflow-hidden shadow-sm',
        className
      )}
    >
      <div
        className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between gap-2"
        style={{ borderLeft: `4px solid ${stage.colorToken}` }}
      >
        <span className="font-semibold text-text text-sm truncate">{stage.name}</span>
        <span
          className="shrink-0 min-w-[1.75rem] h-7 px-2 rounded-full flex items-center justify-center text-xs font-medium bg-surface-1 text-text-muted"
        >
          {count}
        </span>
      </div>
      {slaLabel && (
        <div className="shrink-0 px-4 py-1.5 border-b border-border/50">
          <span className="text-xs text-text-muted">SLA: {slaLabel}</span>
        </div>
      )}
      <div className="flex flex-col gap-3 p-3 overflow-y-auto min-h-0 flex-1">
        {leads.length === 0 ? (
          <EmptyState
            description="No leads in this stage"
            className="py-8 text-center"
          />
        ) : (
          leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              stageName={undefined}
              stageColor={stage.colorToken}
              onClick={() => onLeadClick?.(lead)}
              variant="pipeline"
            />
          ))
        )}
      </div>
    </div>
  )
}
