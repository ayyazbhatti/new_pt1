#!/usr/bin/env node
// Simple WebSocket test client for data provider server

import WebSocket from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:9001';
const SYMBOLS = process.env.SYMBOLS ? process.env.SYMBOLS.split(',') : ['BTCUSDT', 'ETHUSDT'];

console.log(`🔌 Connecting to ${WS_URL}...`);
console.log(`📊 Subscribing to symbols: ${SYMBOLS.join(', ')}`);

const ws = new WebSocket(WS_URL);

let messageCount = 0;
let lastPrices = new Map();

ws.on('open', () => {
  console.log('✅ Connected to WebSocket server\n');
  
  // Subscribe to symbols
  const subscribeMsg = {
    action: 'subscribe',
    symbols: SYMBOLS
  };
  
  ws.send(JSON.stringify(subscribeMsg));
  console.log('📤 Sent subscription:', JSON.stringify(subscribeMsg, null, 2));
  console.log('\n📥 Waiting for price updates...\n');
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    
    if (message.type === 'welcome') {
      console.log('👋', message.message);
      return;
    }
    
    if (message.type === 'tick') {
      messageCount++;
      const symbol = message.symbol;
      const bid = parseFloat(message.bid);
      const ask = parseFloat(message.ask);
      const spread = ((ask - bid) / bid) * 100;
      
      // Check if price changed
      const lastPrice = lastPrices.get(symbol);
      const changed = !lastPrice || lastPrice.bid !== bid || lastPrice.ask !== ask;
      
      if (changed) {
        const changeIndicator = lastPrice 
          ? (bid > lastPrice.bid ? '📈' : bid < lastPrice.bid ? '📉' : '➡️')
          : '🆕';
        
        console.log(`${changeIndicator} [${symbol}] Bid: ${bid.toFixed(2)} | Ask: ${ask.toFixed(2)} | Spread: ${spread.toFixed(4)}% | #${messageCount}`);
        
        lastPrices.set(symbol, { bid, ask });
      }
    } else if (message.error) {
      console.error('❌ Error:', message.error, `(${message.code})`);
    } else {
      console.log('📦 Unknown message:', JSON.stringify(message, null, 2));
    }
  } catch (e) {
    console.log('📥 Received (raw):', data.toString());
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`\n🔌 WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
  console.log(`📊 Total messages received: ${messageCount}`);
  process.exit(0);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n⏱️  Shutting down...');
  ws.close();
  setTimeout(() => process.exit(0), 1000);
});

// Keep connection alive
console.log('💡 Press Ctrl+C to stop\n');

