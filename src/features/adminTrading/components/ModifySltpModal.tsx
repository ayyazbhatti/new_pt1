import { useState } from 'react'
import { ModalShell } from '@/shared/ui/modal'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { useAdminTradingStore } from '../store/adminTrading.store'
import { modifyPositionSltp } from '../api/positions'
import { toast } from 'react-hot-toast'
import { Loader2 } from 'lucide-react'

export function ModifySltpModal() {
  const { openModal, setOpenModal, selectedPositionId, positions } = useAdminTradingStore()
  const position = selectedPositionId ? positions.get(selectedPositionId) : null
  const [stopLoss, setStopLoss] = useState(position?.stopLoss?.toString() || '')
  const [takeProfit, setTakeProfit] = useState(position?.takeProfit?.toString() || '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const open = openModal === 'modify-sltp'

  if (!position) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const sl = stopLoss ? parseFloat(stopLoss) : undefined
    const tp = takeProfit ? parseFloat(takeProfit) : undefined

    if (sl === undefined && tp === undefined) {
      toast.error('Please provide at least one value (Stop Loss or Take Profit)')
      return
    }

    setIsSubmitting(true)
    try {
      await modifyPositionSltp(position.id, { stopLoss: sl, takeProfit: tp })
      toast.success('SL/TP modified successfully')
      setOpenModal(null)
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to modify SL/TP')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={(open) => setOpenModal(open ? 'modify-sltp' : null)}
      title="Modify Stop Loss / Take Profit"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="stopLoss">Stop Loss</Label>
          <Input
            id="stopLoss"
            type="number"
            step="0.01"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            placeholder="Leave empty to remove"
          />
        </div>

        <div>
          <Label htmlFor="takeProfit">Take Profit</Label>
          <Input
            id="takeProfit"
            type="number"
            step="0.01"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            placeholder="Leave empty to remove"
          />
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpenModal(null)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Modify'}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

