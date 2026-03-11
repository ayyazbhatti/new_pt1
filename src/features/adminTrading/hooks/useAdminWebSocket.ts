import { useEffect, useCallback, useRef } from 'react'
import { wsClient } from '@/shared/ws/wsClient'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import { useAdminTradingStore } from '../store/adminTrading.store'
import { AdminOrder, AdminPosition, AdminAuditLog } from '../types'
import { toast } from '@/shared/components/common'

// Throttle mark price updates to avoid excessive re-renders
const MARK_PRICE_THROTTLE_MS = 100 // Update UI every 100ms max

export function useAdminWebSocket() {
  const {
    setWsStatus,
    setWsLastMessageAt,
    upsertOrder,
    upsertPosition,
    removePosition,
    appendAuditLog,
  } = useAdminTradingStore()
  const updateBufferRef = useRef<Map<string, AdminPosition>>(new Map())
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushPositionUpdates = useCallback(() => {
    if (updateBufferRef.current.size === 0) return

    const updates = Array.from(updateBufferRef.current.values())
    updateBufferRef.current.clear()

    updates.forEach((position) => {
      upsertPosition(position)
    })

    flushTimeoutRef.current = null
  }, [upsertPosition])

  const schedulePositionUpdate = useCallback(
    (position: AdminPosition) => {
      updateBufferRef.current.set(position.id, position)

      if (!flushTimeoutRef.current) {
        flushTimeoutRef.current = setTimeout(() => {
          requestAnimationFrame(flushPositionUpdates)
        }, MARK_PRICE_THROTTLE_MS)
      }
    },
    [flushPositionUpdates]
  )

  useEffect(() => {
    // Connect WebSocket if not already connected
    if (wsClient.getState() === 'disconnected') {
      wsClient.connect()
    }
    setWsStatus(wsClient.getState())

    // Subscribe to state changes
    const unsubscribeState = wsClient.onStateChange((state) => {
      setWsStatus(state)
    })

    // Subscribe to admin events
    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      setWsLastMessageAt(Date.now())

      switch (event.type) {
        case 'admin.order.created': {
          const order = event.payload.order as AdminOrder
          upsertOrder(order)
          toast.success(`New order created: ${order.id.slice(0, 8)}...`, {
            duration: 3000,
          })
          break
        }

        case 'admin.order.updated': {
          const order = event.payload.order as AdminOrder
          upsertOrder(order)
          break
        }

        case 'admin.order.canceled': {
          const { orderId } = event.payload
          const currentState = useAdminTradingStore.getState()
          const existingOrder = currentState.orders.get(orderId)
          if (existingOrder) {
            upsertOrder({
              ...existingOrder,
              status: 'cancelled',
              cancelledAt: event.payload.timestamp,
            })
          }
          toast.success(`Order canceled: ${orderId.slice(0, 8)}...`, {
            duration: 3000,
          })
          break
        }

        case 'admin.order.filled': {
          const { orderId, filledSize, averagePrice } = event.payload
          const currentState = useAdminTradingStore.getState()
          const existingOrder = currentState.orders.get(orderId)
          if (existingOrder) {
            upsertOrder({
              ...existingOrder,
              status: 'filled',
              filledSize,
              averagePrice,
              filledAt: event.payload.timestamp,
            })
          }
          toast.success(`Order filled: ${orderId.slice(0, 8)}...`, {
            duration: 3000,
          })
          break
        }

        case 'admin.order.rejected': {
          const { orderId, reason } = event.payload
          const currentState = useAdminTradingStore.getState()
          const existingOrder = currentState.orders.get(orderId)
          if (existingOrder) {
            upsertOrder({
              ...existingOrder,
              status: 'rejected',
              rejectedAt: event.payload.timestamp,
              rejectionReason: reason,
            })
          }
          toast.error(`Order rejected: ${reason}`, {
            duration: 4000,
          })
          break
        }

        case 'admin.position.opened': {
          const position = event.payload.position as AdminPosition
          upsertPosition(position)
          toast.success(`Position opened: ${position.symbol}`, {
            duration: 3000,
          })
          break
        }

        case 'admin.position.updated': {
          const position = event.payload.position as AdminPosition
          // Throttle mark price updates
          schedulePositionUpdate(position)
          break
        }

        case 'admin.position.closed': {
          const { positionId } = event.payload
          removePosition(positionId)
          toast.success(`Position closed: ${positionId.slice(0, 8)}...`, {
            duration: 3000,
          })
          break
        }

        case 'admin.position.liquidated': {
          const { positionId } = event.payload
          const currentState = useAdminTradingStore.getState()
          const existingPosition = currentState.positions.get(positionId)
          if (existingPosition) {
            upsertPosition({
              ...existingPosition,
              status: 'LIQUIDATED',
              closedAt: event.payload.timestamp,
            })
          }
          toast.error(`Position liquidated: ${positionId.slice(0, 8)}...`, {
            duration: 4000,
          })
          break
        }

        case 'admin.position.sltp.modified': {
          const { positionId, stopLoss, takeProfit } = event.payload
          const currentState = useAdminTradingStore.getState()
          const existingPosition = currentState.positions.get(positionId)
          if (existingPosition) {
            upsertPosition({
              ...existingPosition,
              stopLoss,
              takeProfit,
              lastUpdatedAt: event.payload.timestamp,
            })
          }
          toast.success(`SL/TP modified: ${positionId.slice(0, 8)}...`, {
            duration: 3000,
          })
          break
        }

        case 'admin.margin.call': {
          const { userId } = event.payload
          toast.error(`Margin call for user: ${userId.slice(0, 8)}...`, {
            duration: 5000,
          })
          break
        }

        case 'admin.liquidation.warning': {
          const { userId, positionId } = event.payload
          toast.error(`Liquidation warning: ${positionId.slice(0, 8)}...`, {
            duration: 5000,
          })
          break
        }

        case 'admin.audit.appended': {
          const log = event.payload.log as AdminAuditLog
          appendAuditLog(log)
          break
        }

        default:
          // Ignore unknown events
          break
      }
    })

    return () => {
      unsubscribe()
      unsubscribeState()
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount - store functions are stable
}

