import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { Card } from '@/shared/ui/card'

const leverageSchema = z.object({
  userId: z.string().min(1, 'User is required'),
  minLeverage: z.number().min(1, 'Min leverage must be at least 1'),
  maxLeverage: z.number().min(1, 'Max leverage must be at least 1'),
  reason: z.string().optional(),
})

type LeverageFormData = z.infer<typeof leverageSchema>

export function UserLeverageLimitsModal() {
  const closeModal = useModalStore((state) => state.closeModal)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<LeverageFormData>({
    resolver: zodResolver(leverageSchema),
    defaultValues: {
      userId: '',
      minLeverage: 1,
      maxLeverage: 500,
      reason: '',
    },
  })

  const userId = watch('userId')

  const onSubmit = (_data: LeverageFormData) => {
    toast.success('User leverage limits updated successfully')
    closeModal('user-leverage-limits')
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Select User</label>
        <Select value={userId} onValueChange={(value) => setValue('userId', value)}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a user" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">John Doe</SelectItem>
            <SelectItem value="2">Jane Smith</SelectItem>
            <SelectItem value="3">Bob Wilson</SelectItem>
          </SelectContent>
        </Select>
        {errors.userId && <p className="mt-1 text-sm text-danger">{errors.userId.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Min Leverage</label>
          <Input
            type="number"
            {...register('minLeverage', { valueAsNumber: true })}
          />
          {errors.minLeverage && (
            <p className="mt-1 text-sm text-danger">{errors.minLeverage.message}</p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Max Leverage</label>
          <Input
            type="number"
            {...register('maxLeverage', { valueAsNumber: true })}
          />
          {errors.maxLeverage && (
            <p className="mt-1 text-sm text-danger">{errors.maxLeverage.message}</p>
          )}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Reason (Optional)</label>
        <Input {...register('reason')} placeholder="Reason for override" />
      </div>
      <Card className="p-4 bg-surface-2">
        <p className="text-sm text-text-muted">
          This will override the global leverage limits for the selected user. Changes take effect immediately.
        </p>
      </Card>
      <div className="flex justify-end gap-2 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeModal('user-leverage-limits')}
        >
          Cancel
        </Button>
        <Button type="submit">Save Limits</Button>
      </div>
    </form>
  )
}

