import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { User, UserStatus } from '../types/users'
import { useGroupsList } from '@/features/groups/hooks/useGroups'

const userSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  country: z.string().min(1, 'Country is required'),
  group: z.string().min(1, 'Group is required'),
  status: z.enum(['active', 'disabled']),
})

type UserFormData = z.infer<typeof userSchema>

interface CreateEditUserModalProps {
  user?: User
}

export function CreateEditUserModal({ user }: CreateEditUserModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)

  // Fetch groups dynamically - fetch all groups to include disabled ones when editing
  const { data: groupsData, isLoading: groupsLoading } = useGroupsList({
    page_size: 100, // Get a reasonable number of groups
  })

  const nameParts = user?.name.split(' ') || ['', '']
  const firstName = nameParts[0] || ''
  const lastName = nameParts.slice(1).join(' ') || ''

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      firstName: firstName,
      lastName: lastName,
      email: user?.email || '',
      phone: user?.phone || '',
      country: user?.country || '',
      group: user?.group || '',
      status: (user?.status === 'suspended' ? 'disabled' : user?.status) || 'active',
    },
  })

  const group = watch('group')
  const groups = groupsData?.items || []

  const onSubmit = (data: UserFormData) => {
    if (user) {
      toast.success(`User ${data.firstName} ${data.lastName} updated`)
    } else {
      toast.success(`User ${data.firstName} ${data.lastName} created`)
    }
    closeModal(user ? `edit-user-${user.id}` : 'create-user')
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-text mb-2 block">First Name *</label>
          <Input {...register('firstName')} />
          {errors.firstName && (
            <p className="mt-1 text-sm text-danger">{errors.firstName.message}</p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Last Name *</label>
          <Input {...register('lastName')} />
          {errors.lastName && (
            <p className="mt-1 text-sm text-danger">{errors.lastName.message}</p>
          )}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Email *</label>
        <Input type="email" {...register('email')} />
        {errors.email && <p className="mt-1 text-sm text-danger">{errors.email.message}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Phone</label>
        <Input type="tel" {...register('phone')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Country *</label>
          <Input {...register('country')} placeholder="US" />
          {errors.country && <p className="mt-1 text-sm text-danger">{errors.country.message}</p>}
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Group *</label>
          <Select 
            value={group} 
            onValueChange={(value) => setValue('group', value)}
            disabled={groupsLoading}
          >
            <SelectTrigger>
              <SelectValue placeholder={groupsLoading ? "Loading groups..." : "Select group"} />
            </SelectTrigger>
            <SelectContent>
              {groups.length === 0 && !groupsLoading && (
                <SelectItem value="no-groups" disabled>No groups available</SelectItem>
              )}
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.group && <p className="mt-1 text-sm text-danger">{errors.group.message}</p>}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Initial Status *</label>
        <Select
          value={watch('status')}
          onValueChange={(value) => setValue('status', value as UserStatus)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeModal(user ? `edit-user-${user.id}` : 'create-user')}
        >
          Cancel
        </Button>
        <Button type="submit">{user ? 'Save Changes' : 'Create User'}</Button>
      </div>
    </form>
  )
}

