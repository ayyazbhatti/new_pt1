# Postman WebSocket Testing - Step by Step Guide

## Step 1: Create WebSocket Request
1. Click **"New"** button in the left sidebar
2. Select **"WebSocket Request"**
3. Or use the existing tab if you already have one open

## Step 2: Enter WebSocket URL
1. In the URL field at the top, enter: `ws://localhost:9001`
2. Make sure it says `ws://` (not `http://`)

## Step 3: Connect
1. Click the blue **"Send"** button (it will act as "Connect" for WebSocket)
2. Wait a moment for the connection to establish
3. You should see connection status change to "Connected"

## Step 4: View Welcome Message
After connecting, you'll see a welcome message in the response area:
```json
{
  "type": "welcome",
  "message": "Connected to price stream"
}
```

## Step 5: Send Subscribe Message
1. Look for the message input area (usually at the bottom of the response section)
2. Type or paste this JSON:
```json
{
  "action": "subscribe",
  "symbols": ["BTCUSDT", "ETHUSDT"]
}
```
3. Click **"Send"** or press **Enter**

## Step 6: Receive Live Prices
You should start receiving price updates every 100ms:
```json
{
  "type": "tick",
  "symbol": "BTCUSDT",
  "bid": 68863.10,
  "ask": 68863.11,
  "ts": 1770721234567
}
```

## Step 7: Unsubscribe (Optional)
To stop receiving updates for a symbol:
```json
{
  "action": "unsubscribe",
  "symbols": ["BTCUSDT"]
}
```

## Troubleshooting

### If connection fails:
- Make sure the data provider server is running: `lsof -i :9001`
- Check server logs: `tail -f /tmp/data-provider.log`

### If no prices received:
- Verify you sent the subscribe message correctly
- Check that symbols are valid: `BTCUSDT`, `ETHUSDT`
- Look at server logs to see if subscription was successful

### If you see errors:
- Make sure JSON is valid (no trailing commas)
- Check that `action` is either `"subscribe"` or `"unsubscribe"`
- Verify `symbols` is an array of strings

## Available Symbols
- `BTCUSDT` - Bitcoin/USDT ✅
- `ETHUSDT` - Ethereum/USDT ✅
- `EURUSD` - Euro/USD (may not have data from Binance)

## Tips
- Prices update every 100ms
- You can subscribe to multiple symbols at once
- Maximum 50 symbols per subscription
- Each price tick shows: symbol, bid, ask, and timestamp

