import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ContentShell, PageHeader } from '@/shared/layout'
import { useAuthStore } from '@/shared/store/auth.store'
import { Card } from '@/shared/ui/card'
import { RevenueChart } from '../components/RevenueChart'
import { FeesChart } from '../components/FeesChart'
import {
  fetchDashboardUsers,
  fetchDashboardFinance,
  fetchDashboardRecentTransactions,
  fetchDashboardPositions,
  fetchDashboardTransactionsForCharts,
  DASHBOARD_QUERY_KEYS,
  type DailyFlow,
  type DailyFee,
} from '../api/dashboard.api'
import type { Transaction } from '@/features/adminFinance/api/finance.api'
import { formatCurrency } from '@/features/adminFinance/utils/formatters'
import { DollarSign, TrendingUp, Bell, UserCheck, Loader2 } from 'lucide-react'

const CHART_DAYS = 30

function formatYmdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildDayKeys(days: number): string[] {
  const keys: string[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    keys.push(formatYmdLocal(d))
  }
  return keys
}

function transactionDayKey(iso: string): string {
  return formatYmdLocal(new Date(iso))
}

function aggregateCharts(transactions: Transaction[]): { flowData: DailyFlow[]; feeData: DailyFee[] } {
  const keys = buildDayKeys(CHART_DAYS)
  const deposits: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]))
  const withdrawals: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]))
  const fees: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]))

  for (const tx of transactions) {
    if (tx.status !== 'completed') continue
    const day = transactionDayKey(tx.createdAt)
    if (!(day in deposits)) continue

    if (tx.type === 'deposit') {
      deposits[day] += tx.netAmount
    } else if (tx.type === 'withdrawal') {
      withdrawals[day] += tx.netAmount
    }
    if (tx.type === 'fee') {
      fees[day] += -tx.netAmount
    } else if (tx.type === 'rebate') {
      fees[day] += tx.netAmount
    }
  }

  const flowData: DailyFlow[] = keys.map((date) => ({
    date,
    deposits: deposits[date],
    withdrawals: withdrawals[date],
  }))
  const feeData: DailyFee[] = keys.map((date) => ({
    date,
    fees: fees[date],
  }))
  return { flowData, feeData }
}

function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return '—'
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return '—'
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} min ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`
  return date.toLocaleDateString()
}

const STAT_CARD_KEYS = [
  { key: 'users', label: 'Total Users' },
  { key: 'trades', label: 'Active Trades' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'risk', label: 'Pending Requests' },
] as const

const PLATFORM_ALERTS_PLACEHOLDER = [
  { id: 1, text: '3 pending KYC reviews', variant: 'warning' as const },
  { id: 2, text: 'Scheduled maintenance tonight 02:00–04:00 UTC', variant: 'info' as const },
  { id: 3, text: '2 support tickets awaiting response', variant: 'warning' as const },
]

export function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const isSuperAdmin = user?.role === 'super_admin'
  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.users,
    queryFn: fetchDashboardUsers,
  })
  const { data: financeData, isLoading: financeLoading } = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.finance,
    queryFn: fetchDashboardFinance,
  })
  const { data: transactionsData, isLoading: transactionsLoading } = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.transactions,
    queryFn: fetchDashboardRecentTransactions,
  })
  const { data: positionsData, isLoading: positionsLoading } = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.positions,
    queryFn: fetchDashboardPositions,
  })
  const { data: chartTransactions = [], isLoading: chartTxLoading } = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.chartTransactions(CHART_DAYS),
    queryFn: () => fetchDashboardTransactionsForCharts(CHART_DAYS),
  })

  const { flowData, feeData } = useMemo(() => aggregateCharts(chartTransactions), [chartTransactions])

  const statsLoading = usersLoading || financeLoading || positionsLoading
  const totalUsers = usersData?.total ?? 0
  const openPositionsCount = positionsData?.total ?? positionsData?.items?.length ?? 0
  const revenue = financeData?.totalBalances ?? 0
  const pendingCount = (financeData?.pendingDeposits ?? 0) + (financeData?.pendingWithdrawals ?? 0)

  const statValues: Record<string, { value: string; change: string | null }> = {
    users: { value: totalUsers.toLocaleString(), change: null },
    trades: { value: String(openPositionsCount), change: null },
    revenue: { value: formatCurrency(revenue, 'USD'), change: null },
    risk: { value: String(pendingCount), change: null },
  }

  const recentActivity = (transactionsData?.items ?? []).map((tx) => ({
    id: tx.id,
    time: formatRelativeTime(tx.createdAt),
    action: `${tx.type} ${tx.status}`,
    user: tx.userEmail,
  }))
  const recentRegistrations = (usersData?.items ?? []).map((u) => ({
    email: u.email,
    date: u.created_at ? new Date(u.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—',
    source: '—',
  }))

  const depositsToday = financeData?.depositsToday
  const withdrawalsToday = financeData?.withdrawalsToday
  const netFeesToday = financeData?.netFeesToday ?? 0

  return (
    <ContentShell>
      <PageHeader
        title="Dashboard"
        description={
          isSuperAdmin
            ? 'Overview of your trading platform (all users)'
            : 'Overview of users you manage — stats and activity match the same scope as the Users page'
        }
      />

      {/* Stats row — single horizontal line (scroll on narrow viewports) */}
      <div className="mb-8 flex flex-nowrap gap-3 overflow-x-auto pb-2 lg:gap-4">
        {STAT_CARD_KEYS.map((card) => {
          const { value, change } = statValues[card.key] ?? { value: '—', change: null }
          const isPositive = change?.startsWith('+')
          const isNegative = change?.startsWith('-')
          return (
            <Card
              key={card.key}
              className="min-w-[10.5rem] shrink-0 p-3 sm:min-w-[11.5rem] sm:p-4 lg:min-w-0 lg:flex-1 lg:basis-0"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-muted sm:text-sm">{card.label}</p>
                <p className="mt-0.5 truncate text-lg font-bold text-text sm:mt-1 sm:text-xl">
                  {statsLoading ? '—' : value}
                </p>
                {change && (
                  <p
                    className={`mt-1 text-xs ${
                      isPositive ? 'text-success' : isNegative ? 'text-danger' : 'text-text-muted'
                    }`}
                  >
                    {change} from last month
                  </p>
                )}
              </div>
            </Card>
          )
        })}
        <Card className="min-w-[10.5rem] shrink-0 p-3 sm:min-w-[11.5rem] sm:p-4 lg:min-w-0 lg:flex-1 lg:basis-0">
          <div className="min-w-0">
            <p className="text-xs font-medium text-text-muted sm:text-sm">Deposits today</p>
            <p className="mt-0.5 truncate text-lg font-bold text-text sm:mt-1 sm:text-xl">
              {financeLoading ? '—' : formatCurrency(depositsToday?.amount ?? 0, 'USD')}
            </p>
            {!financeLoading && depositsToday != null && (
              <p className="mt-0.5 text-xs text-text-muted sm:mt-1">
                ({depositsToday.count} transaction{depositsToday.count !== 1 ? 's' : ''})
              </p>
            )}
          </div>
        </Card>
        <Card className="min-w-[10.5rem] shrink-0 p-3 sm:min-w-[11.5rem] sm:p-4 lg:min-w-0 lg:flex-1 lg:basis-0">
          <div className="min-w-0">
            <p className="text-xs font-medium text-text-muted sm:text-sm">Withdrawals today</p>
            <p className="mt-0.5 truncate text-lg font-bold text-text sm:mt-1 sm:text-xl">
              {financeLoading ? '—' : formatCurrency(withdrawalsToday?.amount ?? 0, 'USD')}
            </p>
            {!financeLoading && withdrawalsToday != null && (
              <p className="mt-0.5 text-xs text-text-muted sm:mt-1">
                ({withdrawalsToday.count} transaction{withdrawalsToday.count !== 1 ? 's' : ''})
              </p>
            )}
          </div>
        </Card>
        <Card className="min-w-[10.5rem] shrink-0 p-3 sm:min-w-[11.5rem] sm:p-4 lg:min-w-0 lg:flex-1 lg:basis-0">
          <div className="min-w-0">
            <p className="text-xs font-medium text-text-muted sm:text-sm">Net fees today</p>
            <p className="mt-0.5 truncate text-lg font-bold text-text sm:mt-1 sm:text-xl">
              {financeLoading ? '—' : formatCurrency(netFeesToday, 'USD')}
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent activity */}
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-surface-2 px-4 py-3">
            <h2 className="text-sm font-semibold text-text">Recent activity</h2>
            <p className="text-xs text-text-muted mt-0.5">Latest transactions</p>
          </div>
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">User</th>
                </tr>
              </thead>
              <tbody>
                {transactionsLoading ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-text-muted">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                      Loading…
                    </td>
                  </tr>
                ) : recentActivity.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-text-muted">No recent activity</td>
                  </tr>
                ) : (
                  recentActivity.map((row) => (
                    <tr key={row.id} className="border-b border-border/50 hover:bg-surface-2/30">
                      <td className="px-4 py-3 text-text-muted">{row.time}</td>
                      <td className="px-4 py-3 text-text">{row.action}</td>
                      <td className="px-4 py-3 text-text-muted">{row.user}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Recent registrations */}
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-surface-2 px-4 py-3">
            <h2 className="text-sm font-semibold text-text">Recent registrations</h2>
            <p className="text-xs text-text-muted mt-0.5">New user sign-ups</p>
          </div>
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Source</th>
                </tr>
              </thead>
              <tbody>
                {usersLoading ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-text-muted">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                      Loading…
                    </td>
                  </tr>
                ) : recentRegistrations.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-text-muted">No recent registrations</td>
                  </tr>
                ) : (
                  recentRegistrations.map((row, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-surface-2/30">
                      <td className="px-4 py-3 text-text">{row.email}</td>
                      <td className="px-4 py-3 text-text-muted">{row.date}</td>
                      <td className="px-4 py-3 text-text-muted">{row.source}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-surface-2 px-4 py-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-text-muted" />
            <h2 className="text-sm font-semibold text-text">Deposit & withdrawal flow (30 days)</h2>
          </div>
          <div className="bg-surface-2/50 p-4">
            <RevenueChart data={flowData} loading={chartTxLoading} />
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border bg-surface-2 px-4 py-3 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-text-muted" />
            <h2 className="text-sm font-semibold text-text">Net fees (30 days)</h2>
          </div>
          <div className="bg-surface-2/50 p-4">
            <FeesChart data={feeData} loading={chartTxLoading} />
          </div>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-border bg-surface-2 px-4 py-3 flex items-center gap-2">
          <Bell className="h-4 w-4 text-text-muted" />
          <h2 className="text-sm font-semibold text-text">Platform alerts</h2>
        </div>
        <ul className="divide-y divide-border">
          {PLATFORM_ALERTS_PLACEHOLDER.map((alert) => (
            <li
              key={alert.id}
              className={`flex items-center gap-3 px-4 py-3 ${
                alert.variant === 'warning' ? 'bg-amber-500/5' : 'bg-surface-2/30'
              }`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  alert.variant === 'warning' ? 'bg-amber-500' : 'bg-blue-500'
                }`}
              />
              <span className="text-sm text-text">{alert.text}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-border bg-surface-2 px-4 py-3 flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-text-muted" />
          <h2 className="text-sm font-semibold text-text">Pending reviews</h2>
        </div>
        <div className="p-6 text-center text-text-muted">
          <p className="text-sm">KYC, withdrawals, and other review queues will appear here.</p>
          <p className="text-xs mt-1">Connect your backend to show real data.</p>
        </div>
      </Card>
    </ContentShell>
  )
}
