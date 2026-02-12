import { useState, useCallback, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { useWalletStore } from '@/shared/store/walletStore'
import { useNotificationsStore } from '@/shared/store/notificationsStore'
import { useAuthStore } from '@/shared/store/auth.store'
import { wsClient } from '@/shared/ws/wsClient'
import { useWebSocketSubscription } from '@/shared/ws/wsHooks'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import { createWithdrawalRequest, fetchBalance } from '../api'

export function useWithdrawalFlow() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { user } = useAuthStore()
  const { setWalletData } = useWalletStore()
  const { push: pushNotification } = useNotificationsStore()

  // Load initial balance on mount
  useEffect(() => {
    const loadBalance = async () => {
      try {
        const balanceData = await fetchBalance()
        setWalletData({
          balance: balanceData.balance,
          currency: balanceData.currency,
          available: balanceData.available,
          locked: balanceData.locked,
          equity: balanceData.equity,
          margin_used: balanceData.marginUsed,
          free_margin: balanceData.freeMargin,
        })
      } catch (error: any) {
        // Gracefully handle 404 - endpoint not implemented yet
        if (error?.response?.status === 404) {
          console.warn('Wallet balance endpoint not available yet (404). Backend implementation pending.')
          // Keep default values from store
        } else {
          console.error('Failed to load balance:', error)
        }
        // Don't show toast on initial load failure
      }
    }

    if (user?.id) {
      loadBalance()
    }
  }, [user?.id, setWalletData])

  // Subscribe to WebSocket events
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
          if (payload.userId === user?.id) {
            // Update wallet from server event
            setWalletData({
              balance: payload.balance,
              currency: payload.currency,
              available: payload.available,
              locked: payload.locked,
              equity: payload.equity,
              margin_used: payload.margin_used,
              free_margin: payload.free_margin,
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

