import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ContentShell, PageHeader } from '@/shared/layout'
import { useAuthStore } from '@/shared/store/auth.store'
import { Card } from '@/shared/ui/card'
import { RevenueChart } from '../components/RevenueChart'
import {
  fetchDashboardUsers,
  fetchDashboardFinance,
  fetchDashboardRecentTransactions,
  fetchDashboardPositions,
  DASHBOARD_QUERY_KEYS,
} from '../api/dashboard.api'
import { formatCurrency } from '@/features/adminFinance/utils/formatters'
import {
  Users,
  Activity,
  DollarSign,
  AlertTriangle,
  UserPlus,
  CalendarDays,
  Receipt,
  Headphones,
  ArrowRight,
  TrendingUp,
  Bell,
  UserCheck,
  Loader2,
} from 'lucide-react'

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
  { key: 'users', label: 'Total Users', icon: Users, iconClassName: 'text-slate-400' },
  { key: 'trades', label: 'Active Trades', icon: Activity, iconClassName: 'text-emerald-500' },
  { key: 'revenue', label: 'Revenue', icon: DollarSign, iconClassName: 'text-blue-500' },
  { key: 'risk', label: 'Pending Requests', icon: AlertTriangle, iconClassName: 'text-amber-500' },
] as const

const QUICK_ACTIONS = [
  { label: 'Users', path: '/admin/users', icon: Users },
  { label: 'Leads', path: '/admin/leads', icon: UserPlus },
  { label: 'Appointments', path: '/admin/appointments', icon: CalendarDays },
  { label: 'Trading', path: '/admin/trading', icon: Activity },
  { label: 'Transactions', path: '/admin/transactions', icon: Receipt },
  { label: 'Support', path: '/admin/support', icon: Headphones },
]

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

  const recentActivity = (transactionsData ?? []).map((tx) => ({
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

      {/* Stats row */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAT_CARD_KEYS.map((card) => {
          const Icon = card.icon
          const { value, change } = statValues[card.key] ?? { value: '—', change: null }
          const isPositive = change?.startsWith('+')
          const isNegative = change?.startsWith('-')
          return (
            <Card key={card.key} className="flex items-start gap-3 p-4">
              <div className={`rounded-lg bg-surface-2 p-2 shrink-0 ${card.iconClassName}`}>
                {statsLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <Icon className="h-5 w-5" aria-hidden />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-muted">{card.label}</p>
                <p className="mt-1 text-xl font-bold text-text">{statsLoading ? '—' : value}</p>
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
      </div>

      {/* Quick actions */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-text mb-3">Quick actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {QUICK_ACTIONS.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.path}
                to={item.path}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-4 transition-colors hover:bg-surface-1 hover:border-border/80"
              >
                <div className="rounded-lg bg-surface-1 p-2 text-text-muted">
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium text-text">{item.label}</span>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-text-muted" />
              </Link>
            )
          })}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent activity */}
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-surface-2 px-4 py-3">
            <h2 className="text-sm font-semibold text-text">Recent activity</h2>
            <p className="text-xs text-text-muted mt-0.5">Latest transactions</p>
          </div>
          <div className="overflow-x-auto">
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
          <div className="overflow-x-auto">
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
        {/* Revenue overview chart */}
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-surface-2 px-4 py-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-text-muted" />
            <h2 className="text-sm font-semibold text-text">Revenue overview</h2>
          </div>
          <div className="bg-surface-2/50 p-4">
            <RevenueChart className="text-text-muted" />
          </div>
        </Card>

        {/* Platform alerts */}
        <Card className="overflow-hidden">
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
      </div>

      {/* Open support / additional placeholder row */}
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
