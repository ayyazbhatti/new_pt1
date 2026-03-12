import { useState, useEffect } from 'react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'

export interface PhaseConfig {
  profitTarget: number
  calendarDays: number
  minTradingDays: number
  dailyLossLimit: number
  maxDrawdown: number
}

interface EditPhaseModalProps {
  phase: 1 | 2
  config: PhaseConfig
  onSave: (config: PhaseConfig) => void
  modalKey: string
}

export function EditPhaseModal({ phase, config, onSave, modalKey }: EditPhaseModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [profitTarget, setProfitTarget] = useState(config.profitTarget.toString())
  const [calendarDays, setCalendarDays] = useState(config.calendarDays.toString())
  const [minTradingDays, setMinTradingDays] = useState(config.minTradingDays.toString())
  const [dailyLossLimit, setDailyLossLimit] = useState(config.dailyLossLimit.toString())
  const [maxDrawdown, setMaxDrawdown] = useState(config.maxDrawdown.toString())
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setProfitTarget(config.profitTarget.toString())
    setCalendarDays(config.calendarDays.toString())
    setMinTradingDays(config.minTradingDays.toString())
    setDailyLossLimit(config.dailyLossLimit.toString())
    setMaxDrawdown(config.maxDrawdown.toString())
  }, [config])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const pt = parseFloat(profitTarget)
    const cd = parseInt(calendarDays, 10)
    const mtd = parseInt(minTradingDays, 10)
    const dll = parseFloat(dailyLossLimit)
    const md = parseFloat(maxDrawdown)
    if (isNaN(pt) || pt <= 0 || pt > 100) {
      toast.error('Profit target must be between 1 and 100.')
      return
    }
    if (isNaN(cd) || cd <= 0) {
      toast.error('Calendar days must be a positive number.')
      return
    }
    if (isNaN(mtd) || mtd < 0) {
      toast.error('Min trading days must be 0 or greater.')
      return
    }
    if (isNaN(dll) || dll <= 0 || dll > 100) {
      toast.error('Daily loss limit must be between 1 and 100.')
      return
    }
    if (isNaN(md) || md <= 0 || md > 100) {
      toast.error('Max drawdown must be between 1 and 100.')
      return
    }
    setIsSubmitting(true)
    try {
      onSave({
        profitTarget: pt,
        calendarDays: cd,
        minTradingDays: mtd,
        dailyLossLimit: dll,
        maxDrawdown: md,
      })
      toast.success(`Phase ${phase} updated.`)
      closeModal(modalKey)
    } catch {
      // parent
    } finally {
      setIsSubmitting(false)
    }
  }

  const label = phase === 1 ? 'Phase 1 (Challenge)' : 'Phase 2 (Verification)'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">{label}</p>
      <div>
        <Label htmlFor="phase-profit">Profit target (%) *</Label>
        <Input
          id="phase-profit"
          type="number"
          min={1}
          max={100}
          step={0.5}
          value={profitTarget}
          onChange={(e) => setProfitTarget(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="phase-calendar">Calendar days *</Label>
        <Input
          id="phase-calendar"
          type="number"
          min={1}
          value={calendarDays}
          onChange={(e) => setCalendarDays(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="phase-mintrading">Min trading days</Label>
        <Input
          id="phase-mintrading"
          type="number"
          min={0}
          value={minTradingDays}
          onChange={(e) => setMinTradingDays(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="phase-daily">Daily loss limit (%) *</Label>
        <Input
          id="phase-daily"
          type="number"
          min={1}
          max={100}
          step={0.5}
          value={dailyLossLimit}
          onChange={(e) => setDailyLossLimit(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="phase-drawdown">Max drawdown (%) *</Label>
        <Input
          id="phase-drawdown"
          type="number"
          min={1}
          max={100}
          step={0.5}
          value={maxDrawdown}
          onChange={(e) => setMaxDrawdown(e.target.value)}
          className="mt-1"
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => closeModal(modalKey)}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
