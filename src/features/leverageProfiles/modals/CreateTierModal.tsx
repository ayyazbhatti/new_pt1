import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
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

interface CreateTierModalProps {
  existingTiers?: LeverageTier[]
  onSave?: (tier: Omit<LeverageTier, 'id'>) => void
}

export function CreateTierModal({ existingTiers = [], onSave }: CreateTierModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TierFormData>({
    resolver: zodResolver(tierSchema),
    defaultValues: {
      from: 0,
      to: 0,
      leverage: 100,
    },
  })

  const onSubmit = (data: TierFormData) => {
    // Check for overlapping ranges
    const overlaps = existingTiers.some(
      (tier) => {
        const tFrom = Number((tier as { from?: number }).from ?? tier.notionalFrom ?? 0)
        const tTo = Number((tier as { to?: number }).to ?? tier.notionalTo ?? 0)
        return (data.from >= tFrom && data.from <= tTo) || (data.to >= tFrom && data.to <= tTo) || (data.from <= tFrom && data.to >= tTo)
      }
    )

    if (overlaps) {
      toast.error('This range overlaps with an existing tier')
      return
    }

    if (onSave) {
      onSave({
        from: data.from,
        to: data.to,
        leverage: data.leverage,
      } as Omit<LeverageTier, 'id'>)
    } else {
      toast.success('Tier created successfully')
    }
    closeModal('create-tier')
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
          onClick={() => closeModal('create-tier')}
        >
          Cancel
        </Button>
        <Button type="submit">Create Tier</Button>
      </div>
    </form>
  )
}

