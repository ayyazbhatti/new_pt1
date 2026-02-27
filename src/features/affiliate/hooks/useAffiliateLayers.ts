import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import {
  listAffiliateLayers,
  createAffiliateLayer,
  updateAffiliateLayer,
  deleteAffiliateLayer,
} from '../api/affiliateLayers.api'
import type {
  CreateAffiliateLayerPayload,
  UpdateAffiliateLayerPayload,
} from '../api/affiliateLayers.api'
import { affiliateUsersQueryKey } from './useAffiliateUsers'

export const affiliateLayersQueryKey = ['affiliate', 'layers'] as const

export function useAffiliateLayers() {
  return useQuery({
    queryKey: affiliateLayersQueryKey,
    queryFn: listAffiliateLayers,
  })
}

export function useCreateAffiliateLayer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateAffiliateLayerPayload) =>
      createAffiliateLayer(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: affiliateLayersQueryKey })
      queryClient.invalidateQueries({ queryKey: affiliateUsersQueryKey })
      toast.success('Layer created.')
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ??
        (err as Error)?.message ??
        'Failed to create layer'
      toast.error(message)
    },
  })
}

export function useUpdateAffiliateLayer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: UpdateAffiliateLayerPayload
    }) => updateAffiliateLayer(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: affiliateLayersQueryKey })
      queryClient.invalidateQueries({ queryKey: affiliateUsersQueryKey })
      toast.success('Layer updated.')
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ??
        (err as Error)?.message ??
        'Failed to update layer'
      toast.error(message)
    },
  })
}

export function useDeleteAffiliateLayer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteAffiliateLayer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: affiliateLayersQueryKey })
      queryClient.invalidateQueries({ queryKey: affiliateUsersQueryKey })
      toast.success('Layer deleted.')
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ??
        (err as Error)?.message ??
        'Failed to delete layer'
      toast.error(message)
    },
  })
}
