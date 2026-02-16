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
    },
  })

  const onSubmit = async (data: ProfileFormData) => {
    try {
      await updateProfile.mutateAsync({
        id: profile.id,
        payload: {
          name: data.name,
          markup_type: 'percent',
          bid_markup: '0',
          ask_markup: '0',
        },
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

      <p className="text-sm text-text-muted">Set bid/ask markup per symbol in the Symbol Markups view.</p>

      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner className="h-4 w-4" /> : 'Save Changes'}
        </Button>
      </div>
    </form>
  )
}

