import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import {
  FinanceOverviewPanel,
  FinanceTransactionsPanel,
  FinanceWalletsPanel,
} from '../components'
import { useModalStore } from '@/app/store'
import { ManualAdjustmentModal } from '../modals/ManualAdjustmentModal'
import { Download, Plus } from 'lucide-react'
import { toast } from 'react-hot-toast'

export function AdminFinancePage() {
  const openModal = useModalStore((state) => state.openModal)

  const handleManualAdjustment = () => {
    openModal('manual-adjustment', <ManualAdjustmentModal />, {
      title: 'Manual Adjustment',
      size: 'md',
    })
  }

  const handleExport = () => {
    toast.success('Export functionality coming soon')
  }

  return (
    <ContentShell>
      <PageHeader
        title="Finance"
        description="Manage wallets, deposits, withdrawals, fees, rebates, and ledger entries."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExport} disabled>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button onClick={handleManualAdjustment}>
              <Plus className="h-4 w-4 mr-2" />
              Manual Adjustment
            </Button>
          </div>
        }
      />
      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="wallets">Wallets</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <FinanceOverviewPanel />
        </TabsContent>
        <TabsContent value="transactions">
          <FinanceTransactionsPanel />
        </TabsContent>
        <TabsContent value="wallets">
          <FinanceWalletsPanel />
        </TabsContent>
      </Tabs>
    </ContentShell>
  )
}

