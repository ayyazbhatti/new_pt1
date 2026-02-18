import { useState, useCallback } from 'react'
import { toast } from 'react-hot-toast'
import { useWalletStore } from '@/shared/store/walletStore'
import { useNotificationsStore } from '@/shared/store/notificationsStore'
import { useAuthStore } from '@/shared/store/auth.store'
import { useWebSocketSubscription } from '@/shared/ws/wsHooks'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import { createDepositRequest } from '../api'

export function useDepositFlow() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { user } = useAuthStore()
  const { setWalletData } = useWalletStore()
  const { push: pushNotification } = useNotificationsStore()

  // Subscribe to WebSocket events for balance updates (no API calls)
  useWebSocketSubscription(
    useCallback(
      (event: WsInboundEvent) => {
        if (event.type === 'deposit.request.approved') {
          const { payload } = event
          const userId = payload.userId || (payload as any).userId
          if (userId === user?.id?.toString()) {
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
            const transactionId = (payload as any).transactionId || payload.requestId
            pushNotification({
              id: crypto.randomUUID(),
              kind: 'DEPOSIT_APPROVED',
              title: 'Deposit Approved',
              message: `Your deposit of $${payload.amount} has been approved. New balance: $${payload.newBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              createdAt: payload.approvedAt,
              read: false,
              meta: {
                transactionId: transactionId,
                amount: payload.amount,
              },
            })

            toast.success(
              `Deposit approved (ID: ${transactionId.slice(0, 8)}...). Balance updated to $${payload.newBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
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
            // Check balance before updating to determine if this is initial load or update
            const currentBalance = useWalletStore.getState().balance
            const newBalance = payload.balance || 0
            const isInitialLoad = currentBalance === 0
            
            // Update wallet from server event
            setWalletData({
              balance: newBalance,
              currency: payload.currency || 'USD',
              available: payload.available || payload.balance || 0,
              locked: payload.locked || 0,
              equity: payload.equity || payload.balance || 0,
              margin_used: payload.margin_used ?? (Number((payload as Record<string, unknown>).marginUsed) || 0),
              free_margin: Number(payload.free_margin ?? (payload as Record<string, unknown>).freeMargin ?? payload.available ?? payload.balance) || 0,
            })
            
            // Only show toast if balance changed (not on initial load)
            if (!isInitialLoad && currentBalance !== newBalance) {
              toast.success(
                `Balance updated: $${newBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                { duration: 3000 }
              )
            }
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

  const submitDeposit = useCallback(
    async (amount: number, note?: string) => {
      if (!user?.id) {
        toast.error('You must be logged in to deposit')
        return
      }

      setIsSubmitting(true)

      try {
        // Call backend API - server will handle WebSocket broadcasting
        const response = await createDepositRequest({ amount, note })

        toast.success(
          `Deposit request sent (ID: ${response.requestId.slice(0, 8)}...)`,
          { duration: 5000 }
        )
      } catch (error: any) {
        const errorMessage =
          error?.response?.data?.error?.message ||
          error?.message ||
          'Failed to submit deposit request'
        toast.error(errorMessage, { duration: 5000 })
      } finally {
        setIsSubmitting(false)
      }
    },
    [user?.id]
  )

  return {
    submitDeposit,
    isSubmitting,
  }
}
