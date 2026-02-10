import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/Switch'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { useState } from 'react'

const profileSchema = z.object({
  name: z.string().min(1, 'Profile name is required'),
  description: z.string().min(1, 'Description is required'),
})

type ProfileFormData = z.infer<typeof profileSchema>

export function CreateProfileModal() {
  const closeModal = useModalStore((state) => state.closeModal)
  const [status, setStatus] = useState(true)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: '',
      description: '',
    },
  })

  const onSubmit = (data: ProfileFormData) => {
    toast.success(`Profile "${data.name}" created successfully`)
    closeModal('create-profile')
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Profile Name</label>
        <Input {...register('name')} placeholder="e.g., Standard Profile" />
        {errors.name && <p className="mt-1 text-sm text-danger">{errors.name.message}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Description</label>
        <Input {...register('description')} placeholder="Brief description of the profile" />
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
          onClick={() => closeModal('create-profile')}
        >
          Cancel
        </Button>
        <Button type="submit">Create Profile</Button>
      </div>
    </form>
  )
}

