import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'

const riskLimitsSchema = z.object({
  maxExposure: z.number().min(0, 'Max exposure must be positive'),
  warningThreshold: z.number().min(0).max(100, 'Warning threshold must be between 0-100'),
  criticalThreshold: z.number().min(0).max(100, 'Critical threshold must be between 0-100'),
})

type RiskLimitsFormData = z.infer<typeof riskLimitsSchema>

export function RiskLimitsModal() {
  const closeModal = useModalStore((state) => state.closeModal)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RiskLimitsFormData>({
    resolver: zodResolver(riskLimitsSchema),
    defaultValues: {
      maxExposure: 10000000,
      warningThreshold: 75,
      criticalThreshold: 90,
    },
  })

  const onSubmit = (_data: RiskLimitsFormData) => {
    toast.success('Risk limits updated successfully')
    closeModal('risk-limits')
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Max Total Exposure ($)</label>
        <Input
          type="number"
          {...register('maxExposure', { valueAsNumber: true })}
        />
        {errors.maxExposure && (
          <p className="mt-1 text-sm text-danger">{errors.maxExposure.message}</p>
        )}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Warning Threshold (%)</label>
        <Input
          type="number"
          {...register('warningThreshold', { valueAsNumber: true })}
        />
        {errors.warningThreshold && (
          <p className="mt-1 text-sm text-danger">{errors.warningThreshold.message}</p>
        )}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Critical Threshold (%)</label>
        <Input
          type="number"
          {...register('criticalThreshold', { valueAsNumber: true })}
        />
        {errors.criticalThreshold && (
          <p className="mt-1 text-sm text-danger">{errors.criticalThreshold.message}</p>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeModal('risk-limits')}
        >
          Cancel
        </Button>
        <Button type="submit">Save Limits</Button>
      </div>
    </form>
  )
}

