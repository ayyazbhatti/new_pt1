import { useParams, Link } from 'react-router-dom'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { formatCurrency } from '@/features/adminFinance/utils/formatters'
import {
  ChevronLeft,
  Users,
  UserCheck,
  UserPlus,
  FolderKanban,
  ArrowDownToLine,
  ArrowUpFromLine,
  LayoutList,
  ClipboardList,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { useManagerStats } from '../hooks/useManagerStats'
import type { ManagerStats } from '../hooks/useManagerStats'

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'approved' || status === 'filled' ? 'success' : status === 'pending' ? 'warning' : 'danger'
  return <Badge variant={variant}>{status}</Badge>
}

const OVERVIEW_CARDS = [
  { key: 'users', label: 'Total users', desc: 'Users assigned to this manager', icon: Users, iconClassName: 'text-slate-400' },
  { key: 'groups', label: 'Groups', desc: 'Groups this manager owns or manages', icon: FolderKanban, iconClassName: 'text-blue-500' },
  { key: 'active', label: 'Active users', desc: 'Users with recent activity', icon: UserCheck, iconClassName: 'text-emerald-500' },
  { key: 'leads', label: 'Assigned leads', desc: 'Leads owned by this manager', icon: UserPlus, iconClassName: 'text-amber-500' },
] as const

const TRADING_KPI_KEYS = [
  { key: 'deposits', label: 'Deposits (total)', getSub: (s: ManagerStats) => `${s.deposits.totalCount} txns`, icon: ArrowDownToLine, iconClassName: 'text-emerald-500' },
  { key: 'withdrawals', label: 'Withdrawals (total)', getSub: (s: ManagerStats) => `${s.withdrawals.totalCount} txns`, icon: ArrowUpFromLine, iconClassName: 'text-amber-500' },
  { key: 'positions', label: 'Open positions', getSub: (s: ManagerStats) => `Exposure ${formatCurrency(s.positions.totalExposure, 'USD')}`, icon: LayoutList, iconClassName: 'text-blue-500' },
  { key: 'orders', label: 'Active orders', getSub: (s: ManagerStats) => `Filled today: ${s.orders.filledToday}`, icon: ClipboardList, iconClassName: 'text-slate-400' },
  { key: 'pnl', label: 'Live PnL', getSub: () => 'Unrealized across all positions', icon: TrendingUp, iconClassName: 'text-emerald-500' },
] as const

function LoadingSkeleton() {
  return (
    <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i} className="flex items-start gap-3 p-4">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-surface-2" />
          <div className="min-w-0 flex-1">
            <div className="h-4 w-20 animate-pulse rounded bg-surface-2" />
            <div className="mt-2 h-7 w-16 animate-pulse rounded bg-surface-2" />
          </div>
        </Card>
      ))}
    </div>
  )
}

export function ManagerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { manager, stats, isLoading, error, isOtherManagerUnsupported } = useManagerStats(id)

  if (!id) {
    return (
      <ContentShell>
        <PageHeader title="Manager statistics" description="Manager not found" />
      </ContentShell>
    )
  }

  if (error) {
    return (
      <ContentShell>
        <PageHeader
          title="Manager statistics"
          description="Failed to load manager"
          backLink={
            <Link to="/admin/manager" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text">
              <ChevronLeft className="h-4 w-4" />
              Back to Managers
            </Link>
          }
        />
        <Card className="p-6 text-center text-text-muted">
          <p>Could not load manager. Please try again.</p>
        </Card>
      </ContentShell>
    )
  }

  if (isLoading && !manager) {
    return (
      <ContentShell>
        <PageHeader
          title="Manager statistics"
          description="Loading…"
          backLink={
            <Link to="/admin/manager" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text">
              <ChevronLeft className="h-4 w-4" />
              Back to Managers
            </Link>
          }
        />
        <div className="flex items-center justify-center gap-2 py-12 text-text-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading manager…</span>
        </div>
      </ContentShell>
    )
  }

  if (!manager) {
    return (
      <ContentShell>
        <PageHeader
          title="Manager statistics"
          description="Manager not found"
          backLink={
            <Link to="/admin/manager" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text">
              <ChevronLeft className="h-4 w-4" />
              Back to Managers
            </Link>
          }
        />
        <Card className="p-6 text-center text-text-muted">
          <p>No manager found with this ID.</p>
        </Card>
      </ContentShell>
    )
  }

  const pageTitle = `Manager statistics${manager.userName ? ` — ${manager.userName}` : ''}`

  return (
    <ContentShell>
      <PageHeader
        title={pageTitle}
        description={
          isOtherManagerUnsupported
            ? 'Viewing another manager. Aggregated statistics require backend endpoint GET /api/admin/managers/:id/statistics.'
            : 'Deposits, withdrawals, positions, orders, PnL, and trader performance for this manager'
        }
        backLink={
          <Link
            to="/admin/manager"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Managers
          </Link>
        }
      />

      {isOtherManagerUnsupported && (
        <Card className="mb-6 border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="text-sm">
              <p className="font-medium text-text">Statistics for other managers</p>
              <p className="mt-1 text-text-muted">
                To see aggregated stats when viewing another manager (as super admin), the backend must implement{' '}
                <code className="rounded bg-surface-2 px-1">GET /api/admin/managers/:id/statistics</code>. Until then, only your own statistics are loaded from existing scoped APIs.
              </p>
            </div>
          </div>
        </Card>
      )}

      {isLoading && !stats ? (
        <LoadingSkeleton />
      ) : stats ? (
        <>
          {/* Row 1: Overview KPIs */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {OVERVIEW_CARDS.map((card) => {
              const Icon = card.icon
              const value =
                card.key === 'users'
                  ? stats.overview.totalUsers
                  : card.key === 'groups'
                    ? stats.overview.totalGroups
                    : card.key === 'active'
                      ? stats.overview.activeUsers
                      : stats.overview.assignedLeads
              return (
                <Card key={card.key} className="flex items-start gap-3 p-4">
                  <div className={`shrink-0 rounded-lg bg-surface-2 p-2 ${card.iconClassName}`}>
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-muted">{card.label}</p>
                    <p className="mt-1 text-xl font-bold text-text">{value}</p>
                    <p className="mt-0.5 text-xs text-text-muted">{card.desc}</p>
                  </div>
                </Card>
              )
            })}
          </div>

          {/* Row 2: Trading & finance KPIs */}
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {TRADING_KPI_KEYS.map((card) => {
              const Icon = card.icon
              const value =
                card.key === 'deposits'
                  ? formatCurrency(stats.deposits.totalVolume, 'USD')
                  : card.key === 'withdrawals'
                    ? formatCurrency(stats.withdrawals.totalVolume, 'USD')
                    : card.key === 'positions'
                      ? String(stats.positions.openCount)
                      : card.key === 'orders'
                        ? String(stats.orders.activeCount)
                        : formatCurrency(stats.positions.livePnl, 'USD')
              const sub = card.getSub(stats)
              return (
                <Card key={card.key} className="flex items-start gap-3 p-4">
                  <div className={`shrink-0 rounded-lg bg-surface-2 p-2 ${card.iconClassName}`}>
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-muted">{card.label}</p>
                    <p className="mt-1 text-lg font-bold text-text">{value}</p>
                    <p className="mt-0.5 text-xs text-text-muted">{sub}</p>
                  </div>
                </Card>
              )
            })}
          </div>

          {/* Deposit & withdrawal statistics */}
          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <div className="border-b border-border bg-surface-2 px-4 py-3">
                <h2 className="text-sm font-semibold text-text">Deposit statistics</h2>
                <p className="mt-0.5 text-xs text-text-muted">Volume, count, and status for this manager&apos;s users</p>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-text-muted">Total volume</p>
                    <p className="text-lg font-semibold text-text">{formatCurrency(stats.deposits.totalVolume, 'USD')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">Total count</p>
                    <p className="text-lg font-semibold text-text">{stats.deposits.totalCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">Today (volume)</p>
                    <p className="text-lg font-semibold text-text">{formatCurrency(stats.deposits.todayVolume, 'USD')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">Today (count)</p>
                    <p className="text-lg font-semibold text-text">{stats.deposits.todayCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">Pending</p>
                    <p className="text-lg font-semibold text-amber-600">{stats.deposits.pendingCount}</p>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-border bg-surface-2 px-4 py-3">
                <h2 className="text-sm font-semibold text-text">Withdrawal statistics</h2>
                <p className="mt-0.5 text-xs text-text-muted">Volume, count, and status for this manager&apos;s users</p>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-text-muted">Total volume</p>
                    <p className="text-lg font-semibold text-text">{formatCurrency(stats.withdrawals.totalVolume, 'USD')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">Total count</p>
                    <p className="text-lg font-semibold text-text">{stats.withdrawals.totalCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">Today (volume)</p>
                    <p className="text-lg font-semibold text-text">{formatCurrency(stats.withdrawals.todayVolume, 'USD')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">Today (count)</p>
                    <p className="text-lg font-semibold text-text">{stats.withdrawals.todayCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">Pending</p>
                    <p className="text-lg font-semibold text-amber-600">{stats.withdrawals.pendingCount}</p>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Recent deposits & withdrawals */}
          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <div className="border-b border-border bg-surface-2 px-4 py-3">
                <h2 className="text-sm font-semibold text-text">Recent deposits</h2>
                <p className="mt-0.5 text-xs text-text-muted">Latest deposit transactions</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">User</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Amount</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentDeposits.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                          No recent deposits
                        </td>
                      </tr>
                    ) : (
                      stats.recentDeposits.map((row) => (
                        <tr key={row.id} className="border-b border-border/50 hover:bg-surface-2/30">
                          <td className="px-4 py-3 text-text">{row.user}</td>
                          <td className="px-4 py-3 text-text">{formatCurrency(row.amount, row.currency)}</td>
                          <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                          <td className="px-4 py-3 text-text-muted">{row.time}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-border bg-surface-2 px-4 py-3">
                <h2 className="text-sm font-semibold text-text">Recent withdrawals</h2>
                <p className="mt-0.5 text-xs text-text-muted">Latest withdrawal transactions</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">User</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Amount</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentWithdrawals.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                          No recent withdrawals
                        </td>
                      </tr>
                    ) : (
                      stats.recentWithdrawals.map((row) => (
                        <tr key={row.id} className="border-b border-border/50 hover:bg-surface-2/30">
                          <td className="px-4 py-3 text-text">{row.user}</td>
                          <td className="px-4 py-3 text-text">{formatCurrency(row.amount, row.currency)}</td>
                          <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                          <td className="px-4 py-3 text-text-muted">{row.time}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* Live PnL */}
          <div className="mb-8">
            <Card className="overflow-hidden border-emerald-500/30 bg-emerald-500/5">
              <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-emerald-500/20 p-2 text-emerald-600">
                    <DollarSign className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-text">Aggregate live PnL</h2>
                    <p className="text-xs text-text-muted">Unrealized PnL across all open positions under this manager</p>
                  </div>
                </div>
                <p
                  className={`text-2xl font-bold sm:text-3xl ${
                    stats.positions.livePnl >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {formatCurrency(stats.positions.livePnl, 'USD')}
                </p>
              </div>
            </Card>
          </div>

          {/* Positions & Orders */}
          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <div className="border-b border-border bg-surface-2 px-4 py-3">
                <h2 className="text-sm font-semibold text-text">Open positions</h2>
                <p className="mt-0.5 text-xs text-text-muted">
                  {stats.positions.openCount} open · {formatCurrency(stats.positions.totalExposure, 'USD')} exposure · {stats.positions.closedToday} closed today
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Symbol</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Side</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Size</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Entry</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Mark</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Live PnL</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.positions.items.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-text-muted">
                          No open positions
                        </td>
                      </tr>
                    ) : (
                      stats.positions.items.map((row) => (
                        <tr key={row.id} className="border-b border-border/50 hover:bg-surface-2/30">
                          <td className="px-4 py-3 font-medium text-text">{row.symbol}</td>
                          <td className="px-4 py-3 text-text">{row.side}</td>
                          <td className="px-4 py-3 text-text">{row.size}</td>
                          <td className="px-4 py-3 text-text-muted">{row.entry}</td>
                          <td className="px-4 py-3 text-text-muted">{row.mark}</td>
                          <td
                            className={`px-4 py-3 font-medium ${row.livePnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                          >
                            {row.livePnl >= 0 ? '+' : ''}{formatCurrency(row.livePnl, 'USD')}
                          </td>
                          <td className="px-4 py-3 text-text-muted">{row.user}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-border bg-surface-2 px-4 py-3">
                <h2 className="text-sm font-semibold text-text">Orders</h2>
                <p className="mt-0.5 text-xs text-text-muted">
                  {stats.orders.activeCount} active · {stats.orders.filledToday} filled today · {stats.orders.cancelledToday} cancelled today
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Order</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">User</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Symbol</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Side</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.orders.items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
                          No orders
                        </td>
                      </tr>
                    ) : (
                      stats.orders.items.map((row) => (
                        <tr key={row.id} className="border-b border-border/50 hover:bg-surface-2/30">
                          <td className="px-4 py-3 font-mono text-xs text-text">{row.id.slice(0, 8)}…</td>
                          <td className="px-4 py-3 text-text">{row.user}</td>
                          <td className="px-4 py-3 text-text">{row.symbol}</td>
                          <td className="px-4 py-3 text-text">{row.side}</td>
                          <td className="px-4 py-3 text-text">{row.type}</td>
                          <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* Top traders & Losers */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <div className="border-b border-border bg-surface-2 px-4 py-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  <h2 className="text-sm font-semibold text-text">Top traders</h2>
                </div>
                <p className="mt-0.5 text-xs text-text-muted">Best performers by PnL (this manager&apos;s users)</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">User</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">PnL</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Win rate</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topTraders.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                          No data
                        </td>
                      </tr>
                    ) : (
                      stats.topTraders.map((row) => (
                        <tr key={row.user} className="border-b border-border/50 hover:bg-surface-2/30">
                          <td className="px-4 py-3 font-medium text-text-muted">{row.rank}</td>
                          <td className="px-4 py-3 text-text">{row.user}</td>
                          <td className="px-4 py-3 font-medium text-emerald-600">{formatCurrency(row.pnl, 'USD')}</td>
                          <td className="px-4 py-3 text-text">{row.winRate ? `${row.winRate}%` : '—'}</td>
                          <td className="px-4 py-3 text-text-muted">{formatCurrency(row.volume, 'USD')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-border bg-surface-2 px-4 py-3">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-red-500" />
                  <h2 className="text-sm font-semibold text-text">Top losers</h2>
                </div>
                <p className="mt-0.5 text-xs text-text-muted">Worst performers by PnL (this manager&apos;s users)</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">User</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">PnL</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Win rate</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topLosers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                          No data
                        </td>
                      </tr>
                    ) : (
                      stats.topLosers.map((row) => (
                        <tr key={row.user} className="border-b border-border/50 hover:bg-surface-2/30">
                          <td className="px-4 py-3 font-medium text-text-muted">{row.rank}</td>
                          <td className="px-4 py-3 text-text">{row.user}</td>
                          <td className="px-4 py-3 font-medium text-red-600">{formatCurrency(row.pnl, 'USD')}</td>
                          <td className="px-4 py-3 text-text">{row.winRate ? `${row.winRate}%` : '—'}</td>
                          <td className="px-4 py-3 text-text-muted">{formatCurrency(row.volume, 'USD')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </ContentShell>
  )
}
