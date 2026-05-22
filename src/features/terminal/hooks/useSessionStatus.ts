import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSessionStatus, fetchSessionStatusBatch } from '../api/sessions.api'

export type { SessionStatus } from '../api/sessions.api'

/** Prefix match invalidates both single-symbol and batch session queries. */
export const SESSION_STATUS_QUERY_PREFIX = ['session-status'] as const

/**
 * Fetches session status for one symbol. HTTP refresh on window focus and tab visibility
 * (no fixed-interval refetch — aligns with repo no-polling guidance).
 */
export function useSessionStatus(symbolCode: string | null | undefined) {
  const code = symbolCode?.trim() ?? ''
  return useQuery({
    queryKey: [...SESSION_STATUS_QUERY_PREFIX, 'single', code],
    queryFn: () => fetchSessionStatus(code),
    enabled: code.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

/**
 * Batch session status for symbol lists (grey-out). Same refresh policy as `useSessionStatus`.
 */
export function useSessionStatusBatch(symbolCodes: string[]) {
  const sortedKey = useMemo(() => [...symbolCodes].sort().join(','), [symbolCodes])
  return useQuery({
    queryKey: [...SESSION_STATUS_QUERY_PREFIX, 'batch', sortedKey],
    queryFn: () => fetchSessionStatusBatch(symbolCodes),
    enabled: symbolCodes.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

/** Local clock tick for countdown labels (not an API poll). */
export function useSessionCountdownTick(intervalMs = 30_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return nowMs
}

/**
 * When the user returns to the tab, refetch session queries so open/closed state catches up
 * without periodic HTTP polling.
 */
export function useInvalidateSessionStatusOnVisibility() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void queryClient.invalidateQueries({ queryKey: [...SESSION_STATUS_QUERY_PREFIX] })
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [queryClient])
}
