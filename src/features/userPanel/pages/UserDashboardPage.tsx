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
    <Card className={cn('p-4 sm:p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-medium text-text-muted">{title}</p>
          <p className="mt-1 text-xl font-bold text-text sm:text-2xl">{value}</p>
          {subtext && <p className="mt-0.5 text-xs text-text-muted">{subtext}</p>}
        </div>
        <div className="shrink-0 rounded-lg bg-surface-2 p-2 sm:p-2.5">
          <Icon className="h-4 w-4 text-accent sm:h-5 sm:w-5" />
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
      <Card className="flex items-center gap-3 p-3 transition-colors hover:bg-surface-2/80 sm:gap-4 sm:p-4">
        <div className="shrink-0 rounded-lg bg-accent/10 p-2.5 sm:p-3">
          <Icon className="h-5 w-5 text-accent sm:h-6 sm:w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-text text-sm sm:text-base">{title}</p>
          <p className="text-xs text-text-muted sm:text-sm">{description}</p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-text-muted sm:h-5 sm:w-5" />
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
        className="flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between"
      />

      {user?.email && (
        <p className="mb-4 text-sm text-text-muted sm:mb-6">
          Welcome back, <span className="font-medium text-text break-all">{user.email}</span>
        </p>
      )}

      {/* Balance overview */}
      <section className="mb-6 sm:mb-8">
        <h2 className="mb-3 text-base font-semibold text-text sm:mb-4 sm:text-lg">Account overview</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
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
      <section className="mb-6 sm:mb-8">
        <h2 className="mb-3 text-base font-semibold text-text sm:mb-4 sm:text-lg">Quick actions</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
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
        <h2 className="mb-3 text-base font-semibold text-text sm:mb-4 sm:text-lg">Recent activity</h2>
        <Card className="p-4 sm:p-6">
          <div className="flex flex-col items-center justify-center py-6 text-center sm:py-8">
            <Activity className="mb-2 h-8 w-8 text-text-muted/50 sm:mb-3 sm:h-10 sm:w-10" />
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
