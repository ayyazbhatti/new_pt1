import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { MarkupProfile } from '../types/markup'
import { useUpdateMarkupProfile } from '../hooks/useMarkup'
import { Spinner } from '@/shared/ui/loading'

const profileSchema = z.object({
  name: z.string().min(1, 'Profile name is required'),
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

interface EditProfileFormProps {
  profile: MarkupProfile
}

export function EditProfileForm({ profile }: EditProfileFormProps) {
  const updateProfile = useUpdateMarkupProfile()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: profile.name,
      markup_type: 'percent',
      bid_markup: profile.bidMarkup,
      ask_markup: profile.askMarkup,
    },
  })

  const onSubmit = async (data: ProfileFormData) => {
    try {
      await updateProfile.mutateAsync({
        id: profile.id,
        payload: data,
      })
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

      {profile.description && (
        <div>
          <Label>Description</Label>
          <div className="text-sm text-text-muted bg-surface-2 p-3 rounded-lg">
            {profile.description}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface-2/50 p-3">
        <p className="text-sm text-text-muted">Markup is applied as a <strong className="text-text">percentage (%)</strong>.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Bid Markup (%) *</Label>
          <Input
            type="number"
            step="0.01"
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
            {...register('ask_markup')}
            disabled={isSubmitting}
          />
          {errors.ask_markup && (
            <p className="mt-1 text-sm text-danger">{errors.ask_markup.message}</p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner className="h-4 w-4" /> : 'Save Changes'}
        </Button>
      </div>
    </form>
  )
}

