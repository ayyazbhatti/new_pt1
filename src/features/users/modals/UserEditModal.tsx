import { User } from '../types/user'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'

const userSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  role: z.string().min(1, 'Role is required'),
  status: z.enum(['active', 'inactive', 'suspended']),
})

type UserFormData = z.infer<typeof userSchema>

interface UserEditModalProps {
  user: User
}

export function UserEditModal({ user }: UserEditModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    },
  })

  const status = watch('status')

  const onSubmit = (_data: UserFormData) => {
    // Static UI - just show toast
    toast.success('User updated successfully')
    closeModal(`user-edit-${user.id}`)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Name</label>
        <Input {...register('name')} />
        {errors.name && <p className="mt-1 text-sm text-danger">{errors.name.message}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Email</label>
        <Input type="email" {...register('email')} />
        {errors.email && <p className="mt-1 text-sm text-danger">{errors.email.message}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Role</label>
        <Input {...register('role')} />
        {errors.role && <p className="mt-1 text-sm text-danger">{errors.role.message}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Status</label>
        <Select value={status} onValueChange={(value) => setValue('status', value as User['status'])}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
        {errors.status && <p className="mt-1 text-sm text-danger">{errors.status.message}</p>}
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeModal(`user-edit-${user.id}`)}
        >
          Cancel
        </Button>
        <Button type="submit">Save Changes</Button>
      </div>
    </form>
  )
}

