# WebSocket Testing Guide

## Testing in Postman

### Step 1: Create WebSocket Request
1. Open Postman
2. Click **New** → **WebSocket Request**
3. Enter URL: `ws://localhost:9001`
4. Click **Connect**

### Step 2: Subscribe to Symbols
Once connected, you'll receive a welcome message. Then send a subscribe message:

```json
{
  "action": "subscribe",
  "symbols": ["BTCUSDT", "ETHUSDT"]
}
```

### Step 3: Receive Live Prices
You should start receiving price ticks in this format:

```json
{
  "type": "tick",
  "symbol": "BTCUSDT",
  "bid": 68863.10,
  "ask": 68863.11,
  "ts": 1770721234567
}
```

### Step 4: Unsubscribe (Optional)
To unsubscribe from symbols:

```json
{
  "action": "unsubscribe",
  "symbols": ["BTCUSDT"]
}
```

## Testing with Node.js Script

You can also test with this simple Node.js script:

```javascript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:9001');

ws.on('open', () => {
  console.log('✅ Connected to WebSocket server');
  
  // Subscribe to symbols
  ws.send(JSON.stringify({
    action: 'subscribe',
    symbols: ['BTCUSDT', 'ETHUSDT']
  }));
  
  console.log('📤 Sent subscription request');
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    console.log('📥 Received:', JSON.stringify(message, null, 2));
  } catch (e) {
    console.log('📥 Received (raw):', data.toString());
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', () => {
  console.log('🔌 WebSocket closed');
});

// Keep connection alive
setTimeout(() => {
  console.log('⏱️  Test complete, closing...');
  ws.close();
  process.exit(0);
}, 30000); // Run for 30 seconds
```

## Expected Message Flow

1. **Welcome Message** (on connect):
   ```json
   {
     "type": "welcome",
     "message": "Connected to price stream"
   }
   ```

2. **Price Ticks** (after subscription):
   ```json
   {
     "type": "tick",
     "symbol": "BTCUSDT",
     "bid": 68863.10,
     "ask": 68863.11,
     "ts": 1770721234567
   }
   ```

3. **Error Messages** (if invalid):
   ```json
   {
     "error": "Invalid message format",
     "code": "INVALID_MESSAGE"
   }
   ```

## Available Symbols

Currently configured symbols:
- `BTCUSDT` - Bitcoin/USDT
- `ETHUSDT` - Ethereum/USDT
- `EURUSD` - Euro/USD (Note: This may not have data from Binance)

## Notes

- Prices update every 100ms
- Server broadcasts to rooms: `symbol:BTCUSDT`, `symbol:ETHUSDT`, etc.
- You can subscribe to multiple symbols at once
- Maximum 50 symbols per subscription (rate limited)

