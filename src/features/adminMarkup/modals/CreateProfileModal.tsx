import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { useModalStore } from '@/app/store'
import { useCreateMarkupProfile } from '../hooks/useMarkup'
import { Spinner } from '@/shared/ui/loading'

const profileSchema = z.object({
  name: z.string().min(1, 'Profile name is required'),
  description: z.string().optional(),
  markup_type: z.literal('percent'),
  bid_markup: z.string().refine((val) => {
    const num = parseFloat(val)
    return !isNaN(num)
  }, 'Bid markup must be a number'),
  ask_markup: z.string().refine((val) => {
    const num = parseFloat(val)
    return !isNaN(num)
  }, 'Ask markup must be a number'),
})

type ProfileFormData = z.infer<typeof profileSchema>

export function CreateProfileModal() {
  const closeModal = useModalStore((state) => state.closeModal)
  const createProfile = useCreateMarkupProfile()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: '',
      description: '',
      markup_type: 'percent',
      bid_markup: '0',
      ask_markup: '0',
    },
  })

  const onSubmit = async (data: ProfileFormData) => {
    try {
      await createProfile.mutateAsync(data)
      closeModal('create-profile')
    } catch (error) {
      // Error handled by hook
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label>Profile Name *</Label>
        <Input {...register('name')} disabled={isSubmitting} />
        {errors.name && <p className="mt-1 text-sm text-danger">{errors.name.message}</p>}
      </div>

      <div>
        <Label>Description</Label>
        <textarea
          {...register('description')}
          className="flex min-h-[80px] w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Describe this pricing profile..."
          disabled={isSubmitting}
        />
      </div>

      <div className="rounded-lg border border-border bg-surface-2/50 p-3">
        <p className="text-sm text-text-muted">Markup is applied as a <strong className="text-text">percentage (%)</strong> of the price.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Bid Markup (%) *</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="0"
            {...register('bid_markup')}
            disabled={isSubmitting}
          />
          {errors.bid_markup && (
            <p className="mt-1 text-sm text-danger">{errors.bid_markup.message}</p>
          )}
        </div>
        <div>
          <Label>Ask Markup (%) *</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="0"
            {...register('ask_markup')}
            disabled={isSubmitting}
          />
          {errors.ask_markup && (
            <p className="mt-1 text-sm text-danger">{errors.ask_markup.message}</p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeModal('create-profile')}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner className="h-4 w-4" /> : 'Create Profile'}
        </Button>
      </div>
    </form>
  )
}

