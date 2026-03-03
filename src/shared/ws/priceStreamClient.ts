/**
 * Gateway WebSocket URL (per-group marked-up prices via JWT group_id).
 * Use this when the user is authenticated so they receive their group's markup.
 */
function getGatewayPriceWsUrl(): string {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV && typeof location !== 'undefined') {
    return `ws://${location.host}/ws?group=default`
  }
  return 'ws://localhost:3003/ws?group=default'
}

/**
 * Default URL: gateway when no env override; data-provider WS if VITE_DATA_PROVIDER_WS_URL is set (raw prices, no auth).
 */
function getDefaultPriceWsUrl(): string {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_DATA_PROVIDER_WS_URL) {
    return (import.meta as any).env.VITE_DATA_PROVIDER_WS_URL
  }
  return getGatewayPriceWsUrl()
}
export interface PriceTick {
  symbol: string
  bid: string
  ask: string
  ts: number
}

type TickListener = (tick: PriceTick) => void

/** True when URL is the gateway (port 8090/3003 or same-origin /ws proxy). Use gateway protocol (type + auth). */
function isGatewayUrl(url: string): boolean {
  return /[:/]8090[/?]/.test(url) || /[:/]3003[/?]/.test(url) || url.includes('localhost:8090') || url.includes('localhost:3003') || (url.includes('/ws') && typeof location !== 'undefined' && url.startsWith('ws://' + location.host))
}

/** HTTP base URL for data-provider (e.g. http://localhost:3001) for GET /prices snapshot. Empty if using gateway. */
export function getDataProviderPricesBaseUrl(): string {
  const env = typeof import.meta !== 'undefined' && (import.meta as any).env
  const httpUrl = env?.VITE_DATA_PROVIDER_HTTP_URL
  if (httpUrl && typeof httpUrl === 'string' && httpUrl.length > 0) return httpUrl.replace(/\/+$/, '')
  const wsUrl = env?.VITE_DATA_PROVIDER_WS_URL
  if (wsUrl && typeof wsUrl === 'string') {
    try {
      const u = new URL(wsUrl)
      // Data-provider serves HTTP and WS on the same port (e.g. 3001 in this project)
      const port = u.port || '3001'
      return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.hostname}:${port}`
    } catch {
      return 'http://localhost:3001'
    }
  }
  return ''
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
    this.url = url ?? (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_DATA_PROVIDER_WS_URL) ?? getDefaultPriceWsUrl()
  }

  setAuthToken(token: string | null): void {
    const hadToken = !!this.authToken
    this.authToken = token
    if (!token) {
      this.authenticated = false
      return
    }
    const effectiveUrl = this.getEffectiveUrl()
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (isGatewayUrl(effectiveUrl)) {
        this.ws.send(JSON.stringify({ type: 'auth', token: this.authToken }))
      } else if (!hadToken) {
        // Just got a token; reconnect to gateway so user gets marked-up prices
        this.disconnect()
      }
    }
  }

  /** When user has a token, use gateway URL so they get per-group (marked-up) prices. */
  private getEffectiveUrl(): string {
    return this.authToken ? getGatewayPriceWsUrl() : this.url
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return
    if (this.ws?.readyState === WebSocket.CONNECTING) return

    const urlToUse = this.getEffectiveUrl()
    const gatewayMode = isGatewayUrl(urlToUse)
    try {
      this.ws = new WebSocket(urlToUse)
      this.ws.onopen = () => {
        this.reconnectAttempts = 0
        this.authenticated = !gatewayMode
        if (gatewayMode && this.authToken) {
          this.ws?.send(JSON.stringify({ type: 'auth', token: this.authToken }))
        } else if (!gatewayMode) {
          // Re-subscribe all symbols so we get ticks after reconnect (server-side connection stays in sync)
          const all = [...new Set([...this.subscribedSymbols, ...this.pendingSymbols])]
          this.pendingSymbols = []
          if (all.length > 0) this.sendSubscribe(all)
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
        // Keep reconnecting so connection stays server-based and recovers from drops
        this.reconnectAttempts++
        const delay = Math.min(1000 * Math.pow(2, Math.min(this.reconnectAttempts, 6)), 15000)
        this.reconnectTimeout = setTimeout(() => this.connect(), delay)
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
    const gatewayMode = isGatewayUrl(this.getEffectiveUrl())
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
