#!/usr/bin/env node
/**
 * Test that NATS receives chat messages (run with: node scripts/test-chat-nats.js)
 * Requires: npm install nats (or use nats from repo if present)
 * Prereqs: NATS running (e.g. docker-compose up nats), gateway-ws running (so it's subscribed to chat.>)
 *
 * This script publishes one message to chat.support. You should see in gateway logs:
 *   [chat] NATS message received subject=chat.support size=...
 *   [chat] Forwarded chat.support to N session(s)
 */
const { connect } = require('nats')

const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222'

async function main() {
  console.log('Connecting to NATS at', NATS_URL)
  const nc = await connect({ servers: [NATS_URL] })
  const payload = JSON.stringify({
    type: 'chat.message',
    payload: {
      id: 'test-' + Date.now(),
      userId: '00000000-0000-0000-0000-000000000001',
      senderType: 'user',
      senderId: null,
      body: 'Test message from scripts/test-chat-nats.js',
      createdAt: new Date().toISOString(),
    },
  })
  nc.publish('chat.support', new TextEncoder().encode(payload))
  console.log('Published to chat.support. Check gateway-ws logs for "NATS message received" and "Forwarded".')
  await nc.flush()
  await nc.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
