/**
 * WebSocket client for live prices.
 * - Gateway (e.g. port 3003): expects type 'subscribe' + auth. Set token via setAuthToken().
 * - Data-provider (e.g. VITE_DATA_PROVIDER_WS_URL): expects action 'subscribe', no auth.
 */
const DEFAULT_PRICE_WS_URL = 'ws://localhost:3003/ws'

export interface PriceTick {
  symbol: string
  bid: string
  ask: string
  ts: number
}

type TickListener = (tick: PriceTick) => void

/** True when URL is likely the gateway (3003). Use gateway protocol (type + auth). */
function isGatewayUrl(url: string): boolean {
  return /[:/]3003[/?]/.test(url) || url.includes('localhost:3003')
}

class PriceStreamClient {
  private ws: WebSocket | null = null
  private url: string
  private authToken: string | null = null
  private authenticated = false
  private listeners = new Set<TickListener>()
  private reconnectAttempts = 0
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private pendingSymbols: string[] = []
  private subscribedSymbols = new Set<string>()

  constructor(url?: string) {
    this.url = url ?? (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_DATA_PROVIDER_WS_URL) ?? DEFAULT_PRICE_WS_URL
  }

  setAuthToken(token: string | null): void {
    this.authToken = token
    if (!token) {
      this.authenticated = false
      return
    }
    if (isGatewayUrl(this.url) && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'auth', token }))
    }
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return
    if (this.ws?.readyState === WebSocket.CONNECTING) return

    const gatewayMode = isGatewayUrl(this.url)
    try {
      this.ws = new WebSocket(this.url)
      this.ws.onopen = () => {
        this.reconnectAttempts = 0
        this.authenticated = !gatewayMode
        if (gatewayMode && this.authToken) {
          this.ws?.send(JSON.stringify({ type: 'auth', token: this.authToken }))
        } else if (!gatewayMode && this.pendingSymbols.length > 0) {
          this.sendSubscribe(this.pendingSymbols)
        }
      }
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string)
          if (data.type === 'auth_success') {
            this.authenticated = true
            if (this.pendingSymbols.length > 0) {
              this.sendSubscribe(this.pendingSymbols)
            }
          }
          if (data.type === 'tick' && data.symbol) {
            const bid = typeof data.bid === 'number' ? String(data.bid) : (data.bid ?? '')
            const ask = typeof data.ask === 'number' ? String(data.ask) : (data.ask ?? '')
            const tick: PriceTick = { symbol: data.symbol, bid, ask, ts: data.ts ?? 0 }
            this.listeners.forEach((fn) => {
              try { fn(tick) } catch (_) {}
            })
          }
        } catch (_) {}
      }
      this.ws.onerror = () => {}
      this.ws.onclose = () => {
        this.ws = null
        this.authenticated = false
        if (this.reconnectAttempts < 10) {
          this.reconnectAttempts++
          this.reconnectTimeout = setTimeout(() => this.connect(), Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000))
        }
      }
    } catch (_) {
      this.ws = null
    }
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.authenticated = false
    this.pendingSymbols = []
    this.subscribedSymbols.clear()
  }

  private sendSubscribe(symbols: string[]): void {
    const gatewayMode = isGatewayUrl(this.url)
    const payload = gatewayMode
      ? JSON.stringify({ type: 'subscribe', symbols, channels: [] })
      : JSON.stringify({ action: 'subscribe', symbols })
    if (this.ws?.readyState === WebSocket.OPEN && (gatewayMode ? this.authenticated : true)) {
      this.ws.send(payload)
      symbols.forEach((s) => this.subscribedSymbols.add(s.toUpperCase()))
    } else {
      this.pendingSymbols = [...new Set([...this.pendingSymbols, ...symbols])]
    }
  }

  subscribe(symbols: string[]): void {
    const upper = symbols.map((s) => s.toUpperCase().trim()).filter((s) => s.length > 0)
    if (upper.length === 0) return
    this.connect()
    this.sendSubscribe(upper)
  }

  unsubscribe(symbols: string[]): void {
    symbols.forEach((s) => this.subscribedSymbols.delete(s.toUpperCase()))
  }

  onTick(fn: TickListener): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

export const priceStreamClient = new PriceStreamClient()
