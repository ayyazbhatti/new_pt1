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
    // Fallback: refetch every 5s so UI updates even if WS account.summary.updated is missed
    refetchInterval: 5000,
  })

  // Update cache from WebSocket so UI stays real-time without refetch
  useEffect(() => {
    if (!user?.id) return
    const currentUserId = String(user.id).trim()
    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      if (event.type === 'account.summary.updated') {
        const raw = (event as { type: 'account.summary.updated'; payload: Record<string, unknown> }).payload
        if (!raw || typeof raw !== 'object') return
        // Accept both camelCase and snake_case from backend
        const userId = String((raw.userId ?? raw.user_id) ?? '').trim()
        if (userId !== currentUserId) return
        const balance = Number((raw.balance ?? 0))
        const equity = Number((raw.equity ?? 0))
        const marginUsed = Number((raw.marginUsed ?? raw.margin_used ?? 0))
        const freeMargin = Number((raw.freeMargin ?? raw.free_margin ?? 0))
        const marginLevel = String(raw.marginLevel ?? raw.margin_level ?? '')
        const realizedPnl = Number((raw.realizedPnl ?? raw.realized_pnl ?? 0))
        const unrealizedPnl = Number((raw.unrealizedPnl ?? raw.unrealized_pnl ?? 0))
        const updatedAt = String(raw.updatedAt ?? raw.updated_at ?? '')
        const isZeros = balance === 0 && equity === 0 && marginUsed === 0
        if (isZeros && lastEquityRef.current != null && lastEquityRef.current > 0) return
        lastEquityRef.current = equity
        const marginCallLevelThreshold =
          raw.marginCallLevelThreshold != null
            ? Number(raw.marginCallLevelThreshold)
            : raw.margin_call_level_threshold != null
              ? Number(raw.margin_call_level_threshold)
              : null
        const stopOutLevelThreshold =
          raw.stopOutLevelThreshold != null
            ? Number(raw.stopOutLevelThreshold)
            : raw.stop_out_level_threshold != null
              ? Number(raw.stop_out_level_threshold)
              : null
        const payload: AccountSummaryResponse = {
          userId,
          balance,
          equity,
          marginUsed,
          freeMargin,
          marginLevel,
          marginCallLevelThreshold,
          stopOutLevelThreshold,
          realizedPnl,
          unrealizedPnl,
          updatedAt,
        }
        queryClient.setQueryData<AccountSummaryResponse>(QUERY_KEY, payload)
      }
    })
    return unsubscribe
  }, [user?.id, queryClient])

  if (accountSummary) lastEquityRef.current = accountSummary.equity

  return { accountSummary: accountSummary ?? null, isLoading }
}

export { QUERY_KEY as accountSummaryQueryKey }
