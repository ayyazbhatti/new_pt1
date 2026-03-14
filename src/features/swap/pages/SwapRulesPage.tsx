import { ContentShell, PageHeader } from '@/shared/layout'
import { SwapRulesTable } from '../components/SwapRulesTable'
import { SwapFiltersBar } from '../components/SwapFiltersBar'
import { Button } from '@/shared/ui/button'
import { useCanAccess } from '@/shared/utils/permissions'
import { CreateSwapRuleModal } from '../modals/CreateSwapRuleModal'
import { BulkAssignSwapModal } from '../modals/BulkAssignSwapModal'
import { useModalStore } from '@/app/store'
import { Plus, Upload, Download, FileStack, CheckCircle, Tag, PauseCircle } from 'lucide-react'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/shared/ui/card'
import { toast } from '@/shared/components/common'
import { useSwapRulesList, useUpdateSwapRule } from '../hooks/useSwapRules'
import type { ListSwapRulesParams } from '../types/swap'
import { listTags } from '@/features/tags/api/tags.api'

export function SwapRulesPage() {
  const openModal = useModalStore((state) => state.openModal)
  const canCreate = useCanAccess('swap:create')
  const canEdit = useCanAccess('swap:edit')
  const [filters, setFilters] = useState<{
    group: string
    market: string
    symbol: string
    status: string
    calcMode: string
  }>({
    group: 'all',
    market: 'all',
    symbol: '',
    status: 'all',
    calcMode: 'all',
  })

  const listParams: ListSwapRulesParams = useMemo(
    () => ({
      groupId: filters.group === 'all' ? undefined : filters.group,
      market: filters.market === 'all' ? undefined : filters.market,
      symbol: filters.symbol.trim() || undefined,
      status: filters.status === 'all' ? undefined : filters.status,
      calcMode: filters.calcMode === 'all' ? undefined : filters.calcMode,
    }),
    [filters]
  )

  const { data, isLoading, error, refetch } = useSwapRulesList(listParams)
  const { data: tagsList = [] } = useQuery({
    queryKey: ['admin', 'tags'],
    queryFn: () => listTags(),
  })
  const allTags = useMemo(() => tagsList.map((t) => ({ id: t.id, name: t.name })), [tagsList])
  const updateRule = useUpdateSwapRule()
  const rules = data?.items ?? []
  const totalRules = rules.length
  const activeRules = useMemo(() => rules.filter((r) => r.status === 'active').length, [rules])
  const withTags = useMemo(() => rules.filter((r) => (r.tagIds?.length ?? 0) > 0).length, [rules])
  const disabledRules = useMemo(() => rules.filter((r) => r.status === 'disabled').length, [rules])

  const handleCreateRule = () => {
    openModal('create-swap-rule', <CreateSwapRuleModal />, {
      title: 'Create Swap Rule',
      size: 'md',
    })
  }

  const handleBulkAssign = () => {
    openModal('bulk-assign-swap', <BulkAssignSwapModal />, {
      title: 'Bulk Assign Swap Rules',
      size: 'xl',
    })
  }

  const handleExport = () => {
    toast.success('Export functionality coming soon')
  }

  const handleDisable = (rule: { id: string; status: string }) => {
    updateRule.mutate({
      id: rule.id,
      payload: {
        status: rule.status === 'active' ? 'disabled' : 'active',
      },
    })
  }

  return (
    <ContentShell>
      <PageHeader
        title="Swap / Overnight Fees"
        description="Configure rollover (swap) charges for long/short positions by group and symbol."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExport} disabled>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            {canEdit && (
              <Button variant="outline" onClick={handleBulkAssign}>
                <Upload className="h-4 w-4 mr-2" />
                Bulk Assign
              </Button>
            )}
            {canCreate && (
              <Button onClick={handleCreateRule}>
                <Plus className="h-4 w-4 mr-2" />
                Create Rule
              </Button>
            )}
          </div>
        }
      />

      {/* Stats */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-blue-500">
            <FileStack className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Total rules</p>
            <p className="mt-1 text-lg font-bold text-text">{totalRules}</p>
            <p className="mt-0.5 text-xs text-text-muted">Swap / overnight fee rules</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-emerald-500">
            <CheckCircle className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Active</p>
            <p className="mt-1 text-lg font-bold text-text">{activeRules}</p>
            <p className="mt-0.5 text-xs text-text-muted">Currently applied</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-amber-500">
            <Tag className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">With tags</p>
            <p className="mt-1 text-lg font-bold text-text">{withTags}</p>
            <p className="mt-0.5 text-xs text-text-muted">Rules with tag assignments</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-slate-400">
            <PauseCircle className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Disabled</p>
            <p className="mt-1 text-lg font-bold text-text">{disabledRules}</p>
            <p className="mt-0.5 text-xs text-text-muted">Not applied</p>
          </div>
        </Card>
      </div>

      <Card className="p-4 mb-6 bg-surface-2">
        <p className="text-sm text-text-muted">
          <strong className="text-text">Swap is applied at rollover time for open margin positions.</strong>{' '}
          Rates are group-based and symbol-based.
        </p>
      </Card>
      <SwapFiltersBar onFilterChange={setFilters} />
      {error && (
        <p className="text-sm text-danger mb-4">
          {(error as Error)?.message ?? 'Failed to load swap rules'}
        </p>
      )}
      <SwapRulesTable
        rules={rules}
        isLoading={isLoading}
        onDisable={handleDisable}
        allTags={allTags}
        onRefresh={refetch}
      />
    </ContentShell>
  )
}

