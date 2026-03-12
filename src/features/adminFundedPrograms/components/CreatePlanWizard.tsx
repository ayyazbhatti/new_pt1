import { useState, useCallback } from 'react'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Switch } from '@/shared/ui/Switch'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import {
  Flag,
  Plus,
  Star,
  Flame,
  Trash2,
  ChevronRight,
  Info,
  Check,
} from 'lucide-react'
import { cn } from '@/shared/utils'
import type {
  FundedPlan,
  PayGetTier,
  RetrySettings,
  PhaseConditions,
  AddOns,
  ChallengeKeeperSettings,
} from '../types/plan'
import {
  DEFAULT_RETRY as DEF_RETRY,
  DEFAULT_PHASE_CONDITIONS as DEF_PHASE,
  DEFAULT_ADDONS as DEF_ADDONS,
  DEFAULT_CHALLENGE_KEEPER as DEF_KEEPER,
  CONDITION_OPTIONS,
} from '../types/plan'

const STEPS = [
  { id: 1, label: 'Pay & Get', nextLabel: 'Next: Conditions' },
  { id: 2, label: 'Conditions', nextLabel: 'Next: Add-ons' },
  { id: 3, label: 'Add-ons', nextLabel: 'Next: Challenge Keeper' },
  { id: 4, label: 'Challenge Keeper', nextLabel: 'Save Plan' },
]

const PHASE_TABS = [
  { id: 'phase01', label: 'Phase 01 – Audition' },
  { id: 'phase02', label: 'Phase 02 – Audition' },
  { id: 'phase03', label: 'Phase 03 – Funded' },
]

function nextTierId(tiers: PayGetTier[]): string {
  const nums = tiers.map((t) => parseInt(t.id, 10)).filter((n) => !isNaN(n))
  return String((nums.length ? Math.max(...nums) : 0) + 1)
}

interface CreatePlanWizardProps {
  plan?: FundedPlan | null
  onSave: (plan: FundedPlan) => void
  modalKey: string
}

export function CreatePlanWizard({ plan, onSave, modalKey }: CreatePlanWizardProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [step, setStep] = useState(0)

  const [payGetTiers, setPayGetTiers] = useState<PayGetTier[]>(
    plan?.payGetTiers?.length ? plan.payGetTiers : [{ id: '1', pay: 100, get: 25000 }, { id: '2', pay: 200, get: 50000 }]
  )
  const [retry, setRetry] = useState<RetrySettings>(plan?.retry ?? DEF_RETRY)
  const [phase01, setPhase01] = useState<PhaseConditions>(plan?.phase01 ?? DEF_PHASE)
  const [phase02, setPhase02] = useState<PhaseConditions>(plan?.phase02 ?? { ...DEF_PHASE, profitTarget: 5, challengeDuration: 60 })
  const [phase03, setPhase03] = useState<PhaseConditions>(plan?.phase03 ?? { ...DEF_PHASE })
  const [addOns, setAddOns] = useState<AddOns>(plan?.addOns ?? DEF_ADDONS)
  const [challengeKeeper, setChallengeKeeper] = useState<ChallengeKeeperSettings>(plan?.challengeKeeper ?? DEF_KEEPER)
  const [phaseTab, setPhaseTab] = useState(0)
  const [keeperPhaseTab, setKeeperPhaseTab] = useState(0)

  const addTier = useCallback(() => {
    setPayGetTiers((prev) => [...prev, { id: nextTierId(prev), pay: 0, get: 0 }])
  }, [])

  const removeTier = useCallback((id: string) => {
    setPayGetTiers((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toggleTierFavorite = useCallback((id: string) => {
    setPayGetTiers((prev) => prev.map((t) => (t.id === id ? { ...t, favorite: !t.favorite } : t)))
  }, [])

  const toggleTierPopular = useCallback((id: string) => {
    setPayGetTiers((prev) => prev.map((t) => (t.id === id ? { ...t, popular: !t.popular } : t)))
  }, [])

  const updateTier = useCallback((id: string, pay: number, get: number) => {
    setPayGetTiers((prev) => prev.map((t) => (t.id === id ? { ...t, pay, get } : t)))
  }, [])

  const getPhaseConditions = (i: number) => [phase01, phase02, phase03][i]
  const setPhaseConditions = (i: number, c: PhaseConditions) => {
    if (i === 0) setPhase01(c)
    else if (i === 1) setPhase02(c)
    else setPhase03(c)
  }

  const handleSave = useCallback(() => {
    if (payGetTiers.length === 0) {
      toast.error('Add at least one Pay / Get tier.')
      return
    }
    const planId = plan?.id ?? `plan-${Date.now()}`
    onSave({
      id: planId,
      name: plan?.name ?? `Plan ${planId}`,
      payGetTiers,
      retry,
      phase01,
      phase02,
      phase03,
      addOns,
      challengeKeeper,
      active: plan?.active ?? true,
    })
    toast.success(plan ? 'Plan updated.' : 'Plan created.')
    closeModal(modalKey)
  }, [plan, payGetTiers, retry, phase01, phase02, phase03, addOns, challengeKeeper, onSave, modalKey, closeModal])

  const numSteps = STEPS.length
  const isLast = step === numSteps - 1

  return (
    <div className="flex flex-col min-h-0">
      {/* Progress */}
      <div className="flex flex-col items-center gap-2 mb-6">
        <div className="flex items-center gap-2">
          <Flag className="h-4 w-4 text-text-muted shrink-0" />
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Create a new plan</span>
        </div>
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium border shrink-0',
                  i < step ? 'border-success bg-success/20 text-success' : i === step ? 'border-accent bg-accent text-white' : 'border-border bg-surface-2 text-text-muted'
                )}
              >
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              {i < numSteps - 1 && <div className={cn('w-4 sm:w-6 h-0.5', i < step ? 'bg-success' : 'bg-border')} />}
            </div>
          ))}
        </div>
        <p className="text-xs text-text-muted">Step {step + 1} of {numSteps}: {STEPS[step].label}</p>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto min-h-[320px]">
        {step === 0 && (
          <>
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-text mb-2">Payment & account size</h3>
              <p className="text-xs text-text-muted mb-3">Define Pay / Get pairs. Users pay X and get account size Y.</p>
              <div className="space-y-2">
                {payGetTiers.map((tier) => (
                  <div key={tier.id} className="flex items-center gap-2">
                    <div className="flex flex-1 gap-2">
                      <div className="flex-1">
                        <Label className="text-xs text-text-muted">Pay ($)</Label>
                        <Input
                          type="number"
                          min={0}
                          value={tier.pay || ''}
                          onChange={(e) => updateTier(tier.id, Number(e.target.value) || 0, tier.get)}
                          className="h-9 mt-0.5"
                        />
                      </div>
                      <span className="self-end pb-2 text-text-muted">→</span>
                      <div className="flex-1">
                        <Label className="text-xs text-text-muted">Get ($)</Label>
                        <Input
                          type="number"
                          min={0}
                          value={tier.get || ''}
                          onChange={(e) => updateTier(tier.id, tier.pay, Number(e.target.value) || 0)}
                          className="h-9 mt-0.5"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 pt-5">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleTierFavorite(tier.id)} title="Favorite">
                        <Star className={cn('h-4 w-4', tier.favorite && 'fill-amber-400 text-amber-400')} />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleTierPopular(tier.id)} title="Popular">
                        <Flame className={cn('h-4 w-4', tier.popular && 'text-orange-400')} />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-danger" onClick={() => removeTier(tier.id)} title="Remove">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={addTier}>
                <Plus className="h-4 w-4 mr-2" />
                Add account size
              </Button>
            </div>

            <Card className="p-4 rounded-lg border border-border bg-surface-2/40">
              <h3 className="text-sm font-semibold text-text mb-3">Retry settings</h3>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-xs text-text-muted">Plan retry</p>
                  <p className="text-xs text-text-muted mt-0.5">Allows traders to buy the same plan again at a discount. Failed retries cannot be retried.</p>
                </div>
                <Switch checked={retry.planRetry} onCheckedChange={(v) => setRetry((r) => ({ ...r, planRetry: v }))} />
              </div>
              {retry.planRetry && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Discount amount (%) *</Label>
                    <div className="flex items-center gap-1 mt-1">
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setRetry((r) => ({ ...r, discountAmount: Math.max(0, r.discountAmount - 5) }))}>−</Button>
                      <Input type="number" min={0} max={100} value={retry.discountAmount} onChange={(e) => setRetry((r) => ({ ...r, discountAmount: Number(e.target.value) || 0 }))} className="h-9 text-center" />
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setRetry((r) => ({ ...r, discountAmount: Math.min(100, r.discountAmount + 5) }))}>+</Button>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Discount source price</Label>
                    <select
                      value={retry.discountSourcePrice}
                      onChange={(e) => setRetry((r) => ({ ...r, discountSourcePrice: e.target.value as 'original' | 'current' }))}
                      className="mt-1 h-9 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-text"
                    >
                      <option value="original">Original price</option>
                      <option value="current">Current price</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Expiration (days since failure) *</Label>
                    <div className="flex items-center gap-1 mt-1">
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setRetry((r) => ({ ...r, expirationDays: Math.max(1, r.expirationDays - 1) }))}>−</Button>
                      <Input type="number" min={1} value={retry.expirationDays} onChange={(e) => setRetry((r) => ({ ...r, expirationDays: Number(e.target.value) || 1 }))} className="h-9 text-center" />
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setRetry((r) => ({ ...r, expirationDays: r.expirationDays + 1 }))}>+</Button>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Total retries by purchase *</Label>
                    <div className="flex items-center gap-1 mt-1">
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setRetry((r) => ({ ...r, totalRetriesByPurchase: Math.max(0, r.totalRetriesByPurchase - 1) }))}>−</Button>
                      <Input type="number" min={0} value={retry.totalRetriesByPurchase} onChange={(e) => setRetry((r) => ({ ...r, totalRetriesByPurchase: Number(e.target.value) || 0 }))} className="h-9 text-center" />
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setRetry((r) => ({ ...r, totalRetriesByPurchase: r.totalRetriesByPurchase + 1 }))}>+</Button>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          </>
        )}

        {step === 1 && (
          <>
            <div className="flex gap-1 mb-4 p-1 rounded-lg bg-surface-2/60">
              {PHASE_TABS.map((tab, i) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPhaseTab(i)}
                  className={cn(
                    'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    phaseTab === i ? 'bg-surface border border-border text-text' : 'text-text-muted hover:text-text'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <ChallengeConditionsForm
              conditions={getPhaseConditions(phaseTab)}
              onChange={(c) => setPhaseConditions(phaseTab, c)}
            />
          </>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <AddOnRow
              title="Payout Express"
              description="Enables faster payouts on funded accounts based on the specified number of days."
              enabled={addOns.payoutExpress.enabled}
              onToggle={(v) => setAddOns((a) => ({ ...a, payoutExpress: { ...a.payoutExpress, enabled: v } }))}
              config={
                addOns.payoutExpress.enabled && (
                  <div className="grid gap-3 sm:grid-cols-3 mt-3">
                    <div>
                      <Label className="text-xs flex items-center gap-1"># of Days <Info className="h-3 w-3 text-text-muted" /></Label>
                      <div className="flex gap-1 mt-1">
                        <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setAddOns((a) => ({ ...a, payoutExpress: { ...a.payoutExpress, days: Math.max(1, a.payoutExpress.days - 1) } }))}>−</Button>
                        <Input type="number" min={1} value={addOns.payoutExpress.days} onChange={(e) => setAddOns((a) => ({ ...a, payoutExpress: { ...a.payoutExpress, days: Number(e.target.value) || 1 } }))} className="h-9 text-center" />
                        <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setAddOns((a) => ({ ...a, payoutExpress: { ...a.payoutExpress, days: a.payoutExpress.days + 1 } }))}>+</Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs flex items-center gap-1">Price ($) <Info className="h-3 w-3 text-text-muted" /></Label>
                      <Input type="number" min={0} step={0.01} value={addOns.payoutExpress.price} onChange={(e) => setAddOns((a) => ({ ...a, payoutExpress: { ...a.payoutExpress, price: Number(e.target.value) || 0 } }))} className="h-9 mt-1" />
                    </div>
                    <div className="flex items-center gap-2 pt-6">
                      <input type="checkbox" id="pex-fixed" checked={addOns.payoutExpress.setToFixedPrice} onChange={(e) => setAddOns((a) => ({ ...a, payoutExpress: { ...a.payoutExpress, setToFixedPrice: e.target.checked } }))} className="rounded border-border" />
                      <Label htmlFor="pex-fixed" className="text-xs">Set to fixed price</Label>
                    </div>
                  </div>
                )
              }
            />
            <AddOnRow title="Profit Booster" description="Enables higher profit share to the trader." enabled={addOns.profitBooster.enabled} onToggle={(v) => setAddOns((a) => ({ ...a, profitBooster: { enabled: v } }))} />
            <AddOnRow title="Hold Over Weekend" description="Allows the trader to hold open positions over the weekend." enabled={addOns.holdOverWeekend.enabled} onToggle={(v) => setAddOns((a) => ({ ...a, holdOverWeekend: { enabled: v } }))} />
            <AddOnRow title="Double Leverage" description="Enables double leverage for the challenge." enabled={addOns.doubleLeverage.enabled} onToggle={(v) => setAddOns((a) => ({ ...a, doubleLeverage: { enabled: v } }))} />
          </div>
        )}

        {step === 3 && (
          <>
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-text mb-2">Challenge Keeper settings</h3>
              <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-4 py-3 mb-4">
                <span className="text-sm text-text">Keeper status</span>
                <Switch checked={challengeKeeper.keeperActive} onCheckedChange={(v) => setChallengeKeeper((k) => ({ ...k, keeperActive: v }))} />
              </div>
              <div className="mb-3">
                <Label className="text-xs text-text-muted">Account size</Label>
                {payGetTiers.length === 0 ? (
                  <p className="text-xs text-text-muted mt-1">Add Pay / Get tiers in Step 1 first.</p>
                ) : (
                  <select
                    value={challengeKeeper.accountSizeLabel}
                    onChange={(e) => setChallengeKeeper((k) => ({ ...k, accountSizeLabel: e.target.value }))}
                    className="mt-1 h-9 w-full max-w-[140px] rounded-lg border border-border bg-surface-1 px-3 text-sm text-text"
                  >
                    {payGetTiers.map((t) => (
                      <option key={t.id} value={`$${(t.get / 1000).toFixed(0)}K`}>{`$${(t.get / 1000).toFixed(0)}K`}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex gap-1 mb-3">
                {PHASE_TABS.map((tab, i) => (
                  <button key={tab.id} type="button" onClick={() => setKeeperPhaseTab(i)} className={cn('flex-1 rounded-md px-2 py-1.5 text-xs font-medium', keeperPhaseTab === i ? 'bg-accent/20 text-accent' : 'bg-surface-2/60 text-text-muted')}>
                    {tab.label}
                  </button>
                ))}
              </div>
              <div>
                <Label className="text-xs text-text-muted">Select conditions</Label>
                <p className="text-xs text-text-muted mt-0.5 mb-2">You need to select a condition for each plan by package and type.</p>
                <div className="flex flex-wrap gap-2">
                  {CONDITION_OPTIONS.map((opt) => {
                    const phaseKey = ['phase01', 'phase02', 'phase03'][keeperPhaseTab]
                    const selected = (challengeKeeper.selectedConditionsByPhase[phaseKey] ?? []).includes(opt.id)
                    const toggle = () => {
                      setChallengeKeeper((k) => {
                        const arr = k.selectedConditionsByPhase[phaseKey] ?? []
                        const next = selected ? arr.filter((x) => x !== opt.id) : [...arr, opt.id]
                        return { ...k, selectedConditionsByPhase: { ...k.selectedConditionsByPhase, [phaseKey]: next } }
                      })
                    }
                    return (
                      <button key={opt.id} type="button" onClick={toggle} className={cn('rounded-lg border px-3 py-1.5 text-xs font-medium flex items-center gap-1.5', selected ? 'border-accent bg-accent/20 text-accent' : 'border-border bg-surface-2 text-text-muted')}>
                        {selected && <Check className="h-3 w-3" />}
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-4 pt-4 mt-4 border-t border-border shrink-0">
        <Button type="button" variant="outline" onClick={() => (step === 0 ? closeModal(modalKey) : setStep((s) => s - 1))}>
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        {isLast ? (
          <Button onClick={handleSave}>Save plan</Button>
        ) : (
          <Button onClick={() => setStep((s) => s + 1)}>
            {STEPS[step].nextLabel}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  )
}

function ChallengeConditionsForm({ conditions, onChange }: { conditions: PhaseConditions; onChange: (c: PhaseConditions) => void }) {
  const update = (patch: Partial<PhaseConditions>) => onChange({ ...conditions, ...patch })
  return (
    <Card className="p-4 rounded-lg border border-border bg-surface-2/40 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label className="text-xs flex items-center gap-1">Max daily loss (%) <Info className="h-3 w-3 text-text-muted" /></Label>
          <div className="flex gap-1 mt-1">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => update({ maxDailyLoss: conditions.maxDailyLoss - 1 })}>−</Button>
            <Input type="number" value={conditions.maxDailyLoss} onChange={(e) => update({ maxDailyLoss: Number(e.target.value) || 0 })} className="h-9" />
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => update({ maxDailyLoss: conditions.maxDailyLoss + 1 })}>+</Button>
          </div>
        </div>
        <div>
          <Label className="text-xs flex items-center gap-1">Max overall loss (%) <Info className="h-3 w-3 text-text-muted" /></Label>
          <div className="flex gap-1 mt-1">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => update({ maxOverallLoss: conditions.maxOverallLoss - 1 })}>−</Button>
            <Input type="number" value={conditions.maxOverallLoss} onChange={(e) => update({ maxOverallLoss: Number(e.target.value) || 0 })} className="h-9" />
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => update({ maxOverallLoss: conditions.maxOverallLoss + 1 })}>+</Button>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="disable-min-days" checked={conditions.disableMinTradingDays} onChange={(e) => update({ disableMinTradingDays: e.target.checked })} className="rounded border-border" />
        <Label htmlFor="disable-min-days" className="text-xs">Disable minimum trading days</Label>
      </div>
      {!conditions.disableMinTradingDays && (
        <div>
          <Label className="text-xs">Minimum trading days</Label>
          <Input type="number" min={0} value={conditions.minTradingDays ?? ''} onChange={(e) => update({ minTradingDays: Number(e.target.value) || null })} className="h-9 mt-1 max-w-[120px]" />
        </div>
      )}
      <div className="flex items-center gap-2">
        <input type="checkbox" id="unlimited-days" checked={conditions.unlimitedDays} onChange={(e) => update({ unlimitedDays: e.target.checked })} className="rounded border-border" />
        <Label htmlFor="unlimited-days" className="text-xs">Set unlimited days</Label>
      </div>
      {!conditions.unlimitedDays && (
        <div>
          <Label className="text-xs">Challenge duration (days)</Label>
          <div className="flex gap-1 mt-1">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => update({ challengeDuration: Math.max(1, conditions.challengeDuration - 1) })}>−</Button>
            <Input type="number" min={1} value={conditions.challengeDuration} onChange={(e) => update({ challengeDuration: Number(e.target.value) || 1 })} className="h-9 w-24 text-center" />
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => update({ challengeDuration: conditions.challengeDuration + 1 })}>+</Button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input type="checkbox" id="no-profit-target" checked={conditions.noProfitTarget} onChange={(e) => update({ noProfitTarget: e.target.checked })} className="rounded border-border" />
        <Label htmlFor="no-profit-target" className="text-xs">No profit target</Label>
      </div>
      {!conditions.noProfitTarget && (
        <div>
          <Label className="text-xs">Profit target (%)</Label>
          <div className="flex gap-1 mt-1">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => update({ profitTarget: Math.max(0, conditions.profitTarget - 1) })}>−</Button>
            <Input type="number" min={0} value={conditions.profitTarget} onChange={(e) => update({ profitTarget: Number(e.target.value) || 0 })} className="h-9 w-24 text-center" />
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => update({ profitTarget: conditions.profitTarget + 1 })}>+</Button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input type="checkbox" id="disable-max-daily-profit" checked={conditions.disableMaxDailyProfit} onChange={(e) => update({ disableMaxDailyProfit: e.target.checked })} className="rounded border-border" />
        <Label htmlFor="disable-max-daily-profit" className="text-xs">Disable max daily profit</Label>
      </div>
      <div>
        <Label className="text-xs">Challenge leverage</Label>
        <select value={conditions.challengeLeverage} onChange={(e) => update({ challengeLeverage: e.target.value })} className="mt-1 h-9 w-full max-w-[200px] rounded-lg border border-border bg-surface-1 px-3 text-sm text-text">
          <option value="system_default">System default</option>
          <option value="1:100">1:100</option>
          <option value="1:200">1:200</option>
          <option value="1:500">1:500</option>
        </select>
      </div>
    </Card>
  )
}

function AddOnRow({
  title,
  description,
  enabled,
  onToggle,
  config,
}: {
  title: string
  description: string
  enabled: boolean
  onToggle: (v: boolean) => void
  config?: React.ReactNode
}) {
  return (
    <Card className={cn('p-4 rounded-lg border', enabled ? 'border-accent/30 bg-accent/5' : 'border-border bg-surface-2/40')}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-text">{title}</h4>
          <p className="text-xs text-text-muted mt-0.5">{description}</p>
          {config}
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} className="shrink-0 mt-0.5" />
      </div>
    </Card>
  )
}
