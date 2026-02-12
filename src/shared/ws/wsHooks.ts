import { useEffect, useState } from 'react'
import { wsClient } from './wsClient'
import { WsInboundEvent } from './wsEvents'

export function useWebSocketState() {
  const [state, setState] = useState<'disconnected' | 'connecting' | 'connected'>(
    wsClient.getState()
  )

  useEffect(() => {
    const unsubscribe = wsClient.onStateChange(setState)
    return unsubscribe
  }, [])

  return state
}

export function useWebSocketSubscription(handler: (event: WsInboundEvent) => void) {
  useEffect(() => {
    const unsubscribe = wsClient.subscribe(handler)
    return unsubscribe
  }, [handler])
}

