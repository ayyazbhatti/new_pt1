import { useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/shared/store/auth.store'
import { wsClient } from '@/shared/ws/wsClient'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import { fetchAccountSummary, type AccountSummaryResponse } from '../api'

const QUERY_KEY = ['accountSummary'] as const

/** Shared with `applyAccountSummaryWsToQueryCache` so BottomDock + wsClient agree on the all-zero reconnect guard. */
let lastEquityForSummaryWsGuard: number | null = null

function normalizeUserIdForCompare(id: string | undefined | null): string {
  if (id == null) return ''
  return String(id).trim().toLowerCase().replace(/-/g, '')
}

/**
 * Apply `account.summary.updated` payload into the shared React Query cache.
 * Used by `useAccountSummary` (wsClient) and by BottomDock’s dedicated positions WebSocket
 * so the dock stats bar stays live even when events only hit one socket.
 */
export function applyAccountSummaryWsToQueryCache(
  queryClient: QueryClient,
  currentUserId: string | undefined | null,
  raw: unknown,
): void {
  if (!currentUserId || typeof raw !== 'object' || raw === null) return
  const r = raw as Record<string, unknown>
  const userIdRaw = String((r.userId ?? r.user_id) ?? '').trim()
  if (!userIdRaw) return
  if (normalizeUserIdForCompare(userIdRaw) !== normalizeUserIdForCompare(currentUserId)) return

  const balance = Number((r.balance ?? 0))
  const equity = Number((r.equity ?? 0))
  const marginUsed = Number((r.marginUsed ?? r.margin_used ?? 0))
  const freeMargin = Number((r.freeMargin ?? r.free_margin ?? 0))
  const marginLevel = String(r.marginLevel ?? r.margin_level ?? '')
  const realizedPnl = Number((r.realizedPnl ?? r.realized_pnl ?? 0))
  const unrealizedPnl = Number((r.unrealizedPnl ?? r.unrealized_pnl ?? 0))
  const bonus = Number((r.bonus ?? 0))
  const totalSwapPaidUsd =
    r.totalSwapPaidUsd != null
      ? Number(r.totalSwapPaidUsd)
      : r.total_swap_paid_usd != null
        ? Number(r.total_swap_paid_usd)
        : undefined
  const totalFeesPaidUsd =
    r.totalFeesPaidUsd != null
      ? Number(r.totalFeesPaidUsd)
      : r.total_fees_paid_usd != null
        ? Number(r.total_fees_paid_usd)
        : undefined
  const updatedAt = String(r.updatedAt ?? r.updated_at ?? '')
  const isZeros = balance === 0 && equity === 0 && marginUsed === 0
  if (isZeros && lastEquityForSummaryWsGuard != null && lastEquityForSummaryWsGuard > 0) return
  lastEquityForSummaryWsGuard = equity
  const marginCallLevelThreshold =
    r.marginCallLevelThreshold != null
      ? Number(r.marginCallLevelThreshold)
      : r.margin_call_level_threshold != null
        ? Number(r.margin_call_level_threshold)
        : null
  const stopOutLevelThreshold =
    r.stopOutLevelThreshold != null
      ? Number(r.stopOutLevelThreshold)
      : r.stop_out_level_threshold != null
        ? Number(r.stop_out_level_threshold)
        : null
  const payload: AccountSummaryResponse = {
    userId: userIdRaw,
    balance,
    equity,
    marginUsed,
    freeMargin,
    marginLevel,
    marginCallLevelThreshold,
    stopOutLevelThreshold,
    realizedPnl,
    unrealizedPnl,
    bonus,
    totalSwapPaidUsd,
    totalFeesPaidUsd,
    updatedAt,
  }
  queryClient.setQueryData<AccountSummaryResponse>(QUERY_KEY, payload)
}

/**
 * Single shared source for account summary. Only one fetch runs for the whole app;
 * LeftSidebar, RightTradingPanel, and BottomDock all use this, so we don't fire
 * 3 concurrent requests on terminal load (which was slowing the frontend).
 */
export function useAccountSummary() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

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
        const raw = (event as { type: 'account.summary.updated'; payload: Record<string, unknown> }).payload
        applyAccountSummaryWsToQueryCache(queryClient, currentUserId, raw)
      }
    })
    return unsubscribe
  }, [user?.id, queryClient])

  if (accountSummary) lastEquityForSummaryWsGuard = accountSummary.equity

  return { accountSummary: accountSummary ?? null, isLoading }
}

export { QUERY_KEY as accountSummaryQueryKey }
