/**
 * Gateway WebSocket URL (per-group marked-up prices via JWT group_id).
 * Use this when the user is authenticated so they receive their group's markup.
 */
function getGatewayPriceWsUrl(): string {
  if (typeof location !== 'undefined') {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${location.host}/ws?group=default`
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

/** When set in `.env`, always use data-provider for ticks (not gateway), even if the user is logged in. */
function explicitDataProviderWsUrl(): string | null {
  const env = typeof import.meta !== 'undefined' && (import.meta as any).env
  const u = env?.VITE_DATA_PROVIDER_WS_URL
  if (typeof u === 'string' && u.trim().length > 0) return u.trim()
  return null
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
  if (typeof location !== 'undefined' && url.includes('/ws')) {
    const prefix = location.protocol === 'https:' ? 'wss://' : 'ws://'
    if (url.startsWith(prefix + location.host)) return true
  }
  return /[:/]8090[/?]/.test(url) || /[:/]3003[/?]/.test(url) || url.includes('localhost:8090') || url.includes('localhost:3003')
}

/**
 * True when the live WebSocket was opened to the same price endpoint we would use now (auth on/off can change target).
 * Prevents sending gateway `auth` to a data-provider socket or vice versa.
 */
function priceWsUrlsMatch(openWsUrl: string, targetUrl: string): boolean {
  try {
    const a = new URL(openWsUrl)
    const b = new URL(targetUrl)
    const normHost = (h: string) => (h === 'localhost' || h === '127.0.0.1' ? 'loopback' : h)
    const port = (u: URL) => u.port || (u.protocol === 'wss:' || u.protocol === 'https:' ? '443' : '80')
    return (
      a.protocol === b.protocol &&
      normHost(a.hostname) === normHost(b.hostname) &&
      port(a) === port(b) &&
      a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, '')
    )
  } catch {
    return openWsUrl === targetUrl
  }
}

/** Interval (ms) for sending ping to gateway to keep connection from being marked stale (server timeout default 300s). */
const PING_INTERVAL_MS = 60_000

/** HTTP base URL for data-provider (e.g. http://localhost:3001) for GET /prices snapshot. Empty if using gateway. */
export function getDataProviderPricesBaseUrl(): string {
  const env = typeof import.meta !== 'undefined' && (import.meta as any).env
  const httpUrl = env?.VITE_DATA_PROVIDER_HTTP_URL
  if (httpUrl && typeof httpUrl === 'string' && httpUrl.length > 0) return httpUrl.replace(/\/+$/, '')
  const wsUrl = env?.VITE_DATA_PROVIDER_WS_URL
  if (wsUrl && typeof wsUrl === 'string') {
    try {
      const u = new URL(wsUrl)
      const port = u.port || '3001'
      // backend/data-provider uses WS_PORT (default 9003) and HTTP_PORT (default 9004) on different ports.
      const httpPort =
        port === '9003' ? '9004' : port
      return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.hostname}:${httpPort}`
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
  private pingIntervalId: ReturnType<typeof setInterval> | null = null
  private pendingSymbols: string[] = []
  private subscribedSymbols = new Set<string>()
  /**
   * Gateway auth failed and we cannot obtain a valid JWT — stop reconnecting with the same stale token
   * until setAuthToken() delivers a new one (e.g. after refresh or re-login).
   */
  private priceStreamAuthPaused = false

  constructor(url?: string) {
    this.url = url ?? (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_DATA_PROVIDER_WS_URL) ?? getDefaultPriceWsUrl()
  }

  /** Strip "Bearer " prefix so ws-gateway receives raw JWT. */
  private static rawToken(t: string): string {
    return t.replace(/^\s*Bearer\s+/i, '').trim()
  }

  /** Refresh JWT via auth store, then send gateway auth (avoids ExpiredSignature on reconnect). */
  private async sendGatewayAuthWithFreshToken(): Promise<void> {
    const { useAuthStore } = await import('@/shared/store/auth.store')
    const raw = await useAuthStore.getState().ensureValidAccessToken()
    const token = raw ? PriceStreamClient.rawToken(raw) : null
    if (token) this.authToken = token
    if (this.ws?.readyState === WebSocket.OPEN && token) {
      this.ws.send(JSON.stringify({ type: 'auth', token }))
    }
  }

  setAuthToken(token: string | null): void {
    this.authToken = token ? PriceStreamClient.rawToken(token) : null
    if (!this.authToken) {
      this.authenticated = false
      this.priceStreamAuthPaused = false
      return
    }
    this.priceStreamAuthPaused = false
    const effectiveUrl = this.getEffectiveUrl()
    const wsState = this.ws?.readyState
    if (wsState === WebSocket.OPEN) {
      const openUrl = this.ws.url
      if (!priceWsUrlsMatch(openUrl, effectiveUrl)) {
        // e.g. switch between data-provider WS and same-origin gateway — reconnect, keep symbols
        this.pendingSymbols = [...new Set([...this.pendingSymbols, ...this.subscribedSymbols])]
        this.ws.close()
        return
      }
      if (isGatewayUrl(effectiveUrl)) {
        void this.sendGatewayAuthWithFreshToken()
      }
    } else if (wsState === undefined || wsState === WebSocket.CLOSED) {
      this.connect()
    }
  }

  /**
   * WebSocket URL for price ticks.
   * - **Logged in (`authToken` set):** always same-origin gateway — per-group marked-up prices (JWT `group_id`),
   *   aligned with order engine / positions. `VITE_DATA_PROVIDER_WS_URL` is ignored so the panel matches execution.
   * - **Logged out:** use `VITE_DATA_PROVIDER_WS_URL` when set (raw feed for dev/public), else `this.url` / default gateway.
   */
  private getEffectiveUrl(): string {
    if (this.authToken) {
      return getGatewayPriceWsUrl()
    }
    const dp = explicitDataProviderWsUrl()
    if (dp) return dp
    return this.url
  }

  /** Start sending ping every PING_INTERVAL_MS so gateway keeps connection alive (gateway only). */
  private startPingLoop(): void {
    this.stopPingLoop()
    if (!isGatewayUrl(this.getEffectiveUrl())) return
    this.pingIntervalId = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }))
        } catch (_) {}
      }
    }, PING_INTERVAL_MS)
  }

  /** Stop ping timer (on close or disconnect). */
  private stopPingLoop(): void {
    if (this.pingIntervalId !== null) {
      clearInterval(this.pingIntervalId)
      this.pingIntervalId = null
    }
  }

  connect(): void {
    if (this.priceStreamAuthPaused) return
    if (this.ws?.readyState === WebSocket.OPEN) return
    if (this.ws?.readyState === WebSocket.CONNECTING) return

    const urlToUse = this.getEffectiveUrl()
    const gatewayMode = isGatewayUrl(urlToUse)
    try {
      this.ws = new WebSocket(urlToUse)
      this.ws.onopen = () => {
        this.reconnectAttempts = 0
        this.authenticated = !gatewayMode
        if (gatewayMode) {
          void this.sendGatewayAuthWithFreshToken()
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
              const batch = [...this.pendingSymbols]
              this.pendingSymbols = []
              this.sendSubscribe(batch)
            }
            if (isGatewayUrl(this.getEffectiveUrl())) {
              this.startPingLoop()
            }
          }
          if (data.type === 'auth_error') {
            this.authenticated = false
            this.stopPingLoop()
            void (async () => {
              const { useAuthStore } = await import('@/shared/store/auth.store')
              const raw = await useAuthStore.getState().ensureValidAccessToken()
              const tok = raw ? PriceStreamClient.rawToken(raw) : null
              if (tok && this.ws?.readyState === WebSocket.OPEN && isGatewayUrl(this.getEffectiveUrl())) {
                this.authToken = tok
                this.ws.send(JSON.stringify({ type: 'auth', token: tok }))
                return
              }
              if (!tok && isGatewayUrl(this.getEffectiveUrl())) {
                this.priceStreamAuthPaused = true
                if (this.reconnectTimeout) {
                  clearTimeout(this.reconnectTimeout)
                  this.reconnectTimeout = null
                }
                try {
                  this.ws?.close()
                } catch (_) {}
              }
            })()
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
        this.stopPingLoop()
        this.ws = null
        this.authenticated = false
        // Preserve symbol list across reconnect (token-triggered close, network blip, etc.)
        this.pendingSymbols = [...new Set([...this.pendingSymbols, ...this.subscribedSymbols])]
        if (this.priceStreamAuthPaused) return
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
    this.stopPingLoop()
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
    this.priceStreamAuthPaused = false
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

  /**
   * Re-send subscribe after JWT is available or refreshed so the gateway applies symbol streams.
   * Safe to call when the symbol list is unchanged (idempotent on server).
   */
  resyncSymbolSubscriptions(symbols: string[]): void {
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

  /** True when ticks are allowed: data-provider mode on open socket, or gateway with auth_success. */
  isPriceStreamReady(): boolean {
    const url = this.getEffectiveUrl()
    if (!isGatewayUrl(url)) return this.ws?.readyState === WebSocket.OPEN
    return this.ws?.readyState === WebSocket.OPEN && this.authenticated
  }
}

export const priceStreamClient = new PriceStreamClient()
