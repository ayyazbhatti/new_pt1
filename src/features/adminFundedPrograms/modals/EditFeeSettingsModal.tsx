import { useState, useEffect } from 'react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { useModalStore } from '@/app/store'
import { Switch } from '@/shared/ui/Switch'
import { toast } from '@/shared/components/common'

export interface FeeSettings {
  firstChallengeDiscount: number
  freeRetry: boolean
  refundOnFirstPayout: boolean
  subscription: boolean
}

interface EditFeeSettingsModalProps {
  settings: FeeSettings
  onSave: (settings: FeeSettings) => void
  modalKey: string
}

export function EditFeeSettingsModal({ settings, onSave, modalKey }: EditFeeSettingsModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [firstChallengeDiscount, setFirstChallengeDiscount] = useState(settings.firstChallengeDiscount.toString())
  const [freeRetry, setFreeRetry] = useState(settings.freeRetry)
  const [refundOnFirstPayout, setRefundOnFirstPayout] = useState(settings.refundOnFirstPayout)
  const [subscription, setSubscription] = useState(settings.subscription)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setFirstChallengeDiscount(settings.firstChallengeDiscount.toString())
    setFreeRetry(settings.freeRetry)
    setRefundOnFirstPayout(settings.refundOnFirstPayout)
    setSubscription(settings.subscription)
  }, [settings])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const discount = parseInt(firstChallengeDiscount, 10)
    if (isNaN(discount) || discount < 0 || discount > 100) {
      toast.error('First challenge discount must be between 0 and 100.')
      return
    }
    setIsSubmitting(true)
    try {
      onSave({
        firstChallengeDiscount: discount,
        freeRetry,
        refundOnFirstPayout,
        subscription,
      })
      toast.success('Fee settings updated.')
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
        <Label htmlFor="fee-discount">First challenge discount (%)</Label>
        <Input
          id="fee-discount"
          type="number"
          min={0}
          max={100}
          value={firstChallengeDiscount}
          onChange={(e) => setFirstChallengeDiscount(e.target.value)}
          className="mt-1"
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2">
        <Label htmlFor="fee-retry" className="mb-0">Free retry</Label>
        <Switch id="fee-retry" checked={freeRetry} onCheckedChange={setFreeRetry} />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2">
        <Label htmlFor="fee-refund" className="mb-0">Refund on first payout</Label>
        <Switch id="fee-refund" checked={refundOnFirstPayout} onCheckedChange={setRefundOnFirstPayout} />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2">
        <Label htmlFor="fee-sub" className="mb-0">Subscription option</Label>
        <Switch id="fee-sub" checked={subscription} onCheckedChange={setSubscription} />
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
