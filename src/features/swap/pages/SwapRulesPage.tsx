import { ContentShell, PageHeader } from '@/shared/layout'
import { SwapRulesTable } from '../components/SwapRulesTable'
import { SwapFiltersBar } from '../components/SwapFiltersBar'
import { Button } from '@/shared/ui/button'
import { CreateSwapRuleModal } from '../modals/CreateSwapRuleModal'
import { BulkAssignSwapModal } from '../modals/BulkAssignSwapModal'
import { useModalStore } from '@/app/store'
import { Plus, Upload, Download } from 'lucide-react'
import { useState, useMemo } from 'react'
import { Card } from '@/shared/ui/card'
import { toast } from 'react-hot-toast'
import { useSwapRulesList, useUpdateSwapRule } from '../hooks/useSwapRules'
import type { ListSwapRulesParams } from '../types/swap'

export function SwapRulesPage() {
  const openModal = useModalStore((state) => state.openModal)
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

  const { data, isLoading, error } = useSwapRulesList(listParams)
  const updateRule = useUpdateSwapRule()
  const rules = data?.items ?? []

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
            <Button variant="outline" onClick={handleBulkAssign}>
              <Upload className="h-4 w-4 mr-2" />
              Bulk Assign
            </Button>
            <Button onClick={handleCreateRule}>
              <Plus className="h-4 w-4 mr-2" />
              Create Rule
            </Button>
          </div>
        }
      />
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
      />
    </ContentShell>
  )
}

