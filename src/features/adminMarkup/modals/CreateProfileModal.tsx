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
})

type ProfileFormData = z.infer<typeof profileSchema>

export function CreateProfileModal() {
  const closeModal = useModalStore((state) => state.closeModal)
  const createProfile = useCreateMarkupProfile()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: '',
      description: '',
    },
  })

  const onSubmit = async (data: ProfileFormData) => {
    try {
      await createProfile.mutateAsync({
        name: data.name,
        description: data.description ?? null,
        markup_type: 'percent',
        bid_markup: '0',
        ask_markup: '0',
      })
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

      <p className="text-sm text-text-muted">
        After creating the profile, set bid/ask markup per symbol in the profile&apos;s symbol overrides.
      </p>

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

