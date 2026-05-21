import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/shared/components/common'
import {
  listFeeRules,
  getFeeRule,
  createFeeRule,
  updateFeeRule,
  deleteFeeRule,
} from '../api/feeRules.api'
import type { ListFeeRulesParams, CreateFeeRulePayload, UpdateFeeRulePayload } from '../types/feeRule'

export const feeRulesQueryKeys = {
  all: ['feeRules'] as const,
  lists: () => [...feeRulesQueryKeys.all, 'list'] as const,
  list: (params?: ListFeeRulesParams) => [...feeRulesQueryKeys.lists(), params] as const,
  detail: (id: string) => [...feeRulesQueryKeys.all, 'detail', id] as const,
}

export function useFeeRulesList(params?: ListFeeRulesParams) {
  return useQuery({
    queryKey: feeRulesQueryKeys.list(params),
    queryFn: () => listFeeRules(params),
  })
}

export function useFeeRule(id: string | null, enabled = true) {
  return useQuery({
    queryKey: feeRulesQueryKeys.detail(id!),
    queryFn: () => getFeeRule(id!),
    enabled: enabled && !!id,
  })
}

export function useCreateFeeRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateFeeRulePayload) => createFeeRule(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feeRulesQueryKeys.lists() })
      toast.success('Fee rule created')
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error?.message || error?.message || 'Failed to create fee rule'
      toast.error(message)
    },
  })
}

export function useUpdateFeeRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateFeeRulePayload }) =>
      updateFeeRule(id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: feeRulesQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: feeRulesQueryKeys.detail(variables.id) })
      toast.success('Fee rule updated')
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error?.message || error?.message || 'Failed to update fee rule'
      toast.error(message)
    },
  })
}

export function useDeleteFeeRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteFeeRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feeRulesQueryKeys.lists() })
      toast.success('Fee rule deleted')
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error?.message || error?.message || 'Failed to delete fee rule'
      toast.error(message)
    },
  })
}
