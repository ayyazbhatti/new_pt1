import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { useCanAccess } from '@/shared/utils/permissions'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import {
  FinanceOverviewPanel,
  FinanceTransactionsPanel,
  FinanceWalletsPanel,
} from '@/features/adminFinance/components'
import { useModalStore } from '@/app/store'
import { ManualAdjustmentModal } from '@/features/adminFinance/modals/ManualAdjustmentModal'
import { Download, Plus } from 'lucide-react'
import { toast } from '@/shared/components/common'
import { useState } from 'react'

const STORAGE_KEY_TRANSACTIONS_TAB = 'admin.transactions.activeTab'
const VALID_TABS = ['transactions', 'overview', 'wallets']

export function AdminTransactionsPage() {
  const openModal = useModalStore((state) => state.openModal)
  const canManualAdjustment = useCanAccess('finance:manual_adjustment')

  // Load active tab from localStorage, default to 'transactions'
  const [activeTab, setActiveTab] = useState(() => {
    const savedTab = localStorage.getItem(STORAGE_KEY_TRANSACTIONS_TAB)
    // Validate saved tab is still valid
    if (savedTab && VALID_TABS.includes(savedTab)) {
      return savedTab
    }
    return 'transactions'
  })

  // Save to localStorage when tab changes
  const handleTabChange = (value: string) => {
    if (VALID_TABS.includes(value)) {
      setActiveTab(value)
      localStorage.setItem(STORAGE_KEY_TRANSACTIONS_TAB, value)
    }
  }

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
        title="Transactions"
        description="Manage all financial transactions including deposits, withdrawals, fees, rebates, and ledger entries."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExport} disabled>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            {canManualAdjustment && (
              <Button onClick={handleManualAdjustment}>
                <Plus className="h-4 w-4 mr-2" />
                Manual Adjustment
              </Button>
            )}
          </div>
        }
      />
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList>
          <TabsTrigger value="transactions">All Transactions</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="wallets">Wallets</TabsTrigger>
        </TabsList>
        <TabsContent value="transactions">
          <FinanceTransactionsPanel />
        </TabsContent>
        <TabsContent value="overview">
          <FinanceOverviewPanel />
        </TabsContent>
        <TabsContent value="wallets">
          <FinanceWalletsPanel />
        </TabsContent>
      </Tabs>
    </ContentShell>
  )
}

