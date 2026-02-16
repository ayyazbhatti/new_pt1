import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { ModalShell } from '@/shared/ui/modal'
import { LeverageTier, CreateLeverageTierPayload, UpdateLeverageTierPayload } from '../types/leverageProfile'
import { useCreateLeverageTier, useUpdateLeverageTier } from '../hooks/useLeverageProfiles'
import { Spinner } from '@/shared/ui/loading'
import { Label } from '@/shared/ui/label'

const tierSchema = z.object({
  tier_index: z.number().min(1, 'Tier index must be >= 1'),
  notional_from: z.string().refine((val) => {
    const num = parseFloat(val)
    return !isNaN(num) && num >= 0
  }, 'Notional from must be a valid number >= 0'),
  notional_to: z.string().optional().nullable().refine(
    (val) => {
      if (!val || val === '') return true
      const num = parseFloat(val)
      return !isNaN(num)
    },
    'Notional to must be a valid number'
  ),
  max_leverage: z.number().min(1, 'Max leverage must be >= 1'),
  initial_margin_percent: z.string().refine((val) => {
    const num = parseFloat(val)
    return !isNaN(num) && num >= 0
  }, 'Initial margin percent must be a valid number >= 0'),
  maintenance_margin_percent: z.string().refine((val) => {
    const num = parseFloat(val)
    return !isNaN(num) && num >= 0
  }, 'Maintenance margin percent must be a valid number >= 0'),
}).refine(
  (data) => {
    if (!data.notional_to || data.notional_to === '') return true
    const from = parseFloat(data.notional_from)
    const to = parseFloat(data.notional_to)
    return to > from
  },
  {
    message: 'Notional to must be > notional from',
    path: ['notional_to'],
  }
)

type TierFormData = z.infer<typeof tierSchema>

interface TierFormDialogProps {
  mode: 'create' | 'edit'
  profileId: string
  initial?: LeverageTier
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TierFormDialog({ mode, profileId, initial, open, onOpenChange }: TierFormDialogProps) {
  const createTier = useCreateLeverageTier()
  const updateTier = useUpdateLeverageTier()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<TierFormData>({
    resolver: zodResolver(tierSchema),
    defaultValues: initial
      ? {
          tier_index: initial.tierIndex,
          notional_from: initial.notionalFrom,
          notional_to: initial.notionalTo || '',
          max_leverage: initial.maxLeverage,
          initial_margin_percent: initial.initialMarginPercent,
          maintenance_margin_percent: initial.maintenanceMarginPercent,
        }
      : {
          tier_index: 1,
          notional_from: '0',
          notional_to: '',
          max_leverage: 500,
          initial_margin_percent: '0.2',
          maintenance_margin_percent: '0.1',
        },
  })

  const onSubmit = async (data: TierFormData) => {
    try {
      const payload: CreateLeverageTierPayload | UpdateLeverageTierPayload = {
        tier_index: data.tier_index,
        notional_from: data.notional_from,
        notional_to: data.notional_to && data.notional_to !== '' ? data.notional_to : null,
        max_leverage: data.max_leverage,
        initial_margin_percent: data.initial_margin_percent,
        maintenance_margin_percent: data.maintenance_margin_percent,
      }

      if (mode === 'create') {
        await createTier.mutateAsync({ profileId, payload: payload as CreateLeverageTierPayload })
      } else if (initial) {
        await updateTier.mutateAsync({ profileId, tierId: initial.id, payload })
      }

      onOpenChange(false)
      reset()
    } catch (error) {
      // Error is handled by the mutation hook - keep modal open if TIER_OVERLAP
    }
  }

  const isLoading = isSubmitting || createTier.isPending || updateTier.isPending

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'create' ? 'Add tier' : 'Edit tier'}
      description={mode === 'create' ? 'Set exposure (notional) range and max leverage — e.g. 0 to 1000 → 10×' : 'Update tier settings'}
      size="md"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="tier_index">Tier index *</Label>
          <Input
            id="tier_index"
            type="number"
            {...register('tier_index', { valueAsNumber: true })}
            disabled={isLoading}
          />
          {errors.tier_index && <p className="text-sm text-danger">{errors.tier_index.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="notional_from">Exposure range from *</Label>
            <Input
              id="notional_from"
              type="text"
              {...register('notional_from')}
              placeholder="0"
              disabled={isLoading}
            />
            {errors.notional_from && <p className="text-sm text-danger">{errors.notional_from.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notional_to">Exposure range to (empty = ∞)</Label>
            <Input
              id="notional_to"
              type="text"
              {...register('notional_to')}
              placeholder="10000"
              disabled={isLoading}
            />
            {errors.notional_to && <p className="text-sm text-danger">{errors.notional_to.message}</p>}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="max_leverage">Max leverage (e.g. 10 for 10×) *</Label>
          <Input
            id="max_leverage"
            type="number"
            {...register('max_leverage', { valueAsNumber: true })}
            disabled={isLoading}
          />
          {errors.max_leverage && <p className="text-sm text-danger">{errors.max_leverage.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="initial_margin_percent">Initial Margin % *</Label>
            <Input
              id="initial_margin_percent"
              type="text"
              {...register('initial_margin_percent')}
              placeholder="0.2"
              disabled={isLoading}
            />
            {errors.initial_margin_percent && (
              <p className="text-sm text-danger">{errors.initial_margin_percent.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="maintenance_margin_percent">Maintenance Margin % *</Label>
            <Input
              id="maintenance_margin_percent"
              type="text"
              {...register('maintenance_margin_percent')}
              placeholder="0.1"
              disabled={isLoading}
            />
            {errors.maintenance_margin_percent && (
              <p className="text-sm text-danger">{errors.maintenance_margin_percent.message}</p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                {mode === 'create' ? 'Creating...' : 'Saving...'}
              </>
            ) : (
              mode === 'create' ? 'Create' : 'Save'
            )}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

