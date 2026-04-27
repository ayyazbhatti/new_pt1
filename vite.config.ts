import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import http from 'node:http'
import dns from 'node:dns'
import type { Connect } from 'vite'

// Prefer IPv4 so localhost resolves to 127.0.0.1 and avoids ERR_ADDRESS_INVALID (Chrome + IPv6 ::1).
dns.setDefaultResultOrder('ipv4first')

const API_TARGET = 'http://127.0.0.1:3000'
const PROXY_TIMEOUT_MS = 20_000

/**
 * Custom API proxy middleware using Node's http. Forwards /api and /v1 to auth-service.
 * Avoids the default proxy (which can leave requests pending in some environments).
 */
function apiProxyMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!req || !res) return next?.()
    const rawUrl = req.url ?? ''
    const pathname = rawUrl.split('?')[0]
    const search = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : ''
    const pathOnly = pathname.startsWith('http') ? new URL(pathname).pathname : pathname
    const isApi = pathOnly.startsWith('/api') || pathOnly.startsWith('/v1')
    if (!isApi) return next()

    // Always proxy to API_TARGET using path only (req.url can be full URL in some setups)
    const targetUrl = new URL(pathOnly + search, API_TARGET)
    const headers = { ...req.headers } as Record<string, string>
    headers.host = targetUrl.host

    const proxyReq = http.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || 80,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers,
        timeout: PROXY_TIMEOUT_MS,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 500, proxyRes.headers)
        proxyRes.pipe(res, { end: true })
      }
    )

    proxyReq.on('error', (err) => {
      console.error('[vite api proxy]', err.message, rawUrl)
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Proxy error: ' + err.message } }))
      }
    })
    proxyReq.on('timeout', () => {
      proxyReq.destroy()
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Gateway timeout' } }))
      }
    })

    req.pipe(proxyReq, { end: true })
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-proxy',
      // Return middleware so Vite prepends it; /api and /v1 are proxied before SPA/404.
      configureServer() {
        return apiProxyMiddleware()
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Use 127.0.0.1 to avoid ERR_ADDRESS_INVALID when Chrome resolves localhost to IPv6 (::1).
    host: '127.0.0.1',
    port: 5173,
    // Fix HMR WebSocket URL: with host set, the client can get port=undefined → ws://127.0.0.1:undefined/. Set hmr explicitly.
    hmr: {
      host: '127.0.0.1',
      port: 5173,
      protocol: 'ws',
    },
    // For access from other devices use the Network URL or a tunnel (e.g. ngrok). For mic/permissions use HTTP.
    proxy: {
      // API: forwarded first so /api and /v1 never hit SPA fallback (avoids 404 for bulk, etc.)
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/v1': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      // /ws-health must come before /ws so GET /ws-health is not matched by /ws
      // ws-gateway: WebSocket on WS_PORT (3003), health on HTTP_PORT (9002)
      '/ws-health': {
        target: 'http://127.0.0.1:9002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ws-health/, '/health'),
      },
      '/ws': {
        target: 'ws://127.0.0.1:3003',
        ws: true,
      },
      // data-provider HTTP (chart MMDPS history, /prices) — matches production nginx `/dp/`
      '/dp': {
        target: 'http://127.0.0.1:9004',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dp/, '') || '/',
      },
    },
  },
})

