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
  private maxReconnectAttempts = 10
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private messageQueue: WsOutboundEvent[] = []
  private shouldReconnect = true
  private stateListeners: Set<(state: ConnectionState) => void> = new Set()
  private isAuthenticated = false

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
        // Small delay to ensure connection is fully established
        setTimeout(() => {
          this.authenticate()
        }, 100)
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WsInboundEvent
          
          // Handle authentication responses
          if (data.type === 'auth_success') {
            this.isAuthenticated = true
            this.setState('authenticated')
            this.flushMessageQueue()
            console.log('✅ WebSocket authenticated')
            
            // Auto-subscribe to channels based on user role
            const authState = useAuthStore.getState()
            const user = authState.user
            if (user && this.ws?.readyState === WebSocket.OPEN) {
              setTimeout(() => {
                if (this.ws?.readyState === WebSocket.OPEN) {
                  if (user.role === 'admin') {
                    // Subscribe to deposits and notifications for admin users
                    this.ws.send(JSON.stringify({
                      type: 'subscribe',
                      channels: ['deposits', 'notifications'],
                      symbols: []
                    }))
                    console.log('📡 Auto-subscribed admin to deposits and notifications channels')
                  } else {
                    // Subscribe to balances and wallet updates for regular users
                    const subscribeMsg = {
                      type: 'subscribe',
                      channels: ['balances', 'wallet'],
                      symbols: []
                    }
                    this.ws.send(JSON.stringify(subscribeMsg))
                    console.log('📡 [wsClient] Auto-subscribed user to balances and wallet channels:', subscribeMsg)
                  }
                }
              }, 200)
            }
          } else if (data.type === 'auth_error') {
            this.isAuthenticated = false
            console.error('❌ WebSocket authentication failed:', (data as any).error)
            // Don't disconnect, but mark as unauthenticated
          }
          
          // Log all messages for debugging (filter important ones)
          if (data.type === 'wallet.balance.updated' || data.type === 'deposit.request.approved' || data.type === 'auth_success') {
            console.log('📨 [wsClient] Received message:', data.type, data)
          }
          
          this.handlers.forEach((handler) => {
            try {
              handler(data)
            } catch (error) {
              console.error('❌ [wsClient] Error in handler for', data.type, ':', error)
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

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
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

  private authenticate(): void {
    const authState = useAuthStore.getState()
    const token = authState.accessToken
    
    if (!token) {
      console.warn('⚠️ No access token available for WebSocket authentication')
      return
    }
    
    console.log('🔐 Sending auth message with token:', token.substring(0, 20) + '...')
    this.send({
      type: 'auth',
      token,
    })
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
// ws-gateway runs on port 3003 (default), data-provider on 9003
const WS_URL = import.meta.env?.VITE_WS_URL || 'ws://localhost:3003/ws?group=default'
export const wsClient = new WebSocketClient(WS_URL)

// Auto-connect on import (lazy)
if (typeof window !== 'undefined') {
  wsClient.connect()
}

