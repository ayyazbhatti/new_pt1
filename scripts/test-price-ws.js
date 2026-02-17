/**
 * Test gateway WebSocket with JWT and check if prices are marked up.
 * Usage: node scripts/test-price-ws.js
 * Requires: gateway on ws://localhost:3003/ws, data-provider publishing ticks.
 */
import WebSocket from 'ws';

const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI5NTg4Yjg3OS1iYTMxLTQ2MzEtODFlOC02MGIxNWIzZDg2Y2MiLCJlbWFpbCI6InBpbnljdWd1bWlAbWFpbGluYXRvci5jb20iLCJyb2xlIjoidXNlciIsImdyb3VwX2lkIjoiMmI1ZDc4YTctNGI3OC00MjNhLWIwOTMtZWU4MmRlZjQzMTIxIiwiZXhwIjoxNzcxMzIyNjk3LCJpYXQiOjE3NzEzMjE3OTd9.7djmVIy3MN6_aiwFTyG2xTS6W0ltHYHwypbf1bc-R8o';
const WS_URL = 'ws://localhost:3003/ws';
const SYMBOLS = ['BTCUSDT'];

function send(ws, obj) {
  const raw = JSON.stringify(obj);
  ws.send(raw);
  console.log('Sent:', raw);
}

async function fetchBinancePrice(symbol) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`);
    const data = await res.json();
    return { bid: parseFloat(data.bidPrice), ask: parseFloat(data.askPrice) };
  } catch (e) {
    return null;
  }
}

const TICK_TIMEOUT_MS = 8000;

async function main() {
  console.log('Connecting to', WS_URL, '...');
  const ws = new WebSocket(WS_URL);
  let authed = false;
  const ticks = [];
  let tickTimeout = null;

  ws.on('open', () => {
    console.log('Connected. Sending auth...');
    send(ws, { type: 'auth', token: TOKEN });
    tickTimeout = setTimeout(() => {
      if (ticks.length === 0) {
        console.log('\n--- Timeout: no ticks after ' + (TICK_TIMEOUT_MS / 1000) + 's ---');
        console.log('Start data-provider so it publishes price:ticks to Redis, then run this again.');
        ws.close();
      }
    }, TICK_TIMEOUT_MS);
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('Received:', JSON.stringify(msg));

    if (msg.type === 'auth_success') {
      authed = true;
      console.log('Auth OK. Subscribing to', SYMBOLS, '...');
      send(ws, { type: 'subscribe', symbols: SYMBOLS, channels: [] });
    }
    if (msg.type === 'auth_error') {
      console.error('Auth failed:', msg.error);
      process.exit(1);
    }
    if (msg.type === 'tick' && msg.symbol) {
      if (tickTimeout) clearTimeout(tickTimeout);
      const bid = parseFloat(msg.bid);
      const ask = parseFloat(msg.ask);
      ticks.push({ symbol: msg.symbol, bid, ask, ts: msg.ts });
      if (ticks.length >= 3) {
        ws.close();
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    process.exit(1);
  });

  ws.on('close', async () => {
    if (tickTimeout) clearTimeout(tickTimeout);
    console.log('\n--- Result ---');
    if (ticks.length === 0) {
      console.log('No ticks received. Is data-provider running and publishing to Redis?');
      process.exit(1);
    }
    const last = ticks[ticks.length - 1];
    console.log('Last tick from gateway:', last);
    const binanceSymbol = last.symbol === 'BTCUSD' ? 'BTCUSDT' : last.symbol;
    const binance = await fetchBinancePrice(binanceSymbol);
    if (binance) {
      console.log('Binance raw (approx):', binance);
      const bidRatio = last.bid / binance.bid;
      const askRatio = last.ask / binance.ask;
      const pctBid = ((bidRatio - 1) * 100).toFixed(2);
      const pctAsk = ((askRatio - 1) * 100).toFixed(2);
      console.log('Gateway bid vs Binance bid ratio:', bidRatio.toFixed(4), `(~${pctBid}% markup)`);
      console.log('Gateway ask vs Binance ask ratio:', askRatio.toFixed(4), `(~${pctAsk}% markup)`);
      if (bidRatio > 1.01 && askRatio > 1.01) {
        console.log('\nYes: WebSocket is returning MARKED-UP prices (gateway sends per-group markup).');
      } else if (Math.abs(bidRatio - 1) < 0.001 && Math.abs(askRatio - 1) < 0.001) {
        console.log('\nNo: Prices match raw (no markup in this stream).');
      } else {
        console.log('\nUnclear: Ratios above.');
      }
    } else {
      console.log('Could not fetch Binance for comparison.');
    }
    process.exit(0);
  });
}

main();
