/**
 * One-off script to test real-time balance WebSocket for a user.
 * Usage: JWT_TOKEN=<token> node scripts/test-ws-balance.js
 *    or: node scripts/test-ws-balance.js <token>
 *
 * Tries ws://localhost:8090 first, then ws://localhost:3003.
 */

import WebSocket from 'ws';

const token = process.env.JWT_TOKEN || process.argv[2];
if (!token) {
  console.error('Usage: JWT_TOKEN=<token> node scripts/test-ws-balance.js');
  process.exit(1);
}

const urls = ['ws://localhost:8090/ws?group=default', 'ws://localhost:3003/ws?group=default'];

function run(url) {
  console.log('Connecting to', url, '...');
  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('Connected. Sending auth...');
    ws.send(JSON.stringify({ type: 'auth', token }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('\n[RECV]', msg.type || msg.op || '?', JSON.stringify(msg).slice(0, 200));
      if (msg.type === 'auth_success') {
        console.log('Auth OK. Subscribing to balances, wallet...');
        ws.send(JSON.stringify({ type: 'subscribe', symbols: [], channels: ['balances', 'wallet'] }));
      }
      if (msg.type === 'wallet.balance.updated') {
        console.log('\n*** BALANCE UPDATE ***', JSON.stringify(msg.payload, null, 2));
      }
    } catch (e) {
      console.log('[RECV raw]', data.toString().slice(0, 200));
    }
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });

  ws.on('close', (code, reason) => {
    console.log('Connection closed:', code, reason?.toString());
    process.exit(code === 1000 ? 0 : 1);
  });
}

let idx = 0;
function tryNext() {
  if (idx >= urls.length) {
    console.error('Could not connect to any gateway URL. Tried:', urls.join(', '));
    process.exit(1);
  }
  const url = urls[idx++];
  const ws = new WebSocket(url);
  ws.on('open', () => {
    ws.close();
    run(url);
  });
  ws.on('error', () => tryNext());
}

tryNext();
