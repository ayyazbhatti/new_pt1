import { useState, useMemo, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useDebouncedValue } from '@/shared/hooks/useDebounce'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import { useCanAccess } from '@/shared/utils/permissions'
import { listLeads } from '../api/leads.api'
import { LeadsFiltersBar, type LeadFilters } from '../components/LeadsFiltersBar'
import { LeadsTable } from '../components/LeadsTable'
import { AddLeadModal } from '../modals/AddLeadModal'
import { ImportLeadsModal } from '../modals/ImportLeadsModal'
import {
  Plus,
  Download,
  Upload,
  Users,
  Sparkles,
  Activity,
  CheckCircle,
  XCircle,
  Percent,
} from 'lucide-react'

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function AdminLeadsPage() {
  const navigate = useNavigate()
  const openModal = useModalStore((state) => state.openModal)
  const queryClient = useQueryClient()

  const canView = useCanAccess('leads:view')
  const canCreate = useCanAccess('leads:create')
  const canExport = useCanAccess('leads:export')

  const [filters, setFilters] = useState<LeadFilters>({
    search: '',
    status: 'all',
    source: 'all',
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const debouncedSearch = useDebouncedValue(filters.search, 400)

  const {
    data: listData,
    isLoading,
    error,
    isFetching,
  } = useQuery({
    queryKey: [
      'leads',
      page,
      pageSize,
      debouncedSearch,
      filters.status,
      filters.source,
    ] as const,
    queryFn: () =>
      listLeads({
        page,
        page_size: pageSize,
        search: debouncedSearch.trim() || undefined,
        status: filters.status !== 'all' ? filters.status : undefined,
        source: filters.source !== 'all' ? filters.source : undefined,
      }),
    placeholderData: keepPreviousData,
  })

  const leads = listData?.items ?? []
  const total = listData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, totalPages)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, filters.status, filters.source])

  const stats = useMemo(
    () => ({
      total,
      newCount: 0,
      inProgress: 0,
      converted: 0,
      lost: 0,
      conversionRate: 0,
      hasBreakdown: false,
    }),
    [total]
  )

  const handleAddLead = useCallback(() => {
    openModal(
      'leads-add',
      <AddLeadModal
        modalKey="leads-add"
        onSuccess={(id) => {
          queryClient.invalidateQueries({ queryKey: ['leads'] })
          navigate(`/admin/leads/${id}`)
        }}
      />,
      { title: 'Add lead', description: 'Create a new lead.', size: 'md' }
    )
  }, [openModal, navigate, queryClient])

  const handleImport = useCallback(() => {
    openModal(
      'leads-import',
      <ImportLeadsModal
        modalKey="leads-import"
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['leads'] })
        }}
      />,
      {
        title: 'Import leads',
        description:
          'Upload a CSV file. Headers: name, email, phone, company, source, campaign, notes.',
        size: 'md',
      }
    )
  }, [openModal, queryClient])

  const handleExport = useCallback(() => {
    const headers = [
      'ID',
      'Name',
      'Email',
      'Phone',
      'Company',
      'Source',
      'Status',
      'Owner',
      'Score',
      'Created',
      'Last activity',
    ]
    const rows = leads.map((l) => [
      l.id,
      l.name,
      l.email,
      l.phone ?? '',
      l.company ?? '',
      l.source,
      l.status,
      l.ownerName ?? '',
      l.score ?? '',
      l.createdAt,
      l.lastActivityAt ?? '',
    ])
    const csv = [
      headers.map(escapeCsvCell).join(','),
      ...rows.map((r) => r.map(escapeCsvCell).join(',')),
    ].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [leads])

  const handlePageChange = (newPage: number) => {
    setPage(Math.max(1, Math.min(newPage, totalPages)))
  }

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize)
    setPage(1)
  }

  if (!canView) {
    return (
      <ContentShell>
        <PageHeader title="Leads" description="Manage potential customers." />
        <p className="text-sm text-text-muted">
          You do not have permission to view leads.
        </p>
      </ContentShell>
    )
  }

  if (error) {
    return (
      <ContentShell>
        <PageHeader title="Leads" />
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-danger mb-2">Failed to load leads</div>
            <div className="text-sm text-text-muted">
              {error instanceof Error ? error.message : 'Unknown error'}
            </div>
          </div>
        </div>
      </ContentShell>
    )
  }

  const isInitialLoading = isLoading && !listData

  return (
    <ContentShell>
      {isInitialLoading && (
        <div className="flex items-center justify-center h-64">
          <div className="text-text-muted">Loading leads…</div>
        </div>
      )}
      {!isInitialLoading && (
        <>
          <PageHeader
            title="Leads"
            description="Manage and convert potential customers. Track status, owner, and activities."
            actions={
              <div className="flex items-center gap-2">
                {canExport && (
                  <Button
                    variant="outline"
                    onClick={handleExport}
                    disabled={leads.length === 0}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export CSV
                  </Button>
                )}
                {canCreate && (
                  <>
                    <Button variant="outline" onClick={handleImport}>
                      <Upload className="h-4 w-4 mr-2" />
                      Import
                    </Button>
                    <Button onClick={handleAddLead}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add lead
                    </Button>
                  </>
                )}
              </div>
            }
          />

          {/* Statistics */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6 mb-6">
            <Card className="p-4 flex flex-col gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-muted">
                  Total leads
                </div>
                <div className="text-2xl font-bold text-text">{stats.total}</div>
              </div>
            </Card>
            <Card className="p-4 flex flex-col gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-muted">New</div>
                <div className="text-2xl font-bold text-text">
                  {stats.hasBreakdown ? stats.newCount : '—'}
                </div>
              </div>
            </Card>
            <Card className="p-4 flex flex-col gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-muted">
                  In progress
                </div>
                <div className="text-2xl font-bold text-text">
                  {stats.hasBreakdown ? stats.inProgress : '—'}
                </div>
              </div>
            </Card>
            <Card className="p-4 flex flex-col gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 text-success">
                <CheckCircle className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-muted">
                  Converted
                </div>
                <div className="text-2xl font-bold text-text">
                  {stats.hasBreakdown ? stats.converted : '—'}
                </div>
              </div>
            </Card>
            <Card className="p-4 flex flex-col gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-danger/10 text-danger">
                <XCircle className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-muted">Lost</div>
                <div className="text-2xl font-bold text-text">
                  {stats.hasBreakdown ? stats.lost : '—'}
                </div>
              </div>
            </Card>
            <Card className="p-4 flex flex-col gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-1 text-text-muted border border-border">
                <Percent className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-muted">
                  Conversion rate
                </div>
                <div className="text-2xl font-bold text-text">
                  {stats.hasBreakdown ? `${stats.conversionRate}%` : '—'}
                </div>
              </div>
            </Card>
          </div>

          <div className="relative">
            {isFetching && (
              <div className="absolute top-0 right-0 z-10 flex items-center gap-1.5 rounded bg-surface-2/90 px-2 py-1 text-xs text-text-muted">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-text-muted border-t-transparent" />
                Updating…
              </div>
            )}
            <LeadsFiltersBar filters={filters} onFilterChange={setFilters} />
          </div>

          <LeadsTable
            leads={leads}
            pagination={{
              page: currentPage,
              pageSize,
              total,
              onPageChange: handlePageChange,
              onPageSizeChange: handlePageSizeChange,
            }}
            onMutationSuccess={() =>
              queryClient.invalidateQueries({ queryKey: ['leads'] })
            }
          />
        </>
      )}
    </ContentShell>
  )
}
