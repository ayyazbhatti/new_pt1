import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAccountSummaries, type AdminAccountSummaryResponse } from '../api/users.api'
import { useAuthStore } from '@/shared/store/auth.store'
import { toast } from '@/shared/components/common'

export const adminAccountSummariesQueryKey = ['admin', 'accountSummaries'] as const

/**
 * Batch-fetch account summaries for the given user IDs. Same data source as user terminal
 * (Redis + compute). Fetches once when userIds change (no polling).
 * Only runs when accessToken is present so that on full page reload we don't send the request
 * before auth rehydration has finished (which would cause 401 and empty data).
 */
export function useAdminAccountSummaries(
  userIds: string[]
): { summaries: Record<string, AdminAccountSummaryResponse>; isLoading: boolean; error: unknown } {
  const accessToken = useAuthStore((s) => s.accessToken)
  const enabled = userIds.length > 0 && !!accessToken
  if (import.meta.env?.DEV && userIds.length > 0 && !enabled) {
    console.warn('[account-summaries] Query disabled: userIds=', userIds.length, 'accessToken=', !!accessToken)
  }
  const { data: summaries = {}, isLoading, error, isError } = useQuery({
    queryKey: [...adminAccountSummariesQueryKey, userIds.slice(0, 200).sort()] as const,
    queryFn: () => getAccountSummaries(userIds.slice(0, 200)),
    enabled,
    retry: 0,
    refetchOnMount: 'always',
  })
  if (import.meta.env?.DEV && enabled && Object.keys(summaries).length > 0) {
    console.log('[account-summaries] Hook: passing', Object.keys(summaries).length, 'summaries to table')
  }
  useEffect(() => {
    if (isError && error) {
      const msg = error instanceof Error ? error.message : String(error)
      toast.error(`Account summaries: ${msg}`)
    }
  }, [isError, error])
  return { summaries, isLoading, error }
}
