import { useState } from 'react'
import { ModalShell } from '@/shared/ui/modal'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useAdminTradingStore } from '../store/adminTrading.store'
import { closeAdminPosition } from '../api/positions'
import { toast } from '@/shared/components/common'
import { Loader2 } from 'lucide-react'

export function ClosePositionModal() {
  const { openModal, setOpenModal, selectedPositionId, positions, removePosition } =
    useAdminTradingStore()
  const position = selectedPositionId ? positions.get(selectedPositionId) : null
  const [closeType, setCloseType] = useState<'full' | 'partial'>('full')
  const [partialSize, setPartialSize] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const open = openModal === 'close-position'

  if (!position) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (closeType === 'partial') {
      const size = parseFloat(partialSize)
      if (isNaN(size) || size <= 0 || size > position.size) {
        toast.error('Invalid size. Must be greater than 0 and less than or equal to position size.')
        return
      }
    }

    setIsSubmitting(true)
    try {
      if (closeType === 'partial') {
        await closeAdminPosition(position.id, { size: parseFloat(partialSize) })
      } else {
        await closeAdminPosition(position.id)
      }
      toast.success(`Position ${closeType === 'full' ? 'closed' : 'partially closed'} successfully`)
      if (closeType === 'full') {
        removePosition(position.id)
      }
      setOpenModal(null)
      setCloseType('full')
      setPartialSize('')
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to close position')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={(open) => setOpenModal(open ? 'close-position' : null)}
      title="Close Position"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label>Close Type</Label>
          <Select value={closeType} onValueChange={(v) => setCloseType(v as 'full' | 'partial')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full">Full Close ({position.size.toLocaleString()})</SelectItem>
              <SelectItem value="partial">Partial Close</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {closeType === 'partial' && (
          <div>
            <Label htmlFor="partialSize">Size to Close</Label>
            <Input
              id="partialSize"
              type="number"
              step="0.000001"
              min="0"
              max={position.size}
              value={partialSize}
              onChange={(e) => setPartialSize(e.target.value)}
              placeholder={`Max: ${position.size.toLocaleString()}`}
              required
            />
          </div>
        )}

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
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Close Position'}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

