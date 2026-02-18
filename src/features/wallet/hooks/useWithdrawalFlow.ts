import { useState, useCallback } from 'react'
import { toast } from 'react-hot-toast'
import { useWalletStore } from '@/shared/store/walletStore'
import { useNotificationsStore } from '@/shared/store/notificationsStore'
import { useAuthStore } from '@/shared/store/auth.store'
import { useWebSocketSubscription } from '@/shared/ws/wsHooks'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import { createWithdrawalRequest } from '../api'

export function useWithdrawalFlow() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { user } = useAuthStore()
  const { setWalletData } = useWalletStore()
  const { push: pushNotification } = useNotificationsStore()

  // Subscribe to WebSocket events for balance updates (no API calls)
  useWebSocketSubscription(
    useCallback(
      (event: WsInboundEvent) => {
        if (event.type === 'withdrawal.request.approved') {
          const { payload } = event
          if (payload.userId === user?.id) {
            // Update balance from server
            setWalletData({
              balance: payload.newBalance,
              currency: 'USD',
              available: payload.newBalance, // Simplified - server should provide full data
              locked: 0,
              equity: payload.newBalance,
              margin_used: 0,
              free_margin: payload.newBalance,
            })

            // Push notification
            pushNotification({
              id: crypto.randomUUID(),
              kind: 'WITHDRAWAL_APPROVED',
              title: 'Withdrawal Approved',
              message: `Your withdrawal of $${payload.amount} has been approved. New balance: $${payload.newBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              createdAt: payload.approvedAt,
              read: false,
              meta: {
                requestId: payload.requestId,
                amount: payload.amount,
              },
            })

            toast.success(
              `Withdrawal approved (ID: ${payload.requestId.slice(0, 8)}...). Balance updated to $${payload.newBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              { duration: 6000 }
            )
          }
        } else if (event.type === 'wallet.balance.updated') {
          const { payload } = event
          // Normalize UUIDs to handle format differences (with/without dashes, case)
          const normalizeUserId = (id: string | undefined | null): string => {
            if (!id) return ''
            const str = id.toString().trim().toLowerCase()
            // Remove dashes and normalize UUID format
            return str.replace(/-/g, '')
          }
          
          const payloadUserId = normalizeUserId(payload.userId || (payload as any).user_id)
          const currentUserId = normalizeUserId(user?.id)
          
          if (payloadUserId && currentUserId && payloadUserId === currentUserId) {
            console.log('💰 Received wallet.balance.updated:', payload)
            // Update wallet from server event
            setWalletData({
              balance: payload.balance || 0,
              currency: payload.currency || 'USD',
              available: payload.available || payload.balance || 0,
              locked: payload.locked || 0,
              equity: payload.equity || payload.balance || 0,
              margin_used: payload.margin_used ?? (Number((payload as Record<string, unknown>).marginUsed) || 0),
              free_margin: Number(payload.free_margin ?? (payload as Record<string, unknown>).freeMargin ?? payload.available ?? payload.balance) || 0,
            })
          } else {
            console.log('💰 wallet.balance.updated received but userId mismatch:', {
              payloadUserId,
              currentUserId
            })
          }
        }
      },
      [user?.id, setWalletData, pushNotification]
    )
  )

  const submitWithdrawal = useCallback(
    async (amount: number, note?: string) => {
      if (!user?.id) {
        toast.error('You must be logged in to withdraw')
        return
      }

      setIsSubmitting(true)

      try {
        // Call backend API - server will handle WebSocket broadcasting
        const response = await createWithdrawalRequest({ amount, note })

        toast.success(
          `Withdrawal request sent (ID: ${response.requestId.slice(0, 8)}...)`,
          { duration: 5000 }
        )
      } catch (error: any) {
        const errorMessage =
          error?.response?.data?.error?.message ||
          error?.message ||
          'Failed to submit withdrawal request'
        toast.error(errorMessage, { duration: 5000 })
      } finally {
        setIsSubmitting(false)
      }
    },
    [user?.id]
  )

  return {
    submitWithdrawal,
    isSubmitting,
  }
}

