import { useState, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { ContentShell } from '@/shared/layout'
import { useLeads } from '../hooks/useLeads'
import { useLeadStages } from '../hooks/useLeadStages'
import { useLeadRealtime } from '../hooks/useLeadRealtime'
import { useLeadPermissions } from '../hooks/useLeadPermissions'
import { useLeadsUiStore } from '../store/leads.ui.store'
import { useAuthStore } from '@/shared/store/auth.store'
import { LeadsFiltersBar, type LeadsFiltersState } from '../components/LeadsFiltersBar'
import { LeadsTable } from '../components/LeadsTable'
import { CreateLeadModal } from '../components/modals/CreateLeadModal'
import type { LeadStatus } from '../types/leads.types'
import { Plus, Upload, Download } from 'lucide-react'
import { cn } from '@/shared/utils'

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

interface LeadsPageProps {
  basePath: string // '/admin/leads' or '/agent/leads'
  /** When true, filter to current user's assigned leads only */
  assignedOnly?: boolean
}

export function LeadsPage({ basePath, assignedOnly = false }: LeadsPageProps) {
  useLeadRealtime()
  const navigate = useNavigate()
  const location = useLocation()
  const userId = useAuthStore((s) => s.user?.id)
  const { canCreate, canExport, canAssign, canImport, canViewAll, canSettings, canTemplates, canAssignment } = useLeadPermissions()
  const openModal = useLeadsUiStore((s) => s.openModal)
  const [filters, setFilters] = useState<LeadsFiltersState>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const params = useMemo(
    () => ({
      ...filters,
      status: filters.status as LeadStatus | undefined,
      page,
      pageSize,
      ...(assignedOnly && !canViewAll && userId ? { ownerUserId: userId } : {}),
    }),
    [filters, page, pageSize, assignedOnly, canViewAll, userId]
  )

  const { data, isLoading } = useLeads(params)
  const { data: stages } = useLeadStages()

  const leads = data?.items ?? []
  const total = data?.total ?? 0

  const openCreate = () => openModal('createLead')

  return (
    <ContentShell className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Leads"
        actions={
          <div className="flex items-center gap-2">
            {canCreate && (
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4 mr-2" />
                Create Lead
              </Button>
            )}
            {canImport && (
              <Button variant="secondary" onClick={() => navigate(`${basePath}/import`)}>
                <Upload className="w-4 h-4 mr-2" />
                Import
              </Button>
            )}
            {canExport && (
              <Button variant="secondary" onClick={() => {}}>
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            )}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {LEADS_NAV_ITEMS.map(({ path, label }) => {
          const fullPath = `${basePath}${path}`
          const isActive =
            fullPath === basePath
              ? location.pathname === basePath || location.pathname === basePath + '/'
              : location.pathname.startsWith(fullPath)
          const show =
            (path === '/settings' && !canSettings) ||
            (path === '/templates' && !canTemplates) ||
            (path === '/assignment' && !canAssignment)
              ? false
              : true
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
      <LeadsFiltersBar filters={filters} onFiltersChange={setFilters} className="mb-4" />
      <div className="flex-1 min-h-0 rounded-lg border border-border bg-surface-1 p-4 overflow-auto">
        {isLoading ? (
          <div className="animate-pulse space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-surface-2 rounded" />
            ))}
          </div>
        ) : (
          <LeadsTable
            leads={leads}
            stages={stages ?? []}
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
            onRowClick={(lead) => navigate(`${basePath}/${lead.id}`)}
            basePath={basePath}
            canAssign={canAssign}
            canExport={canExport}
          />
        )}
      </div>
      <CreateLeadModal />
    </ContentShell>
  )
}
