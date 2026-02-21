import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Badge } from '@/shared/ui/badge'
import { useLeadById } from '../hooks/useLeadById'
import { useLeadStages } from '../hooks/useLeadStages'
import { useChangeStage, useAssignLead } from '../hooks/useLeads'
import { useLeadPermissions } from '../hooks/useLeadPermissions'
import { mockUsers } from '../api/leads.mock'
import { cn } from '@/shared/utils'

interface LeadHeaderProps {
  leadId: string
  basePath: string // '/admin/leads' or '/agent/leads'
}

function getOwnerName(ownerUserId: string): string {
  return mockUsers.find((u) => u.id === ownerUserId)?.name ?? ownerUserId
}

export function LeadHeader({ leadId, basePath }: LeadHeaderProps) {
  const { data: lead, isLoading } = useLeadById(leadId)
  const { data: stages } = useLeadStages()
  const changeStage = useChangeStage()
  const assignLead = useAssignLead()
  const { canAssign } = useLeadPermissions()

  if (isLoading || !lead) {
    return (
      <div className="h-16 rounded-lg bg-surface-2 animate-pulse" />
    )
  }

  const stage = stages?.find((s) => s.id === lead.stageId)
  const ownerName = getOwnerName(lead.ownerUserId)

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-text">
          {lead.firstName} {lead.lastName}
        </h1>
        <Badge variant={lead.status === 'open' ? 'success' : 'neutral'} className="capitalize">
          {lead.status}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-muted">Stage</span>
        <Select
          value={lead.stageId}
          onValueChange={(stageId) => changeStage.mutate({ id: leadId, stageId })}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(stages ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-muted">Owner</span>
        {canAssign ? (
          <Select
            value={lead.ownerUserId}
            onValueChange={(ownerUserId) => assignLead.mutate({ id: leadId, ownerUserId })}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mockUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm text-text">{ownerName}</span>
        )}
      </div>
    </div>
  )
}
