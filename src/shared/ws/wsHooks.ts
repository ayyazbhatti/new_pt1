import { useEffect, useState } from 'react'
import { wsClient } from './wsClient'
import { WsInboundEvent } from './wsEvents'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated'

export function useWebSocketState() {
  const [state, setState] = useState<ConnectionState>(wsClient.getState())

  useEffect(() => {
    const unsubscribe = wsClient.onStateChange((s: ConnectionState) => setState(s))
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

