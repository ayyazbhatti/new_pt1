import { ReactNode, useEffect } from 'react'
import { wsClient } from '@/shared/ws/wsClient'
import type { WsInboundEvent } from '@/shared/ws/wsEvents'
import { useAuthStore } from '@/shared/store/auth.store'
import { useAiReportsStore } from '../store/aiReportsStore'

/** Pushes `ai.report.delta` WebSocket events into the ai reports Zustand store. */
export function AiReportsWsProvider({ children }: { children: ReactNode }) {
  const userId = useAuthStore((s) => s.user?.id)

  useEffect(() => {
    if (!userId) return

    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      if (event.type !== 'ai.report.delta') return
      useAiReportsStore.getState().handleWsPayload(event.payload)
    })

    return unsubscribe
  }, [userId])

  return <>{children}</>
}
