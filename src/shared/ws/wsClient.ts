import { WsInboundEvent, WsOutboundEvent } from './wsEvents'
import { useAuthStore } from '@/shared/store/auth.store'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated'

type MessageHandler = (event: WsInboundEvent) => void

class WebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private state: ConnectionState = 'disconnected'
  private handlers: Set<MessageHandler> = new Set()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 50
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private messageQueue: WsOutboundEvent[] = []
  private shouldReconnect = true
  private stateListeners: Set<(state: ConnectionState) => void> = new Set()
  private isAuthenticated = false
  /** Retries after server sends auth_error (e.g. expired JWT). */
  private authErrorRetries = 0
  private static readonly MAX_AUTH_ERROR_RETRIES = 8

  constructor(url: string) {
    this.url = url
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    if (this.state === 'connecting') {
      return
    }

    this.setState('connecting')

    try {
      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        console.log('🔌 WebSocket opened, authenticating...')
        this.setState('connected')
        this.reconnectAttempts = 0
        // Small delay to ensure connection is fully established; then ensure valid token (refresh if expired) and auth
        setTimeout(() => {
          this.authenticateAsync()
        }, 100)
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WsInboundEvent
          const msgType = (data as Record<string, unknown>).type ?? '(no type)'
          console.log('[wsClient] Message type:', msgType)
          if (msgType === 'chat.message' || msgType === 'chat_message') {
            console.log('[wsClient] ✅ CHAT MESSAGE received:', (data as Record<string, unknown>).payload)
          }

          // Handle authentication responses
          if (data.type === 'auth_success') {
            this.authErrorRetries = 0
            this.isAuthenticated = true
            this.setState('authenticated')
            this.flushMessageQueue()
            console.log('✅ WebSocket authenticated')
            
            // Auto-subscribe to channels based on user role
            const authState = useAuthStore.getState()
            const user = authState.user
            if (user && this.ws?.readyState === WebSocket.OPEN) {
              // Increased delay to ensure connection is fully ready
              setTimeout(() => {
                if (this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated) {
                  if (user.role === 'admin') {
                    // Subscribe to deposits, notifications, and support chat for admin users
                    this.ws.send(JSON.stringify({
                      type: 'subscribe',
                      channels: ['deposits', 'notifications', 'support'],
                      symbols: []
                    }))
                    console.log('📡 Auto-subscribed admin to deposits, notifications, and support channels')
                  } else {
                    // Subscribe to balances and wallet updates for regular users
                    // Note: Wallet balance updates are sent to all authenticated connections,
                    // but subscribing helps ensure we receive all updates
                    const subscribeMsg = {
                      type: 'subscribe',
                      channels: ['balances', 'wallet'],
                      symbols: []
                    }
                    try {
                      this.ws.send(JSON.stringify(subscribeMsg))
                      console.log('📡 [wsClient] Auto-subscribed user to balances and wallet channels:', subscribeMsg)
                    } catch (error) {
                      console.error('❌ [wsClient] Failed to send subscription:', error)
                    }
                  }
                } else {
                  console.warn('⚠️ [wsClient] WebSocket not ready for subscription, state:', this.ws?.readyState, 'authenticated:', this.isAuthenticated)
                }
              }, 500) // Increased from 200ms to 500ms for better reliability
            }
          } else if (data.type === 'auth_error') {
            this.isAuthenticated = false
            console.error('❌ WebSocket authentication failed:', (data as any).error)
            if (this.authErrorRetries < WebSocketClient.MAX_AUTH_ERROR_RETRIES) {
              this.authErrorRetries++
              void useAuthStore
                .getState()
                .ensureValidAccessToken()
                .then((t) => {
                  if (!t || this.ws?.readyState !== WebSocket.OPEN) return
                  const raw = WebSocketClient.rawToken(t)
                  this.ws?.send(JSON.stringify({ type: 'auth', token: raw }))
                })
                .catch(() => {})
            }
          }
          
          // Log all messages for debugging (filter important ones)
          if (data.type === 'wallet.balance.updated' || data.type === 'deposit.request.approved' || data.type === 'auth_success') {
            console.log('📨 [wsClient] Received message:', data.type, data)
          }
          const payload = (data as Record<string, unknown>).payload ?? data
          const isChatShape =
            payload &&
            typeof payload === 'object' &&
            'userId' in payload &&
            'body' in payload
          const dataType = (data as { type: string }).type
          if (isChatShape && dataType !== 'chat.message' && dataType !== 'chat_message') {
            console.log('📨 [wsClient] Chat-shaped message (unexpected type):', data.type, payload)
          }
          if (data.type === 'chat.message') {
            console.log('📨 [wsClient] Chat message payload:', (data as { type: string; payload?: unknown }).payload)
          }
          if (data.type === 'error') {
            console.warn('⚠️ [wsClient] Server sent error:', (data as { type: string; message?: string }).message)
          }
          if (data.type === 'tick') {
            console.log('📨 [wsClient] Tick received:', (data as any).symbol, 'handlers=', this.handlers.size)
          }
          
          // Log wallet balance updates with more detail
          if (data.type === 'wallet.balance.updated') {
            console.log('💰 [wsClient] Wallet balance update received:', {
              type: data.type,
              payload: (data as any).payload,
              handlerCount: this.handlers.size,
              isAuthenticated: this.isAuthenticated,
              state: this.state
            })
          }
          
          console.log(`📨 [wsClient] Dispatching to ${this.handlers.size} handler(s) for event type: ${data.type}`)
          Array.from(this.handlers).forEach((handler, index) => {
            try {
              console.log(`📨 [wsClient] Calling handler ${index + 1}/${this.handlers.size} for ${data.type}`)
              handler(data)
              console.log(`✅ [wsClient] Handler ${index + 1} completed for ${data.type}`)
            } catch (error) {
              console.error(`❌ [wsClient] Error in handler ${index + 1} for ${data.type}:`, error)
            }
          })
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error)
        }
      }

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error)
      }

      this.ws.onclose = () => {
        this.isAuthenticated = false
        this.setState('disconnected')
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect()
        }
      }
    } catch (error) {
      console.error('Failed to create WebSocket:', error)
      this.setState('disconnected')
      this.scheduleReconnect()
    }
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.setState('disconnected')
  }

  send(event: WsOutboundEvent): void {
    // Allow auth messages even if not authenticated
    if (event.type === 'auth') {
      if (this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify(event))
        } catch (error) {
          console.error('Failed to send auth message:', error)
        }
      }
      return
    }
    
    // Allow subscribe/unsubscribe messages if authenticated
    if (event.type === 'subscribe' || event.type === 'unsubscribe') {
      if (this.isAuthenticated && this.state === 'authenticated' && this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify(event))
        } catch (error) {
          console.error('Failed to send subscribe/unsubscribe message:', error)
          this.messageQueue.push(event)
        }
      } else {
        this.messageQueue.push(event)
        if (this.state === 'disconnected') {
          this.connect()
        }
      }
      return
    }
    
    // For other messages, require authentication
    if (this.isAuthenticated && this.state === 'authenticated' && this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(event))
      } catch (error) {
        console.error('Failed to send WebSocket message:', error)
        this.messageQueue.push(event)
      }
    } else {
      this.messageQueue.push(event)
      if (this.state === 'disconnected') {
        this.connect()
      }
    }
  }

  // Send subscribe/unsubscribe messages
  sendSubscribe(symbols: string[], channels: string[] = []): void {
    this.send({ type: 'subscribe', symbols, channels })
  }

  sendUnsubscribe(symbols: string[]): void {
    this.send({ type: 'unsubscribe', symbols })
  }

  subscribe(handler: MessageHandler): () => void {
    console.log('📝 [wsClient] Adding handler, current count:', this.handlers.size)
    this.handlers.add(handler)
    console.log('📝 [wsClient] Handler added, new count:', this.handlers.size)
    return () => {
      console.log('📝 [wsClient] Removing handler, current count:', this.handlers.size)
      this.handlers.delete(handler)
      console.log('📝 [wsClient] Handler removed, new count:', this.handlers.size)
    }
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  getState(): ConnectionState {
    return this.state
  }

  isConnected(): boolean {
    return this.isAuthenticated && this.state === 'authenticated' && this.ws?.readyState === WebSocket.OPEN
  }

  /** Strip "Bearer " prefix so ws-gateway receives raw JWT. */
  private static rawToken(t: string): string {
    return t.replace(/^\s*Bearer\s+/i, '').trim()
  }

  /** Ensure token valid (refresh if expired/expiring), then send auth. Used on connect/reconnect. */
  private async authenticateAsync(): Promise<void> {
    const token = await useAuthStore.getState().ensureValidAccessToken()
    if (!token) {
      console.warn('⚠️ No access token available for WebSocket authentication')
      return
    }
    const raw = WebSocketClient.rawToken(token)
    if (this.state !== 'connected' || this.ws?.readyState !== WebSocket.OPEN) return
    console.log('🔐 Sending auth message with token:', raw.substring(0, 20) + '...')
    this.ws.send(JSON.stringify({ type: 'auth', token: raw }))
  }

  /** Re-send auth with current (valid) token. Call after HTTP layer refreshes token so WS stays valid. */
  async reauthenticate(): Promise<void> {
    const token = await useAuthStore.getState().ensureValidAccessToken()
    if (!token || this.ws?.readyState !== WebSocket.OPEN) return
    const raw = WebSocketClient.rawToken(token)
    this.ws.send(JSON.stringify({ type: 'auth', token: raw }))
  }


  private setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState
      this.stateListeners.forEach((listener) => listener(newState))
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++

    this.reconnectTimeout = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.isConnected()) {
      const message = this.messageQueue.shift()
      if (message) {
        try {
          this.ws?.send(JSON.stringify(message))
        } catch (error) {
          console.error('Failed to send queued message:', error)
          this.messageQueue.unshift(message)
          break
        }
      }
    }
  }
}

// Singleton instance
// @ts-ignore - Vite env types
// Use same-origin in browser (dev: Vite proxies /ws; production: nginx proxies /ws). Use wss when page is HTTPS.
const WS_URL =
  import.meta.env?.VITE_WS_URL ||
  (typeof location !== 'undefined'
    ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?group=default`
    : 'ws://localhost:3003/ws?group=default')
export const wsClient = new WebSocketClient(WS_URL)

// Auto-connect on import (lazy) - but only if user is already logged in
if (typeof window !== 'undefined') {
  // Check if user is already logged in before auto-connecting
  const authState = useAuthStore.getState()
  if (authState.accessToken && authState.user) {
    wsClient.connect()
  }
}

