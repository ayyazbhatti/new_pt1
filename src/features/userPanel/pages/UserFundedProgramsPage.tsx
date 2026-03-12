import { useState, useCallback } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import {
  Check,
  X,
  TrendingUp,
  BarChart3,
  Clock,
  Zap,
  Calendar,
  Copy,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/shared/utils'
import { toast } from '@/shared/components/common'

type PlanStatus = 'active' | 'failed' | 'passed'

interface UserPlan {
  id: string
  planName: string
  propFirm: string
  displayId: string
  purchasedAt: string
  status: PlanStatus
  phase: 1 | 2
}

const DEMO_PLANS: UserPlan[] = [
  { id: '1', planName: 'Advanced 40K', propFirm: 'Bigfunded PROP', displayId: '436044', purchasedAt: '2026-03-10T12:13:00', status: 'active', phase: 1 },
  { id: '2', planName: 'Advanced 50K', propFirm: 'Shlomi PROP', displayId: '436043', purchasedAt: '2026-03-10T11:49:00', status: 'failed', phase: 1 },
  { id: '3', planName: 'Advanced 50K', propFirm: 'Elvijs PROP', displayId: '435900', purchasedAt: '2026-03-05T12:29:00', status: 'failed', phase: 1 },
]

const PROMO = {
  title: '10% Discount For',
  challengeTypes: [
    { name: 'Instant Funded', sizes: ['$5k', '$10k', '$15k', '$20k'] },
    { name: '2-Steps Challenge', sizes: ['$5k', '$10k', '$15k', '$20k'] },
    { name: 'Three Step Challenge', sizes: ['$10k', '$20k', '$30k', '$50k'] },
    { name: 'FMLS 2025', sizes: ['$5k', '$20k', '$30k', '$50k'] },
  ],
  startDate: '30.04.25',
  endDate: '11.09.26',
  couponCode: 'VC300',
}

const BANNER_STORAGE_KEY = 'user-funded-program-audition-banner-dismissed'

function formatPurchaseDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export function UserFundedProgramsPage() {
  const [filter, setFilter] = useState<'all' | PlanStatus>('all')
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(BANNER_STORAGE_KEY) === '1'
  })
  const [plans] = useState<UserPlan[]>(DEMO_PLANS)

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true)
    try {
      localStorage.setItem(BANNER_STORAGE_KEY, '1')
    } catch {}
  }, [])

  const filteredPlans = filter === 'all' ? plans : plans.filter((p) => p.status === filter)

  const copyCoupon = useCallback(() => {
    try {
      navigator.clipboard.writeText(PROMO.couponCode)
      toast.success('Coupon code copied.')
    } catch {
      toast.error('Could not copy.')
    }
  }, [])

  return (
    <ContentShell>
      <PageHeader
        title="My Plans"
        description="Track your evaluation challenges and funded accounts."
      />

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-surface-2/60 w-fit mb-6">
        {(['all', 'active', 'failed', 'passed'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilter(tab)}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium capitalize transition-colors',
              filter === tab
                ? 'bg-surface border border-border text-text shadow-sm'
                : 'text-text-muted hover:text-text border border-transparent'
            )}
          >
            {tab === 'all' ? 'All' : tab === 'active' ? 'Active' : tab === 'failed' ? 'Failed' : 'Passed'}
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
        {/* Main content */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Start Audition banner */}
          {!bannerDismissed && (
            <Card className="relative rounded-xl border border-success/50 bg-success/5 p-4 pr-10">
              <button
                type="button"
                onClick={dismissBanner}
                className="absolute right-3 top-3 p-1 rounded text-text-muted hover:text-text"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="flex items-start gap-3">
                <div className="shrink-0 rounded-full bg-success/20 p-2">
                  <Check className="h-5 w-5 text-success" />
                </div>
                <div>
                  <h3 className="font-semibold text-text">Start your Audition</h3>
                  <p className="text-sm text-text-muted mt-1">
                    Before starting your audition challenge, please complete the identity verification process. This ensures your account meets compliance standards and is ready to begin.
                  </p>
                  <button
                    type="button"
                    className="mt-3 text-sm font-medium text-success hover:underline inline-flex items-center gap-1"
                  >
                    Start Audition
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </Card>
          )}

          {/* Plan cards */}
          {filteredPlans.length === 0 ? (
            <Card className="rounded-xl border border-border bg-surface-2/40 p-8 text-center">
              <p className="text-sm text-text-muted">No plans match this filter.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setFilter('all')}>
                View all
              </Button>
            </Card>
          ) : (
            filteredPlans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))
          )}
        </div>

        {/* Right sidebar – promo */}
        <aside className="lg:w-[320px] shrink-0">
          <Card className="rounded-xl border border-border bg-surface-2/40 p-5 sticky top-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="rounded-lg bg-success/10 p-2">
                <Zap className="h-5 w-5 text-success" />
              </div>
              <h3 className="font-semibold text-text">{PROMO.title}</h3>
            </div>
            <ul className="space-y-3 text-sm">
              {PROMO.challengeTypes.map((ct) => (
                <li key={ct.name}>
                  <span className="font-medium text-text">{ct.name}:</span>
                  <span className="text-text-muted ml-1">{ct.sizes.join(' / ')}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 mt-4 text-xs text-text-muted">
              <Calendar className="h-4 w-4 shrink-0" />
              <span>Start {PROMO.startDate} Ends {PROMO.endDate}</span>
            </div>
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-text-muted mb-2">Coupon code</p>
              <button
                type="button"
                onClick={copyCoupon}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-success/50 bg-success/10 py-2.5 text-sm font-medium text-success hover:bg-success/20 transition-colors"
              >
                <span>Coupon code: {PROMO.couponCode}</span>
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 flex items-end justify-between gap-2">
              <div className="w-10 h-10 rounded bg-surface-2" />
              <div className="w-12 h-12 rounded bg-success/20 flex items-center justify-center text-success font-bold text-lg">$</div>
            </div>
          </Card>
        </aside>
      </div>
    </ContentShell>
  )
}

function PlanCard({ plan }: { plan: UserPlan }) {
  const isActive = plan.status === 'active'
  const isFailed = plan.status === 'failed'
  const isPassed = plan.status === 'passed'
  const phase1Active = plan.phase === 1 && (isActive || isFailed)
  const phase2Active = plan.phase === 2 && isActive

  return (
    <Card className="rounded-xl border border-border bg-surface-2/40 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-text">{plan.planName}</h3>
            <span className="text-sm text-text-muted">{plan.propFirm}</span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">ID: {plan.displayId}</p>
          <p className="text-xs text-text-muted mt-0.5">Purchased {formatPurchaseDate(plan.purchasedAt)}</p>
          <div className="mt-3">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
                isActive && 'bg-blue-500/20 text-blue-400',
                isFailed && 'bg-danger/20 text-danger',
                isPassed && 'bg-success/20 text-success'
              )}
            >
              {plan.status === 'active' ? 'Active' : plan.status === 'failed' ? 'Failed' : 'Passed'}
            </span>
          </div>
        </div>

        {/* Phase progress */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center">
            <div
              className={cn(
                'flex flex-col items-center',
                phase1Active ? 'text-accent' : isFailed ? 'text-danger/80' : 'text-text-muted'
              )}
            >
              <div
                className={cn(
                  'h-8 w-8 rounded-full border-2 flex items-center justify-center text-xs font-medium',
                  phase1Active ? 'border-accent bg-accent/20 text-accent' : isFailed ? 'border-danger/50 bg-danger/10 text-danger' : 'border-border bg-surface-2 text-text-muted'
                )}
              >
                1
              </div>
              <span className="text-[10px] mt-1 font-medium">Phase 1 Audition</span>
            </div>
            <div className="w-8 sm:w-12 h-0.5 bg-border mx-0.5" />
            <div className="flex flex-col items-center text-text-muted">
              <div
                className={cn(
                  'h-8 w-8 rounded-full border-2 flex items-center justify-center text-xs font-medium',
                  phase2Active ? 'border-accent bg-accent/20 text-accent' : 'border-border bg-surface-2 text-text-muted'
                )}
              >
                2
              </div>
              <span className="text-[10px] mt-1 font-medium">Phase 2 Funded</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {isActive && (
            <>
              <Button size="sm" className="gap-1.5">
                <TrendingUp className="h-4 w-4" />
                Trade now
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5">
                <BarChart3 className="h-4 w-4" />
                Stats
              </Button>
            </>
          )}
          {isFailed && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5">
                <BarChart3 className="h-4 w-4" />
                Stats
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Clock className="h-4 w-4" />
                Show History
              </Button>
            </>
          )}
          {isPassed && (
            <>
              <Button size="sm" className="gap-1.5">
                <TrendingUp className="h-4 w-4" />
                Trade now
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5">
                <BarChart3 className="h-4 w-4" />
                Stats
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
