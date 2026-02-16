import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import {
  listMarkupProfiles,
  getMarkupProfile,
  createMarkupProfile,
  updateMarkupProfile,
  getSymbolOverrides,
  upsertSymbolOverride,
  CreateProfilePayload,
  UpdateProfilePayload,
  UpsertSymbolOverridePayload,
} from '../api/markup.api'
import { useAuthStore } from '@/shared/store/auth.store'

const queryKeys = {
  all: ['markup'] as const,
  profiles: () => [...queryKeys.all, 'profiles'] as const,
  profile: (id: string) => [...queryKeys.profiles(), id] as const,
  overrides: (profileId: string) => [...queryKeys.all, 'overrides', profileId] as const,
}

export function useMarkupProfiles(options?: { enabled?: boolean }) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const enabled = options?.enabled !== undefined ? options.enabled : !!accessToken
  return useQuery({
    queryKey: queryKeys.profiles(),
    queryFn: () => listMarkupProfiles(),
    enabled,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: (failureCount, error: any) => {
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        return false
      }
      return failureCount < 2
    },
  })
}

export function useMarkupProfile(id: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.profile(id!),
    queryFn: () => getMarkupProfile(id!),
    enabled: enabled && !!id,
  })
}

export function useCreateMarkupProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateProfilePayload) => createMarkupProfile(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles() })
      toast.success('Profile created successfully')
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to create profile'
      toast.error(message)
    },
  })
}

export function useUpdateMarkupProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateProfilePayload }) =>
      updateMarkupProfile(id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles() })
      queryClient.invalidateQueries({ queryKey: queryKeys.profile(variables.id) })
      toast.success('Profile updated successfully')
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to update profile'
      toast.error(message)
    },
  })
}

export function useSymbolOverrides(profileId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.overrides(profileId!),
    queryFn: () => getSymbolOverrides(profileId!),
    enabled: enabled && !!profileId,
  })
}

export function useUpsertSymbolOverride() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      profileId,
      symbolId,
      payload,
    }: {
      profileId: string
      symbolId: string
      payload: UpsertSymbolOverridePayload
    }) => upsertSymbolOverride(profileId, symbolId, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.overrides(variables.profileId) })
      toast.success('Markup saved', { duration: 2000 })
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to save markup'
      toast.error(message)
    },
  })
}

