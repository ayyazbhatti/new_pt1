import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/shared/components/common'
import {
  listSymbols,
  listAllSymbolsMatching,
  listAdminSymbols,
  getSymbol,
  createSymbol,
  updateSymbol,
  deleteSymbol,
  toggleSymbolEnabled,
  syncMmdpsSymbols,
  CreateSymbolPayload,
  UpdateSymbolPayload,
  ListSymbolsParams,
  SyncMmdpsPayload,
} from '../api/symbols.api'

const queryKeys = {
  all: ['symbols'] as const,
  lists: () => [...queryKeys.all, 'list'] as const,
  /** Full enabled-symbol set for the trading terminal (all pages). */
  allEnabledTerminal: () => [...queryKeys.lists(), 'all-enabled-terminal'] as const,
  list: (params?: ListSymbolsParams) => [...queryKeys.lists(), params] as const,
  adminLists: () => [...queryKeys.all, 'admin', 'list'] as const,
  adminList: (params?: ListSymbolsParams) => [...queryKeys.adminLists(), params] as const,
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

/** Loads every enabled symbol for the user terminal (forex, crypto, etc.), not capped at one page. */
export function useAllEnabledSymbolsForTerminal() {
  return useQuery({
    queryKey: queryKeys.allEnabledTerminal(),
    queryFn: async () => {
      const items = await listAllSymbolsMatching({ is_enabled: 'true' })
      return { items, total: items.length }
    },
    retry: (failureCount, error: any) => {
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        return false
      }
      return failureCount < 2
    },
  })
}

/** Use on admin symbols page so list includes tick_size, lot_min, lot_max, pip position columns. */
export function useAdminSymbolsList(params?: ListSymbolsParams) {
  return useQuery({
    queryKey: queryKeys.adminList(params),
    queryFn: () => listAdminSymbols(params),
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
      queryClient.invalidateQueries({ queryKey: queryKeys.adminLists() })
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
      queryClient.invalidateQueries({ queryKey: queryKeys.adminLists() })
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
      queryClient.invalidateQueries({ queryKey: queryKeys.adminLists() })
      toast.success('Symbol deleted successfully')
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to delete symbol'
      toast.error(message)
    },
  })
}

export function useSyncMmdpsSymbols() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload?: SyncMmdpsPayload) => syncMmdpsSymbols(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.adminLists() })
      toast.success(
        `MMDPS sync: ${data.upserted} upserted, ${data.skipped} skipped — ${data.db_symbol_count} symbols in database (API returned ${data.fetched})`
      )
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'MMDPS sync failed'
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
      queryClient.invalidateQueries({ queryKey: queryKeys.adminLists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.detail(variables.id) })
      toast.success(`Symbol ${variables.isEnabled ? 'enabled' : 'disabled'} successfully`)
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to toggle symbol'
      toast.error(message)
    },
  })
}

