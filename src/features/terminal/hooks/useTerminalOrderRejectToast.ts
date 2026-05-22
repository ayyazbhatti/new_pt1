import { useEffect } from 'react'
import { wsClient } from '@/shared/ws/wsClient'
import { toast } from '@/shared/components/common'
import { useTerminalStore } from '../store'

const RECENT_ORDER_TOAST_WINDOW_MS = 30_000

function flattenOrderUpdatePayload(data: Record<string, unknown>): Record<string, unknown> {
  const nested =
    data.payload && typeof data.payload === 'object' ? (data.payload as Record<string, unknown>) : null
  const base = nested ? { ...nested } : { ...data }
  for (const key of ['reason', 'details', 'user_id', 'userId', 'order_id', 'orderId', 'status', 'symbol', 'side']) {
    const v = data[key]
    if (v != null && base[key] == null) base[key] = v
  }
  return base
}

/**
 * Listens for user `order_update` WebSocket messages and toasts async rejections
 * (e.g. slippage) for orders this client recently submitted. Place-order HTTP may return 200 before reject.
 */
export function useTerminalOrderRejectToast() {
  useEffect(() => {
    const unsubscribe = wsClient.subscribe((event) => {
      const t = event.type as string
      if (t !== 'order_update' && t !== 'order.update' && t !== 'order_updated') return

      useTerminalStore.getState().pruneStaleRecentSubmittedOrders()

      const data = event as unknown as Record<string, unknown>
      const raw = flattenOrderUpdatePayload(data)
      const orderId = String(raw.order_id ?? raw.orderId ?? '').trim()
      if (!orderId) return

      const placedAt = useTerminalStore.getState().recentOrderSubmitAtById[orderId]
      if (placedAt == null) return
      if (Date.now() - placedAt > RECENT_ORDER_TOAST_WINDOW_MS) {
        useTerminalStore.getState().forgetRecentSubmittedOrder(orderId)
        return
      }

      const stRaw = String(raw.status ?? '').trim()
      const st = stRaw.toUpperCase()

      if (st === 'FILLED' || st === 'CANCELLED' || st === 'CANCELED' || st === 'CANCELLING') {
        useTerminalStore.getState().forgetRecentSubmittedOrder(orderId)
        return
      }

      if (st !== 'REJECTED') return

      useTerminalStore.getState().forgetRecentSubmittedOrder(orderId)

      const reason = String(raw.reason ?? raw.rejection_reason ?? '').trim()
      if (reason === 'SLIPPAGE_EXCEEDED') {
        const details = raw.details
        let actualBps: string | number = '?'
        let maxBps: string | number = '?'
        if (details && typeof details === 'object' && !Array.isArray(details)) {
          const d = details as Record<string, unknown>
          const a = d.slippageBps ?? d.slippage_bps
          const m = d.maxBps ?? d.max_bps
          if (typeof a === 'number' && Number.isFinite(a)) actualBps = a
          else if (typeof a === 'string') actualBps = a
          if (typeof m === 'number' && Number.isFinite(m)) maxBps = m
          else if (typeof m === 'string') maxBps = m
        }
        if (actualBps !== '?' && maxBps !== '?') {
          toast.error(
            `Order rejected — price moved ${actualBps} bps from the quote at submit (your max was ${maxBps} bps). Try a higher max slippage in Advanced.`,
            { duration: 6000 }
          )
        } else {
          toast.error(
            'Order rejected — price moved too far from your quote (slippage). Try increasing max slippage under Advanced.',
            { duration: 6000 }
          )
        }
        return
      }

      toast.error(
        reason
          ? `Order rejected: ${reason}`
          : 'Order rejected. If the market moved quickly, try a higher max slippage (Advanced) or retry.',
        { duration: 5500 }
      )
    })

    return unsubscribe
  }, [])
}
