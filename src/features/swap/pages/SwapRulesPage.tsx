import { ContentShell, PageHeader } from '@/shared/layout'
import { SwapRulesTable } from '../components/SwapRulesTable'
import { SwapFiltersBar } from '../components/SwapFiltersBar'
import { mockSwapRules } from '../mocks/swapRules.mock'
import { Button } from '@/shared/ui/button'
import { CreateSwapRuleModal } from '../modals/CreateSwapRuleModal'
import { BulkAssignSwapModal } from '../modals/BulkAssignSwapModal'
import { useModalStore } from '@/app/store'
import { Plus, Upload, Download } from 'lucide-react'
import { useState } from 'react'
import { Card } from '@/shared/ui/card'
import { toast } from 'react-hot-toast'

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
      <SwapRulesTable rules={mockSwapRules} filters={filters} />
    </ContentShell>
  )
}

