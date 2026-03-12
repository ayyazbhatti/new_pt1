import { useState, useEffect } from 'react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'

export interface RewardSettings {
  profitSplit: number
  payoutFrequency: string
  firstPayoutAfterDays: number
  minPayout: number
  maxPayoutPerRequest: number
}

interface EditRewardSettingsModalProps {
  settings: RewardSettings
  onSave: (settings: RewardSettings) => void
  modalKey: string
}

const FREQUENCY_OPTIONS = ['Weekly', 'Bi-weekly', 'Monthly']

export function EditRewardSettingsModal({ settings, onSave, modalKey }: EditRewardSettingsModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [profitSplit, setProfitSplit] = useState(settings.profitSplit.toString())
  const [payoutFrequency, setPayoutFrequency] = useState(settings.payoutFrequency)
  const [firstPayoutAfterDays, setFirstPayoutAfterDays] = useState(settings.firstPayoutAfterDays.toString())
  const [minPayout, setMinPayout] = useState(settings.minPayout.toString())
  const [maxPayoutPerRequest, setMaxPayoutPerRequest] = useState(settings.maxPayoutPerRequest.toString())
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setProfitSplit(settings.profitSplit.toString())
    setPayoutFrequency(settings.payoutFrequency)
    setFirstPayoutAfterDays(settings.firstPayoutAfterDays.toString())
    setMinPayout(settings.minPayout.toString())
    setMaxPayoutPerRequest(settings.maxPayoutPerRequest.toString())
  }, [settings])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const ps = parseInt(profitSplit, 10)
    const fp = parseInt(firstPayoutAfterDays, 10)
    const min = parseFloat(minPayout)
    const max = parseFloat(maxPayoutPerRequest)
    if (isNaN(ps) || ps < 0 || ps > 100) {
      toast.error('Profit split must be between 0 and 100.')
      return
    }
    if (isNaN(fp) || fp < 0) {
      toast.error('First payout after days must be 0 or greater.')
      return
    }
    if (isNaN(min) || min < 0) {
      toast.error('Min payout must be 0 or greater.')
      return
    }
    if (isNaN(max) || max < 0) {
      toast.error('Max payout per request must be 0 or greater.')
      return
    }
    if (min > max) {
      toast.error('Min payout cannot exceed max payout.')
      return
    }
    setIsSubmitting(true)
    try {
      onSave({
        profitSplit: ps,
        payoutFrequency,
        firstPayoutAfterDays: fp,
        minPayout: min,
        maxPayoutPerRequest: max,
      })
      toast.success('Reward settings updated.')
      closeModal(modalKey)
    } catch {
      // parent
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="reward-split">Profit split (trader %) *</Label>
        <Input
          id="reward-split"
          type="number"
          min={0}
          max={100}
          value={profitSplit}
          onChange={(e) => setProfitSplit(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="reward-freq">Payout frequency</Label>
        <select
          id="reward-freq"
          value={payoutFrequency}
          onChange={(e) => setPayoutFrequency(e.target.value)}
          className="mt-1 flex h-10 w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
        >
          {FREQUENCY_OPTIONS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="reward-firstdays">First payout after (days)</Label>
        <Input
          id="reward-firstdays"
          type="number"
          min={0}
          value={firstPayoutAfterDays}
          onChange={(e) => setFirstPayoutAfterDays(e.target.value)}
          className="mt-1"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="reward-min">Min payout ($)</Label>
          <Input
            id="reward-min"
            type="number"
            min={0}
            step={0.01}
            value={minPayout}
            onChange={(e) => setMinPayout(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="reward-max">Max payout per request ($)</Label>
          <Input
            id="reward-max"
            type="number"
            min={0}
            step={0.01}
            value={maxPayoutPerRequest}
            onChange={(e) => setMaxPayoutPerRequest(e.target.value)}
            className="mt-1"
          />
        </div>
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
