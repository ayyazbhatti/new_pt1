import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import { CreatePlanWizard } from '../components/CreatePlanWizard'
import { GuideModal } from '../modals/GuideModal'
import { Flag, Plus, Pencil, Trash2, Info, ChevronRight, Users, Trophy, XCircle, Activity, Percent } from 'lucide-react'
import { cn } from '@/shared/utils'
import type { FundedPlan } from '../types/plan'
import {
  DEFAULT_RETRY,
  DEFAULT_PHASE_CONDITIONS,
  DEFAULT_ADDONS,
  DEFAULT_CHALLENGE_KEEPER,
} from '../types/plan'

/** Plan-level stats: participants, won, lost, in progress. Replace with API later. */
export type PlanStats = {
  totalParticipants: number
  won: number
  lost: number
  inProgress: number
  passRatePercent: number
}

// Placeholder stats until API is connected
const PLACEHOLDER_STATS: PlanStats = {
  totalParticipants: 0,
  won: 0,
  lost: 0,
  inProgress: 0,
  passRatePercent: 0,
}

const DEMO_PLAN: FundedPlan = {
  id: 'plan-1',
  name: 'Standard evaluation',
  payGetTiers: [
    { id: '1', pay: 100, get: 25000, popular: true },
    { id: '2', pay: 200, get: 50000 },
    { id: '3', pay: 499, get: 100000 },
  ],
  retry: { ...DEFAULT_RETRY, discountAmount: 20, expirationDays: 7, totalRetriesByPurchase: 4 },
  phase01: { ...DEFAULT_PHASE_CONDITIONS, profitTarget: 10, maxDailyLoss: -5, maxOverallLoss: -10, challengeDuration: 30 },
  phase02: { ...DEFAULT_PHASE_CONDITIONS, profitTarget: 5, challengeDuration: 60, maxDailyLoss: -5, maxOverallLoss: -10 },
  phase03: { ...DEFAULT_PHASE_CONDITIONS },
  addOns: DEFAULT_ADDONS,
  challengeKeeper: { ...DEFAULT_CHALLENGE_KEEPER, accountSizeLabel: '$25K' },
  active: true,
}

export function AdminFundedProgramsPage() {
  const navigate = useNavigate()
  const openModal = useModalStore((state) => state.openModal)
  const [plans, setPlans] = useState<FundedPlan[]>([DEMO_PLAN])
  // TODO: Replace with API e.g. getFundedProgramStats()
  const [stats] = useState<PlanStats>(PLACEHOLDER_STATS)

  const handleViewPlanDetail = useCallback(
    (plan: FundedPlan) => {
      navigate(`/admin/funded-programs/${plan.id}`, { state: { plan, planStats: stats } })
    },
    [navigate, stats]
  )

  const handleOpenGuide = useCallback(() => {
    openModal('funded-guide', <GuideModal />, {
      title: 'Funded programs guide',
      description: 'Quick reference for packages, challenges, and rewards.',
      size: 'md',
    })
  }, [openModal])

  const handleCreatePlan = useCallback(() => {
    openModal(
      'funded-create-plan',
      (
        <CreatePlanWizard
          onSave={(plan) => setPlans((prev) => [...prev, plan])}
          modalKey="funded-create-plan"
        />
      ),
      { title: 'Create a new plan', description: 'Configure payment tiers, conditions, add-ons, and challenge keeper.', size: 'xl' }
    )
  }, [openModal])

  const handleEditPlan = useCallback(
    (plan: FundedPlan) => {
      const key = `funded-edit-plan-${plan.id}`
      openModal(
        key,
        (
          <CreatePlanWizard
            plan={plan}
            onSave={(updated) => setPlans((prev) => prev.map((p) => (p.id === plan.id ? updated : p)))}
            modalKey={key}
          />
        ),
        { title: 'Edit plan', description: 'Update payment tiers, conditions, add-ons, and challenge keeper.', size: 'xl' }
      )
    },
    [openModal]
  )

  const handleDeletePlan = useCallback(
    (plan: FundedPlan) => {
      const key = `funded-delete-plan-${plan.id}`
      openModal(
        key,
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text">
            Delete plan &quot;{plan.name}&quot;? This will remove all Pay/Get tiers and settings. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => useModalStore.getState().closeModal(key)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setPlans((prev) => prev.filter((p) => p.id !== plan.id))
                useModalStore.getState().closeModal(key)
              }}
            >
              Delete
            </Button>
          </div>
        </div>,
        { title: 'Delete plan', size: 'sm' }
      )
    },
    [openModal]
  )

  return (
    <ContentShell>
      <PageHeader
        title="Funded programs"
        description="Create and manage evaluation plans: Pay/Get tiers, retry settings, challenge conditions, add-ons, and challenge keeper."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleOpenGuide}>
              <Info className="h-4 w-4 mr-2" />
              Guide
            </Button>
            <Button size="sm" onClick={handleCreatePlan}>
              <Plus className="h-4 w-4 mr-2" />
              Create a new plan
            </Button>
          </div>
        }
      />

      {/* Plan statistics: participants, win, loss, etc. */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-text-muted mb-3">Plan statistics</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Card className="p-4 flex flex-col gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-muted">Participants</div>
              <div className="text-2xl font-bold text-text">{stats.totalParticipants}</div>
              <p className="text-xs text-text-muted mt-0.5">Users who started a challenge</p>
            </div>
          </Card>
          <Card className="p-4 flex flex-col gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 text-success">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-muted">Won</div>
              <div className="text-2xl font-bold text-text">{stats.won}</div>
              <p className="text-xs text-text-muted mt-0.5">Passed & funded</p>
            </div>
          </Card>
          <Card className="p-4 flex flex-col gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-danger/10 text-danger">
              <XCircle className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-muted">Lost</div>
              <div className="text-2xl font-bold text-text">{stats.lost}</div>
              <p className="text-xs text-text-muted mt-0.5">Failed challenge</p>
            </div>
          </Card>
          <Card className="p-4 flex flex-col gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-muted">In progress</div>
              <div className="text-2xl font-bold text-text">{stats.inProgress}</div>
              <p className="text-xs text-text-muted mt-0.5">Active evaluations</p>
            </div>
          </Card>
          <Card className="p-4 flex flex-col gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-1 text-text-muted border border-border">
              <Percent className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-muted">Pass rate</div>
              <div className="text-2xl font-bold text-text">
                {stats.totalParticipants > 0 ? `${stats.passRatePercent}%` : '—'}
              </div>
              <p className="text-xs text-text-muted mt-0.5">Won / (Won + Lost)</p>
            </div>
          </Card>
        </div>
      </section>

      {/* Plans list */}
      <section>
        {plans.length === 0 ? (
          <Card className="rounded-xl border border-border bg-surface-2/40 border-dashed p-12 text-center">
            <Flag className="mx-auto h-12 w-12 text-text-muted/50 mb-4" />
            <h3 className="text-lg font-semibold text-text mb-1">No plans yet</h3>
            <p className="text-sm text-text-muted mb-6 max-w-md mx-auto">
              Create your first evaluation plan to define Pay/Get tiers, retry rules, challenge conditions, add-ons, and challenge keeper settings.
            </p>
            <Button onClick={handleCreatePlan}>
              <Plus className="h-4 w-4 mr-2" />
              Create a new plan
            </Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {plans.map((plan) => (
              <Card
                key={plan.id}
                className={cn(
                  'rounded-xl border transition-colors hover:bg-surface-2/50',
                  plan.active ? 'border-border bg-surface-2/30' : 'border-border bg-surface-2/20 opacity-80'
                )}
              >
                <div className="flex items-center justify-between gap-4 p-4 sm:p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-text">{plan.name}</h3>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          plan.active ? 'bg-success/20 text-success' : 'bg-slate-600 text-slate-400'
                        )}
                      >
                        {plan.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-sm text-text-muted">
                      <span>Pay/Get: {plan.payGetTiers.map((t) => `$${t.pay} → $${(t.get / 1000).toFixed(0)}K`).join(', ')}</span>
                      <span>•</span>
                      <span>Retry: {plan.retry.planRetry ? `${plan.retry.discountAmount}% off, ${plan.retry.totalRetriesByPurchase} max` : 'Off'}</span>
                      <span>•</span>
                      <span>Phases: P1 {plan.phase01.profitTarget}% / {plan.phase01.challengeDuration}d, P2 {plan.phase02.profitTarget}% / {plan.phase02.challengeDuration}d</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => handleEditPlan(plan)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-danger hover:text-danger" aria-label="Delete" onClick={() => handleDeletePlan(plan)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="View plan details"
                      onClick={() => handleViewPlanDetail(plan)}
                      className="text-text-muted hover:text-text"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </ContentShell>
  )
}
