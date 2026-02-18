import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // /ws-health must come before /ws so GET /ws-health is not matched by /ws (which would send it to the WS server and 404)
      '/ws-health': {
        target: 'http://localhost:9002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ws-health/, '/health'),
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3003',
        ws: true,
      },
    },
  },
})

