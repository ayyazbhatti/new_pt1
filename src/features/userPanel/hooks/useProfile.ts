import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/shared/components/common'
import { me, updateProfile, type UpdateProfilePayload } from '@/shared/api/auth.api'
import { useAuthStore } from '@/shared/store/auth.store'

export const profileQueryKey = ['profile', 'me'] as const

export function useProfile() {
  return useQuery({
    queryKey: profileQueryKey,
    queryFn: me,
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  const setUser = useAuthStore((s) => s.setUser)

  return useMutation({
    mutationFn: (payload: UpdateProfilePayload) => updateProfile(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(profileQueryKey, data)
      setUser({
        id: data.id,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        status: data.status,
        tradingAccess: data.tradingAccess ?? 'full',
        permissions: data.permissions,
        permissionProfileId: data.permissionProfileId,
        permissionProfileName: data.permissionProfileName,
        referralCode: data.referralCode,
      })
      toast.success('Profile updated.')
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ??
        (err as Error)?.message ??
        'Failed to update profile'
      toast.error(message)
    },
  })
}
