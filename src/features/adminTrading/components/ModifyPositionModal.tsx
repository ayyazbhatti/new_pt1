import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ModalShell } from '@/shared/ui/modal'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { useAdminTradingStore } from '../store/adminTrading.store'
import { updateAdminPositionParams } from '../api/positions'
import { toast } from '@/shared/components/common'

export function ModifyPositionModal() {
  const { openModal, setOpenModal, selectedPositionId, positions } = useAdminTradingStore()
  const position = selectedPositionId ? positions.get(selectedPositionId) : null
  const open = openModal === 'modify-position'

  const [size, setSize] = useState(0)
  const [entryPrice, setEntryPrice] = useState(0)
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open || !position) return
    setSize(position.size)
    setEntryPrice(position.entryPrice)
    setStopLoss(position.stopLoss != null ? String(position.stopLoss) : '')
    setTakeProfit(position.takeProfit != null ? String(position.takeProfit) : '')
  }, [open, position])

  if (!position) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (size <= 0) {
      toast.error('Size must be greater than 0')
      return
    }
    if (entryPrice <= 0) {
      toast.error('Entry price must be greater than 0')
      return
    }

    const sl = stopLoss.trim() ? parseFloat(stopLoss) : undefined
    const tp = takeProfit.trim() ? parseFloat(takeProfit) : undefined

    setIsSubmitting(true)
    try {
      await updateAdminPositionParams(position.id, {
        size,
        entryPrice,
        stopLoss: sl,
        takeProfit: tp,
      })
      toast.success('Position updated')
      setOpenModal(null)
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to update position')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => setOpenModal(next ? 'modify-position' : null)}
      title="Modify position"
      description="Update size, entry price, stop loss, or take profit for this open position."
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label className="text-text-muted">Symbol</Label>
          <div className="mt-1 flex h-10 items-center rounded-lg border border-border bg-surface-2 px-3 font-mono text-sm text-text">
            {position.symbol}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="modify-position-size">Size *</Label>
            <Input
              id="modify-position-size"
              type="number"
              step="0.000001"
              min={0}
              value={size || ''}
              onChange={(e) => setSize(parseFloat(e.target.value) || 0)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="modify-position-entry">Entry price *</Label>
            <Input
              id="modify-position-entry"
              type="number"
              step="0.01"
              min={0}
              value={entryPrice || ''}
              onChange={(e) => setEntryPrice(parseFloat(e.target.value) || 0)}
              className="mt-1"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="modify-position-sl">Stop loss (optional)</Label>
            <Input
              id="modify-position-sl"
              type="number"
              step="0.01"
              placeholder="Price"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="modify-position-tp">Take profit (optional)</Label>
            <Input
              id="modify-position-tp"
              type="number"
              step="0.01"
              placeholder="Price"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => setOpenModal(null)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}
