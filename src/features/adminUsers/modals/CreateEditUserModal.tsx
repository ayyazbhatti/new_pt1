import { useState, useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useModalStore } from '@/app/store'
import { useAuthStore } from '@/shared/store/auth.store'
import { toast } from '@/shared/components/common'
import { User, UserStatus } from '../types/users'
import { useGroupsList } from '@/features/groups/hooks/useGroups'
import { updateUserProfile, updateUserGroup, updateUserPermissionProfile, updateUserRole } from '../api/users.api'
import { listUsers, type UserResponse, type ListUsersResponse } from '@/shared/api/users.api'
import { listPermissionProfiles } from '@/features/permissions/api/permissionProfiles.api'

const userSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  country: z.string().min(1, 'Country is required'),
  group: z.string().min(1, 'Group is required'),
  status: z.enum(['active', 'disabled']),
  minLeverage: z.number().min(1, 'Min leverage must be at least 1').max(1000, 'Min leverage must be at most 1000'),
  maxLeverage: z.number().min(1, 'Max leverage must be at least 1').max(1000, 'Max leverage must be at most 1000'),
  permissionProfile: z.string().optional(),
}).refine((data) => data.minLeverage <= data.maxLeverage, {
  message: 'Min leverage must be less than or equal to max leverage',
  path: ['maxLeverage'],
})

type UserFormData = z.infer<typeof userSchema>

interface CreateEditUserModalProps {
  user?: User
  /** Called after successful save so the table can update immediately without refetch */
  onUserUpdate?: (userId: string, updates: Partial<User>) => void
}

export function CreateEditUserModal({ user, onUserUpdate }: CreateEditUserModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const queryClient = useQueryClient()
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)
  const refreshUser = useAuthStore((s) => s.refreshUser)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  // Fetch groups and permission profiles
  const { data: groupsData, isLoading: groupsLoading } = useGroupsList({
    page_size: 100,
  })
  const { data: permissionProfiles = [] } = useQuery({
    queryKey: ['permission-profiles'],
    queryFn: listPermissionProfiles,
  })

  // Subscribe to users list so we get latest cache (e.g. after optimistic group update)
  const { data: usersList } = useQuery({
    queryKey: ['users'],
    queryFn: () => listUsers({ limit: 100 }),
  })
  // When editing, prefer user from cache so re-opened modal shows latest group
  const displayUser = useMemo(() => {
    if (!user) return null
    const found = usersList?.items?.find((u) => u.id === user.id)
    if (!found) return user
    return {
      ...user,
      group: found.group_id || '',
      groupName: found.group_name || user.groupName,
      leverageLimitMin: found.min_leverage ?? user.leverageLimitMin ?? 1,
      leverageLimitMax: found.max_leverage ?? user.leverageLimitMax ?? 500,
      permissionProfileId: found.permission_profile_id ?? user.permissionProfileId,
      permissionProfileName: found.permission_profile_name ?? user.permissionProfileName,
      role: found.role ?? user.role,
    }
  }, [user, usersList])

  const nameParts = displayUser?.name?.split(' ') || user?.name?.split(' ') || ['', '']
  const firstName = nameParts[0] || ''
  const lastName = nameParts.slice(1).join(' ') || ''

  const formUser = displayUser ?? user
  const defaultGroup = formUser?.group || ''
  const defaultPermissionProfile = formUser?.permissionProfileId || ''
  const defaultStatus = (formUser?.status === 'suspended' ? 'disabled' : formUser?.status) || 'active'
  const defaultMinLeverage = formUser?.leverageLimitMin ?? 1
  const defaultMaxLeverage = formUser?.leverageLimitMax ?? 500

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
      minLeverage: defaultMinLeverage,
      maxLeverage: defaultMaxLeverage,
      permissionProfile: defaultPermissionProfile,
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
      minLeverage: defaultMinLeverage,
      maxLeverage: defaultMaxLeverage,
      permissionProfile: defaultPermissionProfile,
    })
    const r = formUser.role ?? ''
    if (r === 'admin' || r === 'super_admin') setIsSuperAdmin(r === 'super_admin')
  }, [formUser?.id, defaultGroup, defaultPermissionProfile, defaultStatus, defaultMinLeverage, defaultMaxLeverage, reset, firstName, lastName, formUser?.email, formUser?.phone, formUser?.country, formUser?.role])

  const group = watch('group')
  const groups = groupsData?.items || []

  const onSubmit = async (data: UserFormData) => {
    if (user) {
      setIsSubmitting(true)
      try {
        const newRole = isSuperAdmin ? 'super_admin' : 'admin'
        const roleChanged = (formUser?.role === 'admin' || formUser?.role === 'super_admin') && newRole !== formUser?.role
        if (roleChanged) {
          await updateUserRole(user.id, { role: newRole })
        }
        await updateUserProfile(user.id, {
          first_name: data.firstName,
          last_name: data.lastName,
          email: data.email,
          phone: data.phone || null,
          country: data.country,
          status: data.status as 'active' | 'disabled' | 'suspended',
        })
        await updateUserGroup(user.id, {
          group_id: data.group,
          min_leverage: data.minLeverage,
          max_leverage: data.maxLeverage,
        })
        const permId = data.permissionProfile?.trim() || null
        await updateUserPermissionProfile(user.id, permId)
        const groupName = groups.find((g) => g.id === data.group)?.name ?? ''
        const permissionProfileName = permId ? permissionProfiles.find((p) => p.id === permId)?.name ?? undefined : undefined
        const newName = `${data.firstName} ${data.lastName}`.trim() || user.name
        onUserUpdate?.(user.id, {
          name: newName,
          email: data.email,
          phone: data.phone,
          country: data.country,
          status: data.status as 'active' | 'disabled' | 'suspended',
          group: data.group,
          groupName,
          leverageLimitMin: data.minLeverage,
          leverageLimitMax: data.maxLeverage,
          permissionProfileId: permId ?? undefined,
          permissionProfileName,
          role: newRole,
        })
        queryClient.setQueryData<ListUsersResponse>(['users'], (old) => {
          if (!old || !('items' in old) || !Array.isArray(old.items)) return old
          return {
            ...old,
            items: old.items.map((u) =>
              u.id === user.id
                ? {
                    ...u,
                    first_name: data.firstName,
                    last_name: data.lastName,
                    email: data.email,
                    phone: data.phone ?? null,
                    country: data.country ?? null,
                    status: data.status,
                    group_id: data.group,
                    group_name: groupName,
                    min_leverage: data.minLeverage,
                    max_leverage: data.maxLeverage,
                    permission_profile_id: permId,
                    permission_profile_name: permissionProfileName ?? null,
                    role: newRole,
                  }
                : u
            ),
          }
        })
        await queryClient.invalidateQueries({ queryKey: ['users'] })
        if (user.id === currentUserId) {
          await refreshUser().catch((e) => console.error('Failed to refresh user after self-update', e))
        }
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
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Permission profile</label>
          <Select
            value={watch('permissionProfile') || 'none'}
            onValueChange={(value) => setValue('permissionProfile', value === 'none' ? '' : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="No profile" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No profile</SelectItem>
              {permissionProfiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-text-muted">Optional. Assign a profile to grant permissions (e.g. for managers).</p>
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Initial Status *</label>
          <Select
            value={watch('status')}
            onValueChange={(value) => setValue('status', value as 'active' | 'disabled')}
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
      </div>
      {user && (formUser?.role === 'admin' || formUser?.role === 'super_admin') && (
        <div className="flex items-center gap-2">
          <Checkbox
            checked={isSuperAdmin}
            onChange={(e) => setIsSuperAdmin(e.target.checked)}
            id="super-admin-toggle"
          />
          <label htmlFor="super-admin-toggle" className="text-sm font-medium text-text cursor-pointer">
            Super Admin
          </label>
          <span className="text-xs text-text-muted">Can see and manage all tags without assignment.</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Min leverage *</label>
          <Input
            type="number"
            min={1}
            max={1000}
            {...register('minLeverage', { valueAsNumber: true })}
          />
          {errors.minLeverage && (
            <p className="mt-1 text-sm text-danger">{errors.minLeverage.message}</p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Max leverage *</label>
          <Input
            type="number"
            min={1}
            max={1000}
            {...register('maxLeverage', { valueAsNumber: true })}
          />
          {errors.maxLeverage && (
            <p className="mt-1 text-sm text-danger">{errors.maxLeverage.message}</p>
          )}
        </div>
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

