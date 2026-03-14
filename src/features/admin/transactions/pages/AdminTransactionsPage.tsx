import { useQuery } from '@tanstack/react-query'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { useCanAccess } from '@/shared/utils/permissions'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import {
  FinanceOverviewPanel,
  FinanceTransactionsPanel,
  FinanceWalletsPanel,
} from '@/features/adminFinance/components'
import { fetchFinanceOverview } from '@/features/adminFinance/api/finance.api'
import { useModalStore } from '@/app/store'
import { ManualAdjustmentModal } from '@/features/adminFinance/modals/ManualAdjustmentModal'
import { Download, Plus, ArrowDownToLine, ArrowUpFromLine, TrendingUp, Wallet } from 'lucide-react'
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

  const { data: overview } = useQuery({
    queryKey: ['finance-overview'],
    queryFn: fetchFinanceOverview,
  })
  const pendingDeposits = overview?.pendingDeposits ?? 0
  const pendingWithdrawals = overview?.pendingWithdrawals ?? 0
  const netFeesToday = overview?.netFeesToday ?? 0
  const totalBalances = overview?.totalBalances ?? 0
  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)

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

      {/* Stats */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-amber-500">
            <ArrowDownToLine className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Pending deposits</p>
            <p className="mt-1 text-lg font-bold text-text">{pendingDeposits}</p>
            <p className="mt-0.5 text-xs text-text-muted">Awaiting approval</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-blue-500">
            <ArrowUpFromLine className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Pending withdrawals</p>
            <p className="mt-1 text-lg font-bold text-text">{pendingWithdrawals}</p>
            <p className="mt-0.5 text-xs text-text-muted">Awaiting approval</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-emerald-500">
            <TrendingUp className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Net fees today</p>
            <p className="mt-1 text-lg font-bold text-text">{formatCurrency(netFeesToday)}</p>
            <p className="mt-0.5 text-xs text-text-muted">Today</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-slate-400">
            <Wallet className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Total balances</p>
            <p className="mt-1 text-lg font-bold text-text">{formatCurrency(totalBalances)}</p>
            <p className="mt-0.5 text-xs text-text-muted">All wallets</p>
          </div>
        </Card>
      </div>

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

