import { Link } from 'react-router-dom'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { RevenueChart } from '../components/RevenueChart'
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
} from 'lucide-react'

const STAT_CARDS = [
  {
    key: 'users',
    label: 'Total Users',
    value: '1,234',
    change: '+12%',
    icon: Users,
    iconClassName: 'text-slate-400',
  },
  {
    key: 'trades',
    label: 'Active Trades',
    value: '567',
    change: '+5%',
    icon: Activity,
    iconClassName: 'text-emerald-500',
  },
  {
    key: 'revenue',
    label: 'Revenue',
    value: '$45,678',
    change: '+8%',
    icon: DollarSign,
    iconClassName: 'text-blue-500',
  },
  {
    key: 'risk',
    label: 'Risk Exposure',
    value: '$123,456',
    change: '-2%',
    icon: AlertTriangle,
    iconClassName: 'text-amber-500',
  },
]

const QUICK_ACTIONS = [
  { label: 'Users', path: '/admin/users', icon: Users },
  { label: 'Leads', path: '/admin/leads', icon: UserPlus },
  { label: 'Appointments', path: '/admin/appointments', icon: CalendarDays },
  { label: 'Trading', path: '/admin/trading', icon: Activity },
  { label: 'Transactions', path: '/admin/transactions', icon: Receipt },
  { label: 'Support', path: '/admin/support', icon: Headphones },
]

const RECENT_ACTIVITY_PLACEHOLDER = [
  { time: '2 min ago', action: 'New user registered', user: 'john@example.com', id: 1 },
  { time: '15 min ago', action: 'Deposit approved', user: 'jane@example.com', id: 2 },
  { time: '1 hour ago', action: 'Withdrawal requested', user: 'alex@example.com', id: 3 },
  { time: '2 hours ago', action: 'KYC submitted', user: 'sam@example.com', id: 4 },
  { time: '3 hours ago', action: 'Position closed', user: 'mike@example.com', id: 5 },
]

const RECENT_REGISTRATIONS_PLACEHOLDER = [
  { email: 'newuser1@example.com', date: 'Today, 10:32', source: 'Website' },
  { email: 'newuser2@example.com', date: 'Today, 09:15', source: 'Referral' },
  { email: 'newuser3@example.com', date: 'Yesterday', source: 'Landing page' },
  { email: 'newuser4@example.com', date: 'Yesterday', source: 'Website' },
  { email: 'newuser5@example.com', date: '2 days ago', source: 'Google Ad' },
]

const PLATFORM_ALERTS_PLACEHOLDER = [
  { id: 1, text: '3 pending KYC reviews', variant: 'warning' as const },
  { id: 2, text: 'Scheduled maintenance tonight 02:00–04:00 UTC', variant: 'info' as const },
  { id: 3, text: '2 support tickets awaiting response', variant: 'warning' as const },
]

export function DashboardPage() {
  return (
    <ContentShell>
      <PageHeader
        title="Dashboard"
        description="Overview of your trading platform"
      />

      {/* Stats row */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAT_CARDS.map((card) => {
          const Icon = card.icon
          const isPositive = card.change.startsWith('+')
          const isNegative = card.change.startsWith('-')
          return (
            <Card key={card.key} className="flex items-start gap-3 p-4">
              <div className={`rounded-lg bg-surface-2 p-2 shrink-0 ${card.iconClassName}`}>
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-muted">{card.label}</p>
                <p className="mt-1 text-xl font-bold text-text">{card.value}</p>
                <p
                  className={`mt-1 text-xs ${
                    isPositive ? 'text-success' : isNegative ? 'text-danger' : 'text-text-muted'
                  }`}
                >
                  {card.change} from last month
                </p>
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
            <p className="text-xs text-text-muted mt-0.5">Latest platform events</p>
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
                {RECENT_ACTIVITY_PLACEHOLDER.map((row) => (
                  <tr key={row.id} className="border-b border-border/50 hover:bg-surface-2/30">
                    <td className="px-4 py-3 text-text-muted">{row.time}</td>
                    <td className="px-4 py-3 text-text">{row.action}</td>
                    <td className="px-4 py-3 text-text-muted">{row.user}</td>
                  </tr>
                ))}
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
                {RECENT_REGISTRATIONS_PLACEHOLDER.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-surface-2/30">
                    <td className="px-4 py-3 text-text">{row.email}</td>
                    <td className="px-4 py-3 text-text-muted">{row.date}</td>
                    <td className="px-4 py-3 text-text-muted">{row.source}</td>
                  </tr>
                ))}
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
