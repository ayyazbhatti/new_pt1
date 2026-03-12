import { Link, useParams, useLocation, useNavigate } from 'react-router-dom'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { ChevronLeft, TrendingDown, Target, TrendingUp, Users, Trophy, XCircle, Activity, Percent } from 'lucide-react'
import { cn } from '@/shared/utils'
import type { FundedPlan } from '../types/plan'
import type { PlanStats } from './AdminFundedProgramsPage'

type LocationState = { plan: FundedPlan; planStats?: PlanStats } | null

// Placeholder stats for this plan (replace with API later)
const PLACEHOLDER_PLAN_STATS: PlanStats = {
  totalParticipants: 0,
  won: 0,
  lost: 0,
  inProgress: 0,
  passRatePercent: 0,
}

// Placeholder equity curve for "Trade growth view" (replace with API later)
const PLACEHOLDER_EQUITY_DATA = [
  { day: 1, equity: 39800 },
  { day: 3, equity: 40100 },
  { day: 5, equity: 40500 },
  { day: 7, equity: 41200 },
  { day: 10, equity: 41800 },
  { day: 12, equity: 41500 },
  { day: 15, equity: 42200 },
  { day: 18, equity: 42700 },
  { day: 21, equity: 42400 },
  { day: 24, equity: 43100 },
]

function TradeGrowthChart({ data }: { data: { day: number; equity: number }[] }) {
  const width = 400
  const height = 220
  const padding = { top: 16, right: 16, bottom: 28, left: 44 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const values = data.map((d) => d.equity)
  const minY = Math.min(...values) - 200
  const maxY = Math.max(...values) + 200
  const scaleY = (v: number) =>
    padding.top + chartHeight - ((v - minY) / (maxY - minY)) * chartHeight
  const scaleX = (i: number) => padding.left + (i / Math.max(data.length - 1, 1)) * chartWidth
  const points = data.map((d, i) => `${scaleX(i)},${scaleY(d.equity)}`).join(' L ')
  const path = `M ${points}`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full min-h-[200px]" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="equity-gradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgb(59, 130, 246)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="rgb(59, 130, 246)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${path} L ${scaleX(data.length - 1)},${padding.top + chartHeight} L ${padding.left},${padding.top + chartHeight} Z`}
        fill="url(#equity-gradient)"
      />
      <path d={path} fill="none" stroke="rgb(59, 130, 246)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <line
        x1={padding.left}
        y1={scaleY(maxY - 400)}
        x2={width - padding.right}
        y2={scaleY(maxY - 400)}
        stroke="rgb(34, 197, 94)"
        strokeWidth="1"
        strokeDasharray="4 2"
      />
      <text x={width - padding.right - 4} y={scaleY(maxY - 400) - 4} textAnchor="end" className="text-[10px] fill-current" style={{ fill: 'rgb(34, 197, 94)' }}>
        Target
      </text>
    </svg>
  )
}

export function AdminFundedPlanDetailPage() {
  const { planId } = useParams<{ planId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as LocationState
  const plan = state?.plan ?? null
  const planStats = state?.planStats ?? PLACEHOLDER_PLAN_STATS

  if (!plan || plan.id !== planId) {
    return (
      <ContentShell>
        <PageHeader title="Plan not found" />
        <p className="text-sm text-text-muted mb-4">This plan may have been removed or the link is invalid.</p>
        <div className="flex justify-end">
          <Button variant="outline" asChild>
            <Link to="/admin/funded-programs">
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back to Funded programs
            </Link>
          </Button>
        </div>
      </ContentShell>
    )
  }

  // Example account size for displaying limit $ amounts (e.g. $40K)
  const exampleAccountSize = plan.payGetTiers[0]?.get ?? 40000
  const maxDailyLimitDollars = Math.abs((exampleAccountSize * Math.abs(plan.phase01.maxDailyLoss)) / 100)
  const profitTargetDollars = (exampleAccountSize * plan.phase01.profitTarget) / 100
  const maxLossDollars = Math.abs((exampleAccountSize * Math.abs(plan.phase01.maxOverallLoss)) / 100)

  return (
    <ContentShell>
      <PageHeader
        title={plan.name}
        description={`Plan rules and statistics. Account tiers: ${plan.payGetTiers.map((t) => `$${(t.get / 1000).toFixed(0)}K`).join(', ')}.`}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/funded-programs')} className="gap-1.5 text-text-muted hover:text-text">
            <ChevronLeft className="h-4 w-4" />
            Back to Funded programs
          </Button>
        }
      />

      {/* Top row: Performance / limit cards (plan rules) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-danger/10 text-danger">
              <TrendingDown className="h-4 w-4" />
            </div>
            <span className="text-xs text-text-muted">Phase 1 rule</span>
          </div>
          <div className="text-sm font-medium text-text-muted">Max Daily Limit</div>
          <div className="text-xl font-bold text-text mt-0.5">
            {plan.phase01.maxDailyLoss}% of account
          </div>
          <div className="mt-2 h-2 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full w-0 rounded-full bg-danger/50" style={{ width: '0%' }} />
          </div>
          <p className="text-xs text-text-muted mt-1.5">≈ ${maxDailyLimitDollars.toLocaleString('en-US', { maximumFractionDigits: 0 })} on ${(exampleAccountSize / 1000).toFixed(0)}K</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/10 text-success">
              <Target className="h-4 w-4" />
            </div>
            <span className="text-xs text-text-muted">Phase 1 target</span>
          </div>
          <div className="text-sm font-medium text-text-muted">Profit Target</div>
          <div className="text-xl font-bold text-text mt-0.5">
            {plan.phase01.profitTarget}% / {plan.phase02.profitTarget}% (P2)
          </div>
          <div className="mt-2 h-2 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full rounded-full bg-success/50" style={{ width: '18%' }} />
          </div>
          <p className="text-xs text-text-muted mt-1.5">≈ ${profitTargetDollars.toLocaleString('en-US', { maximumFractionDigits: 0 })} on ${(exampleAccountSize / 1000).toFixed(0)}K</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
              <TrendingUp className="h-4 w-4" />
            </div>
            <span className="text-xs text-text-muted">Phase 1 rule</span>
          </div>
          <div className="text-sm font-medium text-text-muted">Max Loss Limit</div>
          <div className="text-xl font-bold text-text mt-0.5">
            {plan.phase01.maxOverallLoss}% of account
          </div>
          <div className="mt-2 h-2 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full w-0 rounded-full bg-amber-500/50" />
          </div>
          <p className="text-xs text-text-muted mt-1.5">≈ -${maxLossDollars.toLocaleString('en-US', { maximumFractionDigits: 0 })} on ${(exampleAccountSize / 1000).toFixed(0)}K</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Trade growth view */}
        <div className="lg:col-span-2">
          <Card className="p-4 h-full min-h-[260px]">
            <h3 className="text-sm font-semibold text-text mb-3">Trade growth view</h3>
            <p className="text-xs text-text-muted mb-3">Equity curve (placeholder — connect live data per account or plan)</p>
            <div className="bg-surface-2/30 rounded-lg p-3">
              <TradeGrowthChart data={PLACEHOLDER_EQUITY_DATA} />
            </div>
          </Card>
        </div>

        {/* Right column: Plan details + Statistics + Premium features */}
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-text mb-3">Plan details</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-text-muted">Status</dt>
                <dd>
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', plan.active ? 'bg-success/20 text-success' : 'bg-slate-600 text-slate-400')}>
                    {plan.active ? 'Active' : 'Inactive'}
                  </span>
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-text-muted">Account sizes</dt>
                <dd className="text-text">{plan.payGetTiers.map((t) => `$${(t.get / 1000).toFixed(0)}K`).join(', ')}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-text-muted">Phase 1</dt>
                <dd className="text-text">{plan.phase01.profitTarget}% target, {plan.phase01.challengeDuration}d</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-text-muted">Phase 2</dt>
                <dd className="text-text">{plan.phase02.profitTarget}% target, {plan.phase02.challengeDuration}d</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-text-muted">Account type</dt>
                <dd className="text-text">Evaluation</dd>
              </div>
            </dl>
          </Card>

          <Card className="p-4">
            <h3 className="text-sm font-semibold text-text mb-3">Plan statistics</h3>
            <ul className="space-y-3">
              <li className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs text-text-muted">Participants</div>
                  <div className="font-semibold text-text">{planStats.totalParticipants}</div>
                </div>
              </li>
              <li className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10 text-success">
                  <Trophy className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs text-text-muted">Won</div>
                  <div className="font-semibold text-text">{planStats.won}</div>
                </div>
              </li>
              <li className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-danger/10 text-danger">
                  <XCircle className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs text-text-muted">Lost</div>
                  <div className="font-semibold text-text">{planStats.lost}</div>
                </div>
              </li>
              <li className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                  <Activity className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs text-text-muted">In progress</div>
                  <div className="font-semibold text-text">{planStats.inProgress}</div>
                </div>
              </li>
              <li className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-text-muted border border-border">
                  <Percent className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs text-text-muted">Pass rate</div>
                  <div className="font-semibold text-text">{planStats.totalParticipants > 0 ? `${planStats.passRatePercent}%` : '—'}</div>
                </div>
              </li>
            </ul>
          </Card>

          <Card className="p-4">
            <h3 className="text-sm font-semibold text-text mb-3">Premium features</h3>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-text-muted">Double Leverage</span>
                <span className={cn('font-medium', plan.addOns.doubleLeverage.enabled ? 'text-success' : 'text-text-muted')}>
                  {plan.addOns.doubleLeverage.enabled ? 'On' : 'Off'}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-text-muted">Payout Express</span>
                <span className={cn('font-medium', plan.addOns.payoutExpress.enabled ? 'text-success' : 'text-text-muted')}>
                  {plan.addOns.payoutExpress.enabled ? 'On' : 'Off'}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-text-muted">Profit Booster</span>
                <span className={cn('font-medium', plan.addOns.profitBooster.enabled ? 'text-success' : 'text-text-muted')}>
                  {plan.addOns.profitBooster.enabled ? 'On' : 'Off'}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-text-muted">Hold over weekend</span>
                <span className={cn('font-medium', plan.addOns.holdOverWeekend.enabled ? 'text-success' : 'text-text-muted')}>
                  {plan.addOns.holdOverWeekend.enabled ? 'On' : 'Off'}
                </span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </ContentShell>
  )
}
