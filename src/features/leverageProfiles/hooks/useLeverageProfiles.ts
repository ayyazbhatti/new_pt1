import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/shared/components/common'
import {
  listLeverageProfiles,
  createLeverageProfile,
  updateLeverageProfile,
  deleteLeverageProfile,
  listLeverageProfileTiers,
  createLeverageTier,
  updateLeverageTier,
  deleteLeverageTier,
  getLeverageProfileSymbols,
  setLeverageProfileSymbols,
} from '../api/leverageProfiles.api'
import {
  ListLeverageProfilesParams,
  CreateLeverageProfilePayload,
  UpdateLeverageProfilePayload,
  CreateLeverageTierPayload,
  UpdateLeverageTierPayload,
  SetProfileSymbolsPayload,
} from '../types/leverageProfile'

// Query key factory (export for cache invalidation from modals)
export const leverageProfilesQueryKeys = {
  all: ['adminLeverageProfiles'] as const,
  lists: () => [...leverageProfilesQueryKeys.all, 'list'] as const,
  list: (params?: ListLeverageProfilesParams) => [...leverageProfilesQueryKeys.lists(), params] as const,
  detail: (id: string) => [...leverageProfilesQueryKeys.all, 'detail', id] as const,
  tiers: (profileId: string) => [...leverageProfilesQueryKeys.all, 'tiers', profileId] as const,
  symbols: (profileId: string) => [...leverageProfilesQueryKeys.all, 'symbols', profileId] as const,
}
const queryKeys = leverageProfilesQueryKeys

export function useLeverageProfilesList(params?: ListLeverageProfilesParams) {
  return useQuery({
    queryKey: queryKeys.list(params),
    queryFn: () => listLeverageProfiles(params),
    retry: (failureCount, error: any) => {
      // Don't retry on 401/403 (auth errors)
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        return false
      }
      return failureCount < 2
    },
  })
}

export function useLeverageProfileTiers(profileId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.tiers(profileId!),
    queryFn: () => listLeverageProfileTiers(profileId!),
    enabled: enabled && !!profileId,
  })
}

export function useLeverageProfileSymbols(profileId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.symbols(profileId!),
    queryFn: () => getLeverageProfileSymbols(profileId!),
    enabled: enabled && !!profileId,
  })
}

export function useCreateLeverageProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateLeverageProfilePayload) => createLeverageProfile(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      toast.success('Leverage profile created successfully')
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to create profile'
      toast.error(message)
    },
  })
}

export function useUpdateLeverageProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateLeverageProfilePayload }) =>
      updateLeverageProfile(id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.detail(variables.id) })
      toast.success('Leverage profile updated successfully')
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to update profile'
      toast.error(message)
    },
  })
}

export function useDeleteLeverageProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteLeverageProfile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      toast.success('Leverage profile deleted successfully')
    },
    onError: (error: any) => {
      const errorData = error?.response?.data?.error
      const code = errorData?.code
      const message = errorData?.message || error?.message || 'Failed to delete profile'

      if (code === 'PROFILE_IN_USE') {
        toast.error('Cannot delete profile: It has assigned symbols. Remove symbols first.')
      } else {
        toast.error(message)
      }
    },
  })
}

export function useCreateLeverageTier() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ profileId, payload }: { profileId: string; payload: CreateLeverageTierPayload }) =>
      createLeverageTier(profileId, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tiers(variables.profileId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      toast.success('Tier created successfully')
    },
    onError: (error: any) => {
      const errorData = error?.response?.data?.error
      const code = errorData?.code
      const message = errorData?.message || error?.message || 'Failed to create tier'

      if (code === 'TIER_OVERLAP') {
        toast.error('Tier ranges cannot overlap with existing tiers')
      } else {
        toast.error(message)
      }
    },
  })
}

export function useUpdateLeverageTier() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      profileId,
      tierId,
      payload,
    }: {
      profileId: string
      tierId: string
      payload: UpdateLeverageTierPayload
    }) => updateLeverageTier(profileId, tierId, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tiers(variables.profileId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      toast.success('Tier updated successfully')
    },
    onError: (error: any) => {
      const errorData = error?.response?.data?.error
      const code = errorData?.code
      const message = errorData?.message || error?.message || 'Failed to update tier'

      if (code === 'TIER_OVERLAP') {
        toast.error('Tier ranges cannot overlap with existing tiers')
      } else {
        toast.error(message)
      }
    },
  })
}

export function useDeleteLeverageTier() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ profileId, tierId }: { profileId: string; tierId: string }) =>
      deleteLeverageTier(profileId, tierId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tiers(variables.profileId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      toast.success('Tier deleted successfully')
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to delete tier'
      toast.error(message)
    },
  })
}

export function useSetProfileSymbols() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ profileId, payload }: { profileId: string; payload: SetProfileSymbolsPayload }) =>
      setLeverageProfileSymbols(profileId, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.symbols(variables.profileId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      toast.success('Symbols assigned successfully')
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to assign symbols'
      toast.error(message)
    },
  })
}

