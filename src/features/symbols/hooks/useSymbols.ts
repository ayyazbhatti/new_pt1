import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import {
  listSymbols,
  getSymbol,
  createSymbol,
  updateSymbol,
  deleteSymbol,
  toggleSymbolEnabled,
  CreateSymbolPayload,
  UpdateSymbolPayload,
  ListSymbolsParams,
} from '../api/symbols.api'

const queryKeys = {
  all: ['symbols'] as const,
  lists: () => [...queryKeys.all, 'list'] as const,
  list: (params?: ListSymbolsParams) => [...queryKeys.lists(), params] as const,
  details: () => [...queryKeys.all, 'detail'] as const,
  detail: (id: string) => [...queryKeys.details(), id] as const,
}

export function useSymbolsList(params?: ListSymbolsParams) {
  return useQuery({
    queryKey: queryKeys.list(params),
    queryFn: () => listSymbols(params),
    retry: (failureCount, error: any) => {
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        return false
      }
      return failureCount < 2
    },
  })
}

export function useSymbol(id: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.detail(id!),
    queryFn: () => getSymbol(id!),
    enabled: enabled && !!id,
  })
}

export function useCreateSymbol() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateSymbolPayload) => createSymbol(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      toast.success('Symbol created successfully')
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to create symbol'
      toast.error(message)
    },
  })
}

export function useUpdateSymbol() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateSymbolPayload }) =>
      updateSymbol(id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.detail(variables.id) })
      toast.success('Symbol updated successfully')
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to update symbol'
      toast.error(message)
    },
  })
}

export function useDeleteSymbol() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteSymbol(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      toast.success('Symbol deleted successfully')
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to delete symbol'
      toast.error(message)
    },
  })
}

export function useToggleSymbolEnabled() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      toggleSymbolEnabled(id, isEnabled),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.detail(variables.id) })
      toast.success(`Symbol ${variables.isEnabled ? 'enabled' : 'disabled'} successfully`)
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to toggle symbol'
      toast.error(message)
    },
  })
}

