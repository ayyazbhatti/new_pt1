import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/shared/store/auth.store'
import { wsClient } from '@/shared/ws/wsClient'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import { fetchAccountSummary, type AccountSummaryResponse } from '../api'

const QUERY_KEY = ['accountSummary'] as const

/**
 * Single shared source for account summary. Only one fetch runs for the whole app;
 * LeftSidebar, RightTradingPanel, and BottomDock all use this, so we don't fire
 * 3 concurrent requests on terminal load (which was slowing the frontend).
 */
export function useAccountSummary() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const lastEquityRef = useRef<number | null>(null)

  const { data: accountSummary, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchAccountSummary,
    enabled: !!user?.id,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

  // Update cache from WebSocket so UI stays real-time without refetch
  useEffect(() => {
    if (!user?.id) return
    const currentUserId = String(user.id).trim()
    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      if (event.type === 'account.summary.updated') {
        const payload = (event as { type: 'account.summary.updated'; payload: AccountSummaryResponse }).payload
        if (!payload || String(payload.userId ?? '').trim() !== currentUserId) return
        const isZeros = payload.balance === 0 && payload.equity === 0 && payload.marginUsed === 0
        if (isZeros && lastEquityRef.current != null && lastEquityRef.current > 0) return
        lastEquityRef.current = payload.equity
        queryClient.setQueryData<AccountSummaryResponse>(QUERY_KEY, payload)
      }
    })
    return unsubscribe
  }, [user?.id, queryClient])

  if (accountSummary) lastEquityRef.current = accountSummary.equity

  return { accountSummary: accountSummary ?? null, isLoading }
}

export { QUERY_KEY as accountSummaryQueryKey }
