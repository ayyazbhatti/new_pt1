import { useEffect, useRef, useState, useCallback } from 'react'
import { useAuthStore } from '@/shared/store/auth.store'

export interface PriceTick {
  symbol: string
  bid: string
  ask: string
  ts: number
}

interface UseWebSocketOptions {
  url: string
  onMessage?: (data: PriceTick) => void
  onError?: (error: Event) => void
  onOpen?: () => void
  onClose?: () => void
  reconnectInterval?: number
  enabled?: boolean
}

export function useWebSocket(options: UseWebSocketOptions) {
  const {
    url,
    onMessage,
    onError,
    onOpen,
    onClose,
    reconnectInterval = 3000,
    enabled = true,
  } = options

  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const shouldReconnectRef = useRef(true)
  const isIntentionallyClosingRef = useRef(false)
  const isUnmountingRef = useRef(false)
  const isAuthenticatedRef = useRef(false)

  const connect = useCallback(() => {
    console.log('🔌 [useWebSocket] connect() called. enabled:', enabled, '| isUnmounting:', isUnmountingRef.current, '| wsRef.current?.readyState:', wsRef.current?.readyState)
    
    // If enabled is true, we're clearly not unmounting (React Strict Mode cleanup can set this incorrectly)
    // Reset the unmounting flag if we're trying to connect
    if (enabled) {
      isUnmountingRef.current = false
    }
    
    // Don't connect if we're unmounting or already connected
    if (!enabled || isUnmountingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('🔌 [useWebSocket] connect() returning early:', {
        enabled,
        isUnmounting: isUnmountingRef.current,
        readyState: wsRef.current?.readyState,
        reason: !enabled ? 'not enabled' : isUnmountingRef.current ? 'unmounting' : 'already open'
      })
      return
    }

    // Clean up any existing connection
    if (wsRef.current) {
      isIntentionallyClosingRef.current = true
      try {
        if (wsRef.current.readyState !== WebSocket.CLOSED && wsRef.current.readyState !== WebSocket.CLOSING) {
          wsRef.current.close(1000)
        }
      } catch (e) {
        // Ignore close errors
      }
      wsRef.current = null
      setTimeout(() => {
        isIntentionallyClosingRef.current = false
      }, 100)
    }

    try {
      // Don't create new connection if we're unmounting
      if (isUnmountingRef.current) {
        return
      }
      
      // Remove only trailing slash, keep /ws path (gateway-ws requires it)
      const cleanUrl = url.replace(/\/$/, '')
      console.log('🔌 [useWebSocket] Attempting to connect to:', cleanUrl)
      console.log('🔌 [useWebSocket] Original URL:', url)
      console.log('🔌 [useWebSocket] Cleaned URL:', cleanUrl)
      console.log('🔌 [useWebSocket] enabled:', enabled, '| isUnmounting:', isUnmountingRef.current)
      const ws = new WebSocket(cleanUrl)
      // Set ref immediately
      wsRef.current = ws
      console.log('🔌 [useWebSocket] WebSocket created and ref set:', !!wsRef.current, '| ReadyState:', ws.readyState)

      ws.onopen = () => {
        console.log('🔌 [useWebSocket] WebSocket onopen event fired | ReadyState:', ws.readyState)
        // Ensure ref is set (defensive check)
        if (!wsRef.current) {
          console.log('🔌 [useWebSocket] Setting wsRef.current in onopen handler')
          wsRef.current = ws
        }
        console.log('🔌 [useWebSocket] wsRef.current in onopen:', !!wsRef.current, '| ReadyState:', wsRef.current?.readyState)
        
        // Authenticate first if we have a token (for ws-gateway)
        // Get token from auth store
        const authState = useAuthStore.getState()
        const token = authState.accessToken
        
        if (token) {
          console.log('🔐 [useWebSocket] Authenticating with token from store...')
          try {
            ws.send(JSON.stringify({
              type: 'auth',
              token: token,
            }))
            console.log('✅ [useWebSocket] Auth message sent')
          } catch (error) {
            console.error('❌ [useWebSocket] Failed to send auth message:', error)
          }
        } else {
          // Fallback to localStorage
          const localToken = localStorage.getItem('token') || sessionStorage.getItem('token')
          if (localToken) {
            console.log('🔐 [useWebSocket] Authenticating with token from localStorage...')
            try {
              ws.send(JSON.stringify({
                type: 'auth',
                token: localToken,
              }))
              console.log('✅ [useWebSocket] Auth message sent')
            } catch (error) {
              console.error('❌ [useWebSocket] Failed to send auth message:', error)
            }
          } else {
            console.warn('⚠️ [useWebSocket] No token found in store or localStorage, skipping authentication')
          }
        }
        
        // Set connected immediately - WebSocket is ready
        setIsConnected(true)
        isAuthenticatedRef.current = false // Reset auth state
        console.log('✅ [useWebSocket] Connection state set to true | ReadyState:', ws.readyState)
        // Don't call onOpen here - wait for auth_success message
      }

      ws.onmessage = (event) => {
        console.log('📨 [useWebSocket] Raw WebSocket message received. Type:', typeof event.data, '| Length:', event.data?.length || 0)
        console.log('📨 [useWebSocket] Raw message data (first 200 chars):', typeof event.data === 'string' ? event.data.substring(0, 200) : String(event.data).substring(0, 200))
        
        try {
          const data = JSON.parse(event.data)
          console.log('📨 [useWebSocket] Parsed JSON message:', data)
          console.log('📨 [useWebSocket] Message type:', data.type, '| Symbol:', data.symbol, '| Has bid:', data.bid !== undefined, '| Has ask:', data.ask !== undefined)
          
          // Handle error messages from server
          if (data.error) {
            console.warn('⚠️ [useWebSocket] Server error:', data.error, '| Code:', data.code)
            // Don't return - might still process if it has price data
          }
          
          // Handle auth success
          if (data.type === 'auth_success') {
            console.log('✅ [useWebSocket] Authentication successful:', data)
            isAuthenticatedRef.current = true
            setIsConnected(true) // Ensure connected state is set
            // Trigger onOpen callback after successful auth so subscriptions can happen
            setTimeout(() => {
              console.log('🔌 [useWebSocket] Calling onOpen after auth success')
              onOpen?.()
            }, 200) // Increased delay to ensure state is stable
            return
          }
          
          // Handle auth error
          if (data.type === 'auth_error') {
            console.error('❌ [useWebSocket] Authentication failed:', (data as any).error)
            isAuthenticatedRef.current = false
            // Don't return - might still receive messages
          }
          
          // Handle welcome message
          if (data.type === 'welcome' || (data.message && !data.error)) {
            console.log('👋 [useWebSocket]', data.message || 'Welcome message received')
            return
          }
          
          // Handle subscribed confirmation
          if (data.type === 'subscribed') {
            console.log('✅ [useWebSocket] Subscription confirmed for symbols:', (data as any).symbols)
            return
          }
          
          // Handle price ticks - server sends: {"type": "tick", "symbol": "BTCUSDT", "bid": ..., "ask": ..., "ts": ...}
          // Check for type === 'tick' and that bid/ask are defined (not null/undefined, but can be 0)
          if (data.type === 'tick' && data.symbol && data.bid !== undefined && data.bid !== null && data.ask !== undefined && data.ask !== null) {
            const symbolUpper = data.symbol.toUpperCase().trim() // Ensure uppercase to match subscription
            console.log(`💰 [useWebSocket] Processing price tick for ${symbolUpper}: bid=${data.bid} (type: ${typeof data.bid}), ask=${data.ask} (type: ${typeof data.ask})`)
            console.log(`💰 [useWebSocket] Full tick data:`, JSON.stringify(data))
            console.log(`💰 [useWebSocket] Calling onMessage callback. onMessage exists:`, typeof onMessage === 'function')
            if (onMessage) {
              onMessage({
                symbol: symbolUpper,
                bid: String(data.bid),
                ask: String(data.ask),
                ts: data.ts || Date.now(),
              })
              console.log(`✅ [useWebSocket] onMessage callback executed for ${symbolUpper}`)
            } else {
              console.error(`❌ [useWebSocket] onMessage callback is not defined!`)
            }
          } else if (data.symbol && data.bid !== undefined && data.bid !== null && data.ask !== undefined && data.ask !== null && !data.type && !data.error) {
            // Fallback: direct format without type field (and no error)
            const symbolUpper = data.symbol.toUpperCase()
            console.log(`💰 [useWebSocket] Processing price (no type) for ${symbolUpper}: bid=${data.bid}, ask=${data.ask}`)
            if (onMessage) {
              onMessage({
                symbol: symbolUpper,
                bid: String(data.bid),
                ask: String(data.ask),
                ts: data.ts || Date.now(),
              })
              console.log(`✅ [useWebSocket] onMessage callback executed (fallback) for ${symbolUpper}`)
            }
          } else {
            // Log all non-price messages for debugging
            console.log('⚠️ [useWebSocket] Received message but not a price tick:', {
              type: data.type,
              symbol: data.symbol,
              hasBid: data.bid !== undefined,
              hasAsk: data.ask !== undefined,
              error: data.error,
              fullData: data
            })
          }
          // Ignore other non-price messages
        } catch (error) {
          console.error('❌ [useWebSocket] Error parsing WebSocket message:', error)
          console.error('❌ [useWebSocket] Raw message that failed to parse:', event.data)
          console.error('❌ [useWebSocket] Error stack:', error instanceof Error ? error.stack : 'No stack trace')
        }
      }

      ws.onerror = (error) => {
        // Suppress errors during intentional close (React strict mode cleanup)
        if (isIntentionallyClosingRef.current) {
          return
        }
        // Suppress connection errors - they're expected during reconnection
        // Only call custom error handler if provided
        if (onError) {
          onError(error)
        }
        // Don't log to console to avoid spam during reconnection attempts
      }

      ws.onclose = (event) => {
        console.log('🔌 [useWebSocket] WebSocket onclose event fired:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          shouldReconnect: shouldReconnectRef.current,
          enabled,
          isIntentionallyClosing: isIntentionallyClosingRef.current,
          isUnmounting: isUnmountingRef.current,
        })
        setIsConnected(false)
        console.log('❌ [useWebSocket] Connection state set to false')
        onClose?.()

        // Only reconnect if it wasn't a manual close (code 1000)
        if (shouldReconnectRef.current && enabled && event.code !== 1000) {
          console.log('🔄 [useWebSocket] Scheduling reconnection in', reconnectInterval, 'ms')
          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, reconnectInterval)
        } else {
          console.log('⏸️ [useWebSocket] Not reconnecting:', {
            shouldReconnect: shouldReconnectRef.current,
            enabled,
            code: event.code,
          })
        }
      }
    } catch (error) {
      // Suppress connection errors during normal reconnection flow
      if (onError) {
        onError(error as Event)
      }
      if (shouldReconnectRef.current && enabled) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect()
        }, reconnectInterval)
      }
    }
  }, [url, onMessage, onError, onOpen, onClose, reconnectInterval, enabled])

  const disconnect = useCallback(() => {
    isUnmountingRef.current = true
    shouldReconnectRef.current = false
    isIntentionallyClosingRef.current = true
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    
    if (wsRef.current) {
      // Only close if not already closed
      const readyState = wsRef.current.readyState
      if (readyState !== WebSocket.CLOSED && readyState !== WebSocket.CLOSING) {
        try {
          // Remove error handler to prevent error events during close
          wsRef.current.onerror = null
          
          // If WebSocket is still connecting, wait a bit before closing
          if (readyState === WebSocket.CONNECTING) {
            // Set a timeout to close after connection attempt
            setTimeout(() => {
              if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
                try {
                  wsRef.current.close(1000)
                } catch (e) {
                  // Ignore
                }
              }
            }, 10)
          } else {
            // WebSocket is OPEN, safe to close immediately
            wsRef.current.close(1000) // Normal closure
          }
        } catch (e) {
          // Ignore close errors
        }
      }
      wsRef.current = null
    }
    
    setIsConnected(false)
    
    // Reset flags after a short delay
    setTimeout(() => {
      isIntentionallyClosingRef.current = false
      isUnmountingRef.current = false
    }, 200)
  }, [])

  const subscribe = useCallback(
    (symbols: string[]) => {
      // Filter out empty symbols
      const validSymbols = symbols.filter(s => s && s.length > 0)
      
      if (validSymbols.length === 0) {
        console.warn('⚠️ Cannot subscribe: No valid symbols provided')
        return false
      }
      
      // Get current WebSocket from ref (always access fresh)
      const ws = wsRef.current
      console.log('🔍 subscribe() called with:', validSymbols, '| ws exists:', !!ws, '| readyState:', ws?.readyState, '| authenticated:', isAuthenticatedRef.current)
      
      if (!ws) {
        console.warn('⚠️ Cannot subscribe: WebSocket is null')
        return false
      }
      
      const readyState = ws.readyState
      if (readyState !== WebSocket.OPEN) {
        console.warn('⚠️ Cannot subscribe: WebSocket not OPEN', {
          readyState,
          readyStateName: readyState === WebSocket.OPEN ? 'OPEN' : 
                         readyState === WebSocket.CONNECTING ? 'CONNECTING' :
                         readyState === WebSocket.CLOSING ? 'CLOSING' :
                         readyState === WebSocket.CLOSED ? 'CLOSED' : 'UNKNOWN',
        })
        return false
      }
      
      // Check if authenticated (ws-gateway requires auth before subscribe)
      if (!isAuthenticatedRef.current) {
        console.warn('⚠️ Cannot subscribe: Not authenticated yet. Waiting for auth_success...')
        // Retry after a short delay - use a longer delay to ensure auth completes
        setTimeout(() => {
          if (isAuthenticatedRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
            console.log('🔄 Retrying subscription after authentication...')
            subscribe(validSymbols)
          } else {
            console.warn('⚠️ Still not authenticated or WebSocket not open. Auth state:', isAuthenticatedRef.current, '| WS state:', wsRef.current?.readyState)
          }
        }, 1000) // Increased delay to 1 second
        return false
      }
      
      const subscribeMsg = {
        type: 'subscribe',
        symbols: validSymbols,
        channels: ['tick'], // Subscribe to price tick channel (valid channels: "tick", "positions", "orders", "risk")
      }
      const msgStr = JSON.stringify(subscribeMsg)
      console.log('📤 [SUBSCRIBE] Preparing to send subscription message:', msgStr)
      console.log('📤 [SUBSCRIBE] WebSocket state:', {
        exists: !!ws,
        readyState: ws.readyState,
        readyStateName: ws.readyState === WebSocket.OPEN ? 'OPEN' : 
                       ws.readyState === WebSocket.CONNECTING ? 'CONNECTING' :
                       ws.readyState === WebSocket.CLOSING ? 'CLOSING' :
                       ws.readyState === WebSocket.CLOSED ? 'CLOSED' : 'UNKNOWN',
      })
      
      try {
        // Data provider uses "action" instead of "type"
        ws.send(msgStr)
        console.log('✅ [SUBSCRIBE] Subscription message SENT successfully for:', validSymbols)
        console.log('✅ [SUBSCRIBE] Message length:', msgStr.length, 'bytes')
        return true
      } catch (error) {
        console.error('❌ [SUBSCRIBE] Error sending subscription message:', error)
        return false
      }
    },
    [] // Empty deps - refs are stable and mutable
  )

  const unsubscribe = useCallback((symbols: string[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && symbols.length > 0) {
      wsRef.current.send(
        JSON.stringify({
          type: 'unsubscribe',
          symbols,
        })
      )
    }
  }, [])

  useEffect(() => {
    console.log('🔌 [useWebSocket] useEffect triggered. enabled:', enabled, '| url:', url)
    if (enabled) {
      console.log('🔌 [useWebSocket] enabled=true, calling connect()...')
      connect()
    } else {
      console.log('🔌 [useWebSocket] enabled=false, calling disconnect()...')
      disconnect()
    }

    return () => {
      // Only disconnect if we're actually unmounting (not just React Strict Mode cleanup)
      // Check if enabled is still true - if so, this is likely React Strict Mode cleanup
      // and we should let the next effect handle reconnection
      if (!enabled) {
        console.log('🔌 [useWebSocket] cleanup: calling disconnect() (enabled=false)...')
        disconnect()
      } else {
        console.log('🔌 [useWebSocket] cleanup: skipping disconnect (enabled=true, likely React Strict Mode)...')
        // Just mark that we're cleaning up, but don't close the connection
        // The next effect will handle reconnection if needed
      }
    }
  }, [enabled, connect, disconnect, url])

  return {
    isConnected,
    subscribe,
    unsubscribe,
    connect,
    disconnect,
  }
}

