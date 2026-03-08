import { useEffect } from 'react'
import { useAuthStore } from '@/shared/store/auth.store'
import { priceStreamClient } from '@/shared/ws/priceStreamClient'
import { useAdminTradingStore } from '../store/adminTrading.store'
import type { AdminPosition } from '../types'

/**
 * Subscribes to the price stream for symbols of the given positions and updates
 * liveMarkBySymbol in the store on each tick. Used for the Live PnL column.
 * No polling — updates are event-driven via WebSocket ticks only.
 */
export function useAdminTradingLivePrices(positions: AdminPosition[]) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const setLiveMark = useAdminTradingStore((s) => s.setLiveMark)

  const symbols = Array.from(
    new Set(
      positions
        .filter((p) => p.status === 'OPEN' && p.symbol)
        .map((p) => p.symbol.toUpperCase().trim())
    )
  )

  useEffect(() => {
    priceStreamClient.setAuthToken(accessToken)
  }, [accessToken])

  useEffect(() => {
    if (symbols.length === 0) return

    const onTick = (tick: { symbol: string; bid: string; ask: string }) => {
      const bid = parseFloat(tick.bid)
      const ask = parseFloat(tick.ask)
      if (Number.isFinite(bid) && Number.isFinite(ask)) {
        const mid = (bid + ask) / 2
        setLiveMark(tick.symbol, mid)
      }
    }

    const unsubscribe = priceStreamClient.onTick(onTick)
    priceStreamClient.subscribe(symbols)

    return () => {
      unsubscribe()
      // Do not call priceStreamClient.unsubscribe(symbols) here so we don't
      // remove symbols that other parts of the app (e.g. terminal) may need.
    }
  }, [[...symbols].sort().join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
}
