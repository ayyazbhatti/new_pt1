import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { DataTable } from '@/shared/ui/table'
import { EmptyState } from '@/shared/ui/empty'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { Input } from '@/shared/ui/input'
import { useModalStore } from '@/app/store'
import { FileCheck, Search, Eye, Users, Clock, CheckCircle, XCircle, FileQuestion, Loader2 } from 'lucide-react'
import { cn } from '@/shared/utils'
import { KycSubmissionDetailModal } from '../components/KycSubmissionDetailModal'
import { listKycSubmissions } from '../api/kyc.api'
import type { KycSubmissionRow, KycStatus } from '../types/kyc'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const STATUS_CONFIG: Record<KycStatus, { label: string; className: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', className: 'bg-surface-2 text-text-muted', icon: FileQuestion },
  pending: { label: 'Pending', className: 'bg-amber-500/20 text-amber-400', icon: Clock },
  under_review: { label: 'Under review', className: 'bg-blue-500/20 text-blue-400', icon: FileCheck },
  approved: { label: 'Approved', className: 'bg-success/20 text-success', icon: CheckCircle },
  rejected: { label: 'Rejected', className: 'bg-danger/20 text-danger', icon: XCircle },
}

function StatusBadge({ status }: { status: KycStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  const Icon = config.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  )
}

export function AdminKycPage() {
  const openModal = useModalStore((state) => state.openModal)
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const { data, isLoading } = useQuery({
    queryKey: ['kyc', 'admin-list', page, pageSize, statusFilter, search],
    queryFn: () =>
      listKycSubmissions({
        page,
        page_size: pageSize,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        search: search.trim() || undefined,
      }),
    placeholderData: keepPreviousData,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, totalPages)

  const invalidateList = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['kyc', 'admin-list'] })
  }, [queryClient])

  const handleView = useCallback(
    (submission: KycSubmissionRow) => {
      openModal(
        `kyc-detail-${submission.id}`,
        <KycSubmissionDetailModal
          submissionId={submission.id}
          modalKey={`kyc-detail-${submission.id}`}
          onSuccess={invalidateList}
        />,
        { title: `KYC – ${submission.userName}`, size: 'lg' }
      )
    },
    [openModal, invalidateList]
  )

  useEffect(() => {
    setPage(1)
  }, [statusFilter, search])

  const totalCount = data?.total ?? 0

  const columns: ColumnDef<KycSubmissionRow>[] = [
    {
      accessorKey: 'userName',
      header: 'Name',
      cell: ({ row }) => (
        <span className="font-medium text-text whitespace-nowrap">
          {row.original.userName || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'userEmail',
      header: 'Email',
      cell: ({ row }) => (
        <span className="text-sm text-text-muted whitespace-nowrap break-all">
          {row.original.userEmail || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: 'submittedAt',
      header: 'Submitted',
      cell: ({ row }) => (
        <span className="text-sm text-text-muted whitespace-nowrap">
          {formatDate(row.original.submittedAt)}
        </span>
      ),
    },
    {
      accessorKey: 'reviewedAt',
      header: 'Reviewed',
      cell: ({ row }) => (
        <span className="text-sm text-text-muted whitespace-nowrap">
          {row.original.reviewedAt ? formatDate(row.original.reviewedAt) : '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div data-no-row-click>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleView(row.original)}
            className="text-text-muted hover:text-text"
          >
            <Eye className="h-4 w-4 mr-1.5" />
            View
          </Button>
        </div>
      ),
    },
  ]

  return (
    <ContentShell>
      <PageHeader
        title="KYC"
        description="Review and verify user identity submissions."
      />

      {/* Total count from API */}
      <div className="mb-6">
        <Card className="p-4 inline-flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-text-muted">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-muted">Total submissions</div>
              <div className="text-xl font-bold text-text">{totalCount}</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="under_review">Under review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table or empty state */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 rounded-lg border border-border">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-border overflow-hidden">
          <EmptyState
            icon={<FileQuestion className="h-12 w-12" />}
            title="No submissions found"
            description="No KYC submissions match your filters. Try changing the status or search term."
          />
        </div>
      ) : (
        <DataTable
          data={items}
          columns={columns}
          onRowClick={handleView}
          rowClickTitle="View submission"
          pagination={{
            page: currentPage,
            pageSize,
            total,
            onPageChange: setPage,
            onPageSizeChange: (size) => {
              setPageSize(size)
              setPage(1)
            },
          }}
        />
      )}
    </ContentShell>
  )
}
