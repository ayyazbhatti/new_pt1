import { Card } from '@/shared/ui/card'
import { History, LogIn, LogOut, UserPlus } from 'lucide-react'

interface UserEventsStatsCardsProps {
  total: number
  registerCount: number
  loginCount: number
  logoutCount: number
  partialBreakdown?: boolean
  dateRangeLabel?: string
}

export function UserEventsStatsCards({
  total,
  registerCount,
  loginCount,
  logoutCount,
  partialBreakdown,
  dateRangeLabel,
}: UserEventsStatsCardsProps) {
  const breakdownHint = partialBreakdown ? 'Loaded rows' : 'Matching filters'

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
      <Card className="p-4 flex flex-col gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <History className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-medium text-text-muted">Total events</div>
          <div className="text-2xl font-bold text-text">{total.toLocaleString()}</div>
          <p className="text-xs text-text-muted mt-0.5">{dateRangeLabel ?? 'Last 30 days'}</p>
        </div>
      </Card>
      <Card className="p-4 flex flex-col gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
          <UserPlus className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-medium text-text-muted">Registered</div>
          <div className="text-2xl font-bold text-text">{registerCount.toLocaleString()}</div>
          <p className="text-xs text-text-muted mt-0.5">{breakdownHint}</p>
        </div>
      </Card>
      <Card className="p-4 flex flex-col gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
          <LogIn className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-medium text-text-muted">Logged in</div>
          <div className="text-2xl font-bold text-text">{loginCount.toLocaleString()}</div>
          <p className="text-xs text-text-muted mt-0.5">{breakdownHint}</p>
        </div>
      </Card>
      <Card className="p-4 flex flex-col gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
          <LogOut className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-medium text-text-muted">Logged out</div>
          <div className="text-2xl font-bold text-text">{logoutCount.toLocaleString()}</div>
          <p className="text-xs text-text-muted mt-0.5">{breakdownHint}</p>
        </div>
      </Card>
    </div>
  )
}
