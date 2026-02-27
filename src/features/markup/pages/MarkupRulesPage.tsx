import { ContentShell, PageHeader } from '@/shared/layout'
import { MarkupRulesTable } from '../components/MarkupRulesTable'
import { MarkupFiltersBar } from '../components/MarkupFiltersBar'
import { mockMarkupRules } from '../mocks/markupRules.mock'
import { Button } from '@/shared/ui/button'
import { CreateMarkupRuleModal } from '../modals/CreateMarkupRuleModal'
import { BulkAssignModal } from '../modals/BulkAssignModal'
import { useModalStore } from '@/app/store'
import { Plus, Upload, Download } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Card } from '@/shared/ui/card'
import { toast } from '@/shared/components/common'
import { useSearchParams } from 'react-router-dom'

export function MarkupRulesPage() {
  const openModal = useModalStore((state) => state.openModal)
  const [searchParams] = useSearchParams()
  const symbolFromUrl = searchParams.get('symbol') || ''

  const [filters, setFilters] = useState<{
    group: string
    market: string
    symbol: string
    status: string
  }>({
    group: 'all',
    market: 'all',
    symbol: symbolFromUrl,
    status: 'all',
  })

  useEffect(() => {
    if (symbolFromUrl) {
      setFilters((prev) => ({ ...prev, symbol: symbolFromUrl }))
    }
  }, [symbolFromUrl])

  const handleCreateRule = () => {
    openModal('create-markup-rule', <CreateMarkupRuleModal />, {
      title: 'Create Markup Rule',
      size: 'md',
    })
  }

  const handleBulkAssign = () => {
    openModal('bulk-assign', <BulkAssignModal />, {
      title: 'Bulk Assign Markup Rules',
      size: 'xl',
    })
  }

  const handleExport = () => {
    toast.success('Export functionality coming soon')
  }

  return (
    <ContentShell>
      <PageHeader
        title="Price Markup Rules"
        description="Apply group-based markups on top of provider prices (Binance)."
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
          <strong className="text-text">Effective trading price = Provider price + Markup.</strong>{' '}
          Users always see the final markup price (never direct Binance).
        </p>
      </Card>
      <MarkupFiltersBar onFilterChange={setFilters} />
      <MarkupRulesTable rules={mockMarkupRules} filters={filters} />
    </ContentShell>
  )
}

