import { useNavigate, useLocation } from 'react-router-dom'
import { PageHeader } from '@/shared/layout'
import { ContentShell } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { useLeads } from '../hooks/useLeads'
import { useLeadStages } from '../hooks/useLeadStages'
import { useLeadRealtime } from '../hooks/useLeadRealtime'
import { useLeadPermissions } from '../hooks/useLeadPermissions'
import { LeadStageColumn } from '../components/LeadStageColumn'
import { useMemo } from 'react'
import { cn } from '@/shared/utils'
import { Skeleton } from '@/shared/ui/Skeleton'

const LEADS_NAV_ITEMS: { path: string; label: string }[] = [
  { path: '', label: 'All leads' },
  { path: '/pipeline', label: 'Pipeline' },
  { path: '/tasks', label: 'Tasks' },
  { path: '/settings', label: 'Settings' },
  { path: '/templates', label: 'Templates' },
  { path: '/assignment', label: 'Assignment' },
  { path: '/import', label: 'Import' },
  { path: '/analytics', label: 'Analytics' },
]

interface LeadsPipelinePageProps {
  basePath: string
  assignedOnly?: boolean
}

export function LeadsPipelinePage({ basePath, assignedOnly = false }: LeadsPipelinePageProps) {
  useLeadRealtime()
  const navigate = useNavigate()
  const location = useLocation()
  const { canSettings, canTemplates, canAssignment } = useLeadPermissions()
  const { data: stages, isLoading: stagesLoading } = useLeadStages()
  const { data: list, isLoading: leadsLoading } = useLeads({ page: 1, pageSize: 500, ...(assignedOnly ? {} : {}) })
  const leads = list?.items ?? []

  const leadsByStage = useMemo(() => {
    const map: Record<string, typeof leads> = {}
    for (const s of stages ?? []) {
      map[s.id] = leads.filter((l) => l.stageId === s.id)
    }
    return map
  }, [stages, leads])

  const isLoading = stagesLoading || leadsLoading

  return (
    <ContentShell className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Pipeline"
        description="Drag leads between stages or click a card to open the lead."
      />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {LEADS_NAV_ITEMS.map(({ path, label }) => {
          const fullPath = `${basePath}${path}`
          const isActive =
            fullPath === basePath
              ? location.pathname === basePath || location.pathname === basePath + '/'
              : location.pathname.startsWith(fullPath)
          const show =
            !((path === '/settings' && !canSettings) || (path === '/templates' && !canTemplates) || (path === '/assignment' && !canAssignment))
          if (!show) return null
          return (
            <Button
              key={path || 'all'}
              variant={isActive ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => navigate(fullPath)}
              className={cn(isActive && 'ring-2 ring-accent/50')}
            >
              {label}
            </Button>
          )
        })}
      </div>
      <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-border bg-surface-1/50 overflow-hidden">
        {isLoading ? (
          <div className="flex gap-4 p-4 overflow-x-auto flex-1">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="w-[300px] shrink-0 flex flex-col rounded-lg border border-border bg-surface-2/50 overflow-hidden">
                <Skeleton className="h-12 rounded-none" />
                <div className="p-3 space-y-2">
                  <Skeleton className="h-20 rounded-lg" />
                  <Skeleton className="h-20 rounded-lg" />
                  <Skeleton className="h-20 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-4 p-4 overflow-x-auto overflow-y-hidden flex-1 min-h-0 [scrollbar-gutter:stable]">
            {(stages ?? []).map((stage) => (
              <LeadStageColumn
                key={stage.id}
                stage={stage}
                leads={leadsByStage[stage.id] ?? []}
                onLeadClick={(lead) => navigate(`${basePath}/${lead.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </ContentShell>
  )
}
