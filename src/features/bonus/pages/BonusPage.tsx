import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ColumnDef } from '@tanstack/react-table'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useAuthStore } from '@/shared/store/auth.store'
import { fetchAdminBonusTransactions, type BonusTxRow } from '@/features/bonus/api/bonusAdmin.api'
import { useModalStore } from '@/app/store'
import { BonusGrantRevokeModal } from '@/features/bonus/modals/BonusGrantRevokeModal'
import { DataTable } from '@/shared/ui/table'
import { useFormatDateTime } from '@/shared/datetime'
import { useDebouncedValue } from '@/shared/hooks/useDebounce'
import { useFormatFromUsd } from '@/shared/currency'
import { cn } from '@/shared/utils'
import { Activity, Gift, ListOrdered, Loader2, MinusCircle, Search, X } from 'lucide-react'

const BONUS_TX_QUERY_KEY = 'admin-bonus-transactions' as const
const BONUS_STATS_QUERY_KEY = 'admin-bonus-stats' as const
const BONUS_STATS_SAMPLE_LIMIT = 500

type BonusTxFilters = {
  userId: string
  adminId: string
  from: string
  to: string
  types: string
}

const emptyFilters: BonusTxFilters = {
  userId: '',
  adminId: '',
  from: '',
  to: '',
  types: '',
}

export function BonusPage() {
  const permissions = useAuthStore((s) => s.user?.permissions ?? [])
  const canView = permissions.includes('bonus:view')
  const canEdit = permissions.includes('bonus:edit')
  const openModal = useModalStore((s) => s.openModal)
  const queryClient = useQueryClient()
  const formatDateTime = useFormatDateTime()
  const formatMoney = useFormatFromUsd()

  const [filters, setFilters] = useState<BonusTxFilters>(emptyFilters)
  const debouncedFilters = useDebouncedValue(filters, 400)
  const debouncedFilterKey = useMemo(() => JSON.stringify(debouncedFilters), [debouncedFilters])

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  useEffect(() => {
    setPage(1)
  }, [debouncedFilterKey])

  const { data, isLoading, isPending, isError, error } = useQuery({
    queryKey: [BONUS_TX_QUERY_KEY, debouncedFilters, page, pageSize],
    queryFn: () =>
      fetchAdminBonusTransactions({
        userId: debouncedFilters.userId.trim() || undefined,
        adminId: debouncedFilters.adminId.trim() || undefined,
        from: debouncedFilters.from.trim() || undefined,
        to: debouncedFilters.to.trim() || undefined,
        type: debouncedFilters.types.trim() || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
    enabled: canView,
  })

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: [BONUS_STATS_QUERY_KEY, debouncedFilterKey],
    queryFn: () =>
      fetchAdminBonusTransactions({
        userId: debouncedFilters.userId.trim() || undefined,
        adminId: debouncedFilters.adminId.trim() || undefined,
        from: debouncedFilters.from.trim() || undefined,
        to: debouncedFilters.to.trim() || undefined,
        type: debouncedFilters.types.trim() || undefined,
        limit: BONUS_STATS_SAMPLE_LIMIT,
        offset: 0,
      }),
    enabled: canView,
    staleTime: 60_000,
  })

  const total = data?.total ?? 0
  const rows = data?.items ?? []

  const statsAgg = useMemo(() => {
    const items = statsData?.items ?? []
    let grants = 0
    let revokes = 0
    let other = 0
    let netSum = 0
    for (const r of items) {
      const t = r.type.toLowerCase()
      if (t === 'bonus_grant') grants += 1
      else if (t === 'bonus_revoke') revokes += 1
      else other += 1
      const n = Number.parseFloat(r.netAmount ?? r.amount ?? '0')
      if (Number.isFinite(n)) netSum += n
    }
    const fullTotal = statsData?.total ?? 0
    const sampleSize = items.length
    const isPartialSample = fullTotal > sampleSize && sampleSize >= BONUS_STATS_SAMPLE_LIMIT
    const isFullSample = fullTotal > 0 && sampleSize === fullTotal
    return { grants, revokes, other, netSum, sampleSize, fullTotal, isPartialSample, isFullSample }
  }, [statsData])

  const invalidateHistory = () => {
    void queryClient.invalidateQueries({ queryKey: [BONUS_TX_QUERY_KEY] })
    void queryClient.invalidateQueries({ queryKey: [BONUS_STATS_QUERY_KEY] })
  }

  const handleOpenBonusModal = () => {
    openModal(
      'bonus-grant-revoke',
      <BonusGrantRevokeModal onSuccess={invalidateHistory} />,
      {
        title: 'Grant or revoke bonus',
        size: 'lg',
      }
    )
  }

  const columns: ColumnDef<BonusTxRow>[] = useMemo(
    () => [
      {
        accessorKey: 'createdAt',
        header: 'Time',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-text-muted">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        accessorKey: 'type',
        header: 'Type',
        cell: ({ row }) => <span className="text-sm capitalize">{row.original.type}</span>,
      },
      {
        accessorKey: 'userId',
        header: 'User',
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.userId}</span>,
      },
      {
        id: 'admin',
        header: 'Admin',
        cell: ({ row }) => {
          const md = row.original.methodDetails
          const adminId =
            md && typeof md === 'object' && md !== null && typeof md.adminUserId === 'string'
              ? md.adminUserId
              : null
          return <span className="font-mono text-xs">{adminId ?? '—'}</span>
        },
      },
      {
        accessorKey: 'amount',
        header: 'Amount',
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.amount}</span>,
      },
      {
        id: 'note',
        header: 'Note',
        cell: ({ row }) => {
          const md = row.original.methodDetails
          const note =
            md && typeof md === 'object' && md !== null && typeof md.note === 'string' ? md.note : null
          const text = note ?? row.original.reference ?? '—'
          return (
            <span className="max-w-xs truncate text-sm text-text-muted" title={text}>
              {text}
            </span>
          )
        },
      },
    ],
    [formatDateTime]
  )

  const hasActiveFilters =
    filters.userId.trim() !== '' ||
    filters.adminId.trim() !== '' ||
    filters.from.trim() !== '' ||
    filters.to.trim() !== '' ||
    filters.types.trim() !== ''

  if (!canView) {
    return (
      <ContentShell>
        <PageHeader title="Bonus" description="Grant, revoke, and audit bonus balances" />
        <p className="text-sm text-text-muted">You need the bonus:view permission to access this page.</p>
      </ContentShell>
    )
  }

  return (
    <ContentShell>
      <PageHeader
        title="Bonus"
        description="Audit bonus ledger entries. Use the action below to grant or revoke bonus for a user."
        actions={
          canEdit ? (
            <Button onClick={handleOpenBonusModal}>
              <Gift className="h-4 w-4 mr-2" />
              Grant or revoke bonus
            </Button>
          ) : null
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-slate-400">
            <ListOrdered className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Ledger entries</p>
            <p className="mt-1 text-lg font-bold text-text">{isPending ? '—' : total}</p>
            <p className="mt-0.5 text-xs text-text-muted">Matching current filters</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-emerald-500">
            <Gift className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Bonus grants</p>
            <p className="mt-1 text-lg font-bold text-text">{statsLoading ? '—' : statsAgg.grants}</p>
            <p className="mt-0.5 text-xs text-text-muted">
              {statsLoading
                ? 'Loading…'
                : statsAgg.isPartialSample
                  ? `First ${BONUS_STATS_SAMPLE_LIMIT} matching rows`
                  : statsAgg.fullTotal === 0
                    ? 'Nothing matches filters'
                    : statsAgg.isFullSample
                      ? 'All matching entries'
                      : 'In matching data'}
            </p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-amber-500">
            <MinusCircle className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Bonus revokes</p>
            <p className="mt-1 text-lg font-bold text-text">{statsLoading ? '—' : statsAgg.revokes}</p>
            <p className="mt-0.5 text-xs text-text-muted">
              {statsLoading
                ? 'Loading…'
                : statsAgg.isPartialSample
                  ? `First ${BONUS_STATS_SAMPLE_LIMIT} matching rows`
                  : statsAgg.fullTotal === 0
                    ? 'Nothing matches filters'
                    : statsAgg.isFullSample
                      ? 'All matching entries'
                      : 'In matching data'}
            </p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-blue-500">
            <Activity className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Net movement (sample)</p>
            <p className="mt-1 text-lg font-bold text-text">
              {statsLoading ? '—' : formatMoney(statsAgg.netSum)}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              {statsLoading
                ? 'Loading…'
                : statsAgg.isPartialSample
                  ? `Sum of net amounts · first ${BONUS_STATS_SAMPLE_LIMIT} rows only`
                  : statsAgg.other > 0
                    ? `Includes ${statsAgg.other} non grant/revoke rows (locks, PnL, …)`
                    : 'Sum of net amounts in matching data'}
            </p>
          </div>
        </Card>
      </div>

      <div className="mb-6 flex min-w-0 flex-wrap items-end gap-x-4 gap-y-3">
        <div className="relative min-h-10 min-w-[min(100%,220px)] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            value={filters.types}
            onChange={(e) => setFilters((f) => ({ ...f, types: e.target.value }))}
            placeholder="Types (comma), e.g. bonus_grant"
            className={cn('w-full min-w-0 pl-9 font-mono text-sm', filters.types.trim() && 'pr-9')}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          {filters.types.trim() ? (
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...f, types: '' }))}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
              aria-label="Clear types filter"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <Input
          value={filters.userId}
          onChange={(e) => setFilters((f) => ({ ...f, userId: e.target.value }))}
          placeholder="User ID"
          className="h-10 w-[min(100%,16rem)] min-w-[10rem] shrink-0 font-mono text-xs"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <Input
          value={filters.adminId}
          onChange={(e) => setFilters((f) => ({ ...f, adminId: e.target.value }))}
          placeholder="Admin user ID"
          className="h-10 w-[min(100%,16rem)] min-w-[10rem] shrink-0 font-mono text-xs"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <div className="flex min-w-0 shrink-0 flex-wrap items-end gap-x-4 gap-y-2 border-l border-border pl-4">
          <div className="flex shrink-0 items-center gap-2.5">
            <label className="whitespace-nowrap text-xs text-text-muted" htmlFor="bonus_filter_from">
              From
            </label>
            <Input
              id="bonus_filter_from"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              placeholder="ISO"
              className="h-10 w-[min(100%,14rem)] min-w-[10.5rem] shrink-0 font-mono text-xs"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <label className="whitespace-nowrap text-xs text-text-muted" htmlFor="bonus_filter_to">
              To
            </label>
            <Input
              id="bonus_filter_to"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              placeholder="ISO"
              className="h-10 w-[min(100%,14rem)] min-w-[10.5rem] shrink-0 font-mono text-xs"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={!hasActiveFilters}
          onClick={() => {
            setFilters({ ...emptyFilters })
            setPage(1)
          }}
        >
          Clear
        </Button>
      </div>

      <div className="space-y-4">
        {isError && (
          <p className="text-sm text-danger">
            {error instanceof Error ? error.message : 'Failed to load bonus transactions'}
          </p>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-text-muted">
            <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden />
          </div>
        ) : !isError ? (
          <DataTable
            data={rows}
            columns={columns}
            pagination={{
              page,
              pageSize,
              total,
              onPageChange: setPage,
              onPageSizeChange: (size) => {
                setPageSize(size)
                setPage(1)
              },
            }}
          />
        ) : null}
      </div>
    </ContentShell>
  )
}
