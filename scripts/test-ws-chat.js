#!/usr/bin/env node
/**
 * Test WebSocket connection for real-time chat.
 * Logs every message so we can see if chat.message arrives.
 *
 * Usage:
 *   CHAT_TEST_JWT="<your JWT>" node scripts/test-ws-chat.js
 *   CHAT_TEST_JWT="<JWT>" CHAT_TEST_WS_URL="ws://localhost:5173/ws?group=default" node scripts/test-ws-chat.js
 *
 * Then in another terminal (or the app) send a chat message:
 *   curl -X POST http://localhost:3000/v1/users/me/chat -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" -d '{"message":"test"}'
 *
 * You should see a WebSocket frame with type "chat.message" if the pipeline works.
 */

import WebSocket from 'ws'

const JWT = process.env.CHAT_TEST_JWT || process.argv[2]
const WS_URL = process.env.CHAT_TEST_WS_URL || 'ws://localhost:3003/ws?group=default'

if (!JWT) {
  console.error('Usage: CHAT_TEST_JWT="<jwt>" node scripts/test-ws-chat.js')
  console.error('   or: node scripts/test-ws-chat.js "<jwt>"')
  console.error('Optional: CHAT_TEST_WS_URL="ws://localhost:5173/ws?group=default"')
  process.exit(1)
}

console.log('Connecting to', WS_URL)
const ws = new WebSocket(WS_URL)

ws.on('open', () => {
  console.log('[OPEN] Connected. Sending auth...')
  ws.send(JSON.stringify({ type: 'auth', token: JWT }))
})

ws.on('message', (data) => {
  const raw = data.toString()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.log('[MSG] (not JSON)', raw.slice(0, 100))
    return
  }
  const type = parsed.type ?? '(no type)'
  const ts = new Date().toISOString().split('T')[1].slice(0, 12)
  console.log(`[${ts}] type: ${type}`)
  if (type === 'chat.message' || type === 'chat_message') {
    console.log('       ^^^ CHAT MESSAGE RECEIVED ^^^', JSON.stringify(parsed.payload))
  }
  if (type === 'auth_success') {
    console.log('[AUTH] Success. Subscribing to support channel for chat...')
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['deposits', 'notifications', 'support'], symbols: [] }))
  }
  if (type === 'auth_error') {
    console.error('[AUTH] Error:', parsed.error)
  }
})

ws.on('error', (err) => {
  console.error('[WS ERROR]', err.message)
})

ws.on('close', (code, reason) => {
  console.log('[CLOSE]', code, reason?.toString() || '')
  process.exit(0)
})

// Keep process alive
process.on('SIGINT', () => {
  ws.close()
})
