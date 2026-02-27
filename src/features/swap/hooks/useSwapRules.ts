import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/shared/components/common'
import {
  listSwapRules,
  getSwapRule,
  createSwapRule,
  updateSwapRule,
  deleteSwapRule,
} from '../api/swap.api'
import type {
  ListSwapRulesParams,
  CreateSwapRulePayload,
  UpdateSwapRulePayload,
} from '../types/swap'

export const swapRulesQueryKeys = {
  all: ['swapRules'] as const,
  lists: () => [...swapRulesQueryKeys.all, 'list'] as const,
  list: (params?: ListSwapRulesParams) =>
    [...swapRulesQueryKeys.lists(), params] as const,
  detail: (id: string) => [...swapRulesQueryKeys.all, 'detail', id] as const,
}

export function useSwapRulesList(params?: ListSwapRulesParams) {
  return useQuery({
    queryKey: swapRulesQueryKeys.list(params),
    queryFn: () => listSwapRules(params),
  })
}

export function useSwapRule(id: string | null, enabled = true) {
  return useQuery({
    queryKey: swapRulesQueryKeys.detail(id!),
    queryFn: () => getSwapRule(id!),
    enabled: enabled && !!id,
  })
}

export function useCreateSwapRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateSwapRulePayload) => createSwapRule(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: swapRulesQueryKeys.lists() })
      toast.success('Swap rule created successfully')
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error?.message ||
        error?.message ||
        'Failed to create swap rule'
      toast.error(message)
    },
  })
}

export function useUpdateSwapRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: UpdateSwapRulePayload
    }) => updateSwapRule(id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: swapRulesQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: swapRulesQueryKeys.detail(variables.id),
      })
      toast.success('Swap rule updated successfully')
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error?.message ||
        error?.message ||
        'Failed to update swap rule'
      toast.error(message)
    },
  })
}

export function useDeleteSwapRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteSwapRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: swapRulesQueryKeys.lists() })
      toast.success('Swap rule deleted successfully')
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error?.message ||
        error?.message ||
        'Failed to delete swap rule'
      toast.error(message)
    },
  })
}
