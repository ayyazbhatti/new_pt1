import { Link } from 'react-router-dom'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { useAuthStore } from '@/shared/store/auth.store'
import {
  Wallet,
  TrendingUp,
  PieChart,
  ArrowDownToLine,
  ArrowUpFromLine,
  Activity,
  UsersRound,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/shared/utils'

function StatCard({
  title,
  value,
  subtext,
  icon: Icon,
  className,
}: {
  title: string
  value: string
  subtext?: string
  icon: React.ElementType
  className?: string
}) {
  return (
    <Card className={cn('p-5', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-text-muted">{title}</p>
          <p className="mt-1 text-2xl font-bold text-text">{value}</p>
          {subtext && <p className="mt-0.5 text-xs text-text-muted">{subtext}</p>}
        </div>
        <div className="rounded-lg bg-surface-2 p-2.5">
          <Icon className="h-5 w-5 text-accent" />
        </div>
      </div>
    </Card>
  )
}

function QuickActionCard({
  to,
  title,
  description,
  icon: Icon,
}: {
  to: string
  title: string
  description: string
  icon: React.ElementType
}) {
  return (
    <Link to={to}>
      <Card className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-2/80">
        <div className="rounded-lg bg-accent/10 p-3">
          <Icon className="h-6 w-6 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-text">{title}</p>
          <p className="text-sm text-text-muted">{description}</p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-text-muted" />
      </Card>
    </Link>
  )
}

export function UserDashboardPage() {
  const user = useAuthStore((state) => state.user)

  return (
    <ContentShell>
      <PageHeader
        title="Dashboard"
        description="Your account overview and quick actions"
      />

      {user?.email && (
        <p className="mb-6 text-sm text-text-muted">
          Welcome back, <span className="font-medium text-text">{user.email}</span>
        </p>
      )}

      {/* Balance overview */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Account overview</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            title="Balance"
            value="—"
            subtext="Available to trade"
            icon={Wallet}
          />
          <StatCard
            title="Equity"
            value="—"
            subtext="Balance + P/L"
            icon={TrendingUp}
          />
          <StatCard
            title="Margin used"
            value="—"
            subtext="In open positions"
            icon={PieChart}
          />
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Values will load when connected to the backend.
        </p>
      </section>

      {/* Quick actions */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Quick actions</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <QuickActionCard
            to="/user/deposit"
            title="Deposit"
            description="Add funds to your account"
            icon={ArrowDownToLine}
          />
          <QuickActionCard
            to="/user/withdraw"
            title="Withdraw"
            description="Withdraw to your wallet"
            icon={ArrowUpFromLine}
          />
          <QuickActionCard
            to="/user/affiliate"
            title="Affiliate"
            description="Refer friends and earn"
            icon={UsersRound}
          />
        </div>
      </section>

      {/* Recent activity placeholder */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-text">Recent activity</h2>
        <Card className="p-6">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Activity className="mb-3 h-10 w-10 text-text-muted/50" />
            <p className="text-sm font-medium text-text-muted">No recent activity</p>
            <p className="mt-1 text-xs text-text-muted">
              Trades, deposits, and withdrawals will appear here once connected to the backend.
            </p>
          </div>
        </Card>
      </section>
    </ContentShell>
  )
}
