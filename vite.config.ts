import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import http from 'node:http'
import type { Connect } from 'vite'

const API_TARGET = 'http://localhost:3000'
const PROXY_TIMEOUT_MS = 20_000

/**
 * Custom API proxy middleware using Node's http. Forwards /api and /v1 to auth-service.
 * Avoids the default proxy (which can leave requests pending in some environments).
 */
function apiProxyMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const rawUrl = req.url ?? ''
    const pathname = rawUrl.split('?')[0]
    const isApi = pathname.startsWith('/api') || pathname.startsWith('/v1')
    if (!isApi) return next()

    const targetUrl = new URL(rawUrl, API_TARGET)
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
      configureServer(server) {
        server.middlewares.use(apiProxyMiddleware())
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    // HTTP by default so Chrome works. On localhost the mic works over HTTP; for other devices use a tunnel (e.g. ngrok) or HTTPS proxy.
    proxy: {
      // /ws-health must come before /ws so GET /ws-health is not matched by /ws
      // ws-gateway: WebSocket on WS_PORT (3003), health on HTTP_PORT (9002)
      '/ws-health': {
        target: 'http://localhost:9002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ws-health/, '/health'),
      },
      '/ws': {
        target: 'ws://localhost:3003',
        ws: true,
      },
    },
  },
})

