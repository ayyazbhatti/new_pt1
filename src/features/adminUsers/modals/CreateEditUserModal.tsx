import { useState, useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { User, UserStatus } from '../types/users'
import { useGroupsList } from '@/features/groups/hooks/useGroups'
import { updateUserGroup } from '../api/users.api'
import type { UserResponse } from '@/shared/api/users.api'

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
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fetch groups dynamically - fetch all groups to include disabled ones when editing
  const { data: groupsData, isLoading: groupsLoading } = useGroupsList({
    page_size: 100, // Get a reasonable number of groups
  })

  // Subscribe to users list so we get latest cache (e.g. after optimistic group update)
  const { data: usersList } = useQuery({ queryKey: ['users'] })
  // When editing, prefer user from cache so re-opened modal shows latest group
  const displayUser = useMemo(() => {
    if (!user) return null
    const found = (usersList as UserResponse[] | undefined)?.find((u) => u.id === user.id)
    if (!found) return user
    return {
      ...user,
      group: found.group_id || '',
      groupName: found.group_name || user.groupName,
    }
  }, [user, usersList])

  const nameParts = displayUser?.name?.split(' ') || user?.name?.split(' ') || ['', '']
  const firstName = nameParts[0] || ''
  const lastName = nameParts.slice(1).join(' ') || ''

  const formUser = displayUser ?? user
  const defaultGroup = formUser?.group || ''
  const defaultStatus = (formUser?.status === 'suspended' ? 'disabled' : formUser?.status) || 'active'

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      firstName,
      lastName,
      email: formUser?.email || '',
      phone: formUser?.phone || '',
      country: formUser?.country || '',
      group: defaultGroup,
      status: defaultStatus,
    },
  })

  // When modal re-opens with updated user (e.g. after group save), reset form to show latest
  useEffect(() => {
    if (!formUser) return
    reset({
      firstName,
      lastName,
      email: formUser.email || '',
      phone: formUser.phone || '',
      country: formUser.country || '',
      group: defaultGroup,
      status: defaultStatus,
    })
  }, [formUser?.id, defaultGroup, defaultStatus, reset, firstName, lastName, formUser?.email, formUser?.phone, formUser?.country])

  const group = watch('group')
  const groups = groupsData?.items || []

  const onSubmit = async (data: UserFormData) => {
    if (user) {
      setIsSubmitting(true)
      try {
        await updateUserGroup(user.id, { group_id: data.group })
        const groupName = groups.find((g) => g.id === data.group)?.name ?? ''
        // Optimistic update: write new group into cache so list and re-opened modal show it immediately
        queryClient.setQueryData<UserResponse[]>(['users'], (old) => {
          if (!old) return old
          return old.map((u) =>
            u.id === user.id ? { ...u, group_id: data.group, group_name: groupName } : u
          )
        })
        await queryClient.invalidateQueries({ queryKey: ['users'] })
        toast.success(`User ${data.firstName} ${data.lastName} updated`)
        closeModal(`edit-user-${user.id}`)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update user'
        toast.error(message)
      } finally {
        setIsSubmitting(false)
      }
    } else {
      toast.success(`User ${data.firstName} ${data.lastName} created`)
      closeModal('create-user')
    }
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
        <Button type="submit" disabled={isSubmitting}>{user ? (isSubmitting ? 'Saving...' : 'Save Changes') : 'Create User'}</Button>
      </div>
    </form>
  )
}

