import { useCallback } from 'react'
import { useWebSocketSubscription } from '../ws/wsHooks'
import { WsInboundEvent } from '../ws/wsEvents'
import { useWalletStore } from '../store/walletStore'
import { useAuthStore } from '../store/auth.store'
import { toast } from '@/shared/components/common'

/**
 * Global hook to listen for wallet balance updates from WebSocket
 * This should be mounted once at the app level to ensure balance updates
 * are received regardless of which page the user is on
 */
export function useGlobalWalletBalance() {
  const { user } = useAuthStore()
  const { setWalletData } = useWalletStore()

  useWebSocketSubscription(
    useCallback(
      (event: WsInboundEvent) => {
        if (event.type === 'wallet.balance.updated') {
          const { payload } = event
          
          // Compare userId (can be string or UUID) with user.id
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
            console.log('💰 [Global] Received wallet.balance.updated:', payload)
            
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
            console.log('💰 [Global] wallet.balance.updated received but userId mismatch:', {
              payloadUserId,
              currentUserId
            })
          }
        }
      },
      [user?.id, setWalletData]
    )
  )
}

