/**
 * Browser URL for ws-gateway (`/ws` + `group` query).
 *
 * - **Production:** same origin as the SPA (nginx proxies `/ws` → ws-gateway).
 * - **Dev (Vite):** connect straight to ws-gateway on 127.0.0.1:3003. The Vite `/ws` proxy
 *   often fails WebSocket upgrades to `ws://` targets; same-origin `5173/ws` then errors in the console.
 *
 * Override anytime: `VITE_WS_URL=ws://127.0.0.1:3003/ws?group=default` (or your port).
 */
export function getWsGatewayUrl(): string {
  const fromEnv = import.meta.env?.VITE_WS_URL
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.trim()
  }
  if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_WS_PORT
    const p = typeof port === 'string' && /^\d+$/.test(port) ? port : '3003'
    return `ws://127.0.0.1:${p}/ws?group=default`
  }
  if (typeof location !== 'undefined') {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${location.host}/ws?group=default`
  }
  return 'ws://127.0.0.1:3003/ws?group=default'
}
