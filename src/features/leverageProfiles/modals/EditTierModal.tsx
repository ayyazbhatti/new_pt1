import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import { LeverageTier } from '../types/leverageProfile'

const tierSchema = z
  .object({
    from: z.number().min(0, 'Margin from must be 0 or greater'),
    to: z.number().min(1, 'Margin to must be greater than 0'),
    leverage: z.number().min(1, 'Leverage must be at least 1').max(1000, 'Leverage cannot exceed 1000'),
  })
  .refine((data) => data.to > data.from, {
    message: 'Margin "To" must be greater than "From"',
    path: ['to'],
  })

type TierFormData = z.infer<typeof tierSchema>

interface EditTierModalProps {
  tier: LeverageTier
  existingTiers: LeverageTier[]
  onSave: (tier: LeverageTier) => void
}

export function EditTierModal({ tier, existingTiers, onSave }: EditTierModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TierFormData>({
    resolver: zodResolver(tierSchema),
    defaultValues: {
      from: Number((tier as { from?: number }).from ?? tier.notionalFrom ?? 0),
      to: Number((tier as { to?: number }).to ?? tier.notionalTo ?? 0),
      leverage: (tier as { leverage?: number }).leverage ?? tier.maxLeverage ?? 1,
    },
  })

  const onSubmit = (data: TierFormData) => {
    // Check for overlapping ranges (excluding current tier)
    const otherTiers = existingTiers.filter((t) => t.id !== tier.id)
    const overlaps = otherTiers.some((t) => {
      const tFrom = Number((t as { from?: number }).from ?? t.notionalFrom ?? 0)
      const tTo = Number((t as { to?: number }).to ?? t.notionalTo ?? 0)
      return (data.from >= tFrom && data.from <= tTo) || (data.to >= tFrom && data.to <= tTo) || (data.from <= tFrom && data.to >= tTo)
    })

    if (overlaps) {
      toast.error('This range overlaps with another tier')
      return
    }

    onSave({
      ...tier,
      from: data.from,
      to: data.to,
      leverage: data.leverage,
    })
    closeModal(`edit-tier-${tier.id}`)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Margin From</label>
        <Input
          type="number"
          {...register('from', { valueAsNumber: true })}
          placeholder="0"
        />
        {errors.from && <p className="mt-1 text-sm text-danger">{errors.from.message}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Margin To</label>
        <Input
          type="number"
          {...register('to', { valueAsNumber: true })}
          placeholder="10000"
        />
        {errors.to && <p className="mt-1 text-sm text-danger">{errors.to.message}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Leverage</label>
        <Input
          type="number"
          {...register('leverage', { valueAsNumber: true })}
          placeholder="500"
        />
        <p className="mt-1 text-xs text-text-muted">Maximum: 1000</p>
        {errors.leverage && (
          <p className="mt-1 text-sm text-danger">{errors.leverage.message}</p>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeModal(`edit-tier-${tier.id}`)}
        >
          Cancel
        </Button>
        <Button type="submit">Save Changes</Button>
      </div>
    </form>
  )
}

