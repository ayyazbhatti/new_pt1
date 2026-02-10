import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/Switch'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { useState, useEffect } from 'react'
import { LeverageProfile } from '../types/leverageProfile'

const profileSchema = z.object({
  name: z.string().min(1, 'Profile name is required'),
  description: z.string().min(1, 'Description is required'),
})

type ProfileFormData = z.infer<typeof profileSchema>

interface EditProfileModalProps {
  profile: LeverageProfile
}

export function EditProfileModal({ profile }: EditProfileModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [status, setStatus] = useState(profile.status === 'active')

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: profile.name,
      description: profile.description,
    },
  })

  useEffect(() => {
    setStatus(profile.status === 'active')
  }, [profile.status])

  const onSubmit = (data: ProfileFormData) => {
    toast.success(`Profile "${data.name}" updated successfully`)
    closeModal(`edit-profile-${profile.id}`)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Profile Name</label>
        <Input {...register('name')} />
        {errors.name && <p className="mt-1 text-sm text-danger">{errors.name.message}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Description</label>
        <Input {...register('description')} />
        {errors.description && (
          <p className="mt-1 text-sm text-danger">{errors.description.message}</p>
        )}
      </div>
      <div className="flex items-center justify-between py-2">
        <label className="text-sm font-medium text-text">Status</label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">{status ? 'Active' : 'Disabled'}</span>
          <Switch checked={status} onCheckedChange={setStatus} />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeModal(`edit-profile-${profile.id}`)}
        >
          Cancel
        </Button>
        <Button type="submit">Save Changes</Button>
      </div>
    </form>
  )
}

