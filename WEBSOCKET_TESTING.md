# WebSocket Testing Guide for Postman

## 1. Connect to Data Provider WebSocket Server

### Connection URL:
```
ws://localhost:9001/ws?group=default
```

### Steps in Postman:
1. Open Postman
2. Click **New** → **WebSocket Request**
3. Enter URL: `ws://localhost:9001/ws?group=default`
4. Click **Connect**

### Expected Response:
You should receive a welcome message:
```json
{
  "type": "welcome",
  "message": "Connected to price stream"
}
```

---

## 2. Subscribe to Symbols

### Subscription Message:
Send this JSON message to subscribe to symbols:

```json
{
  "action": "subscribe",
  "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
  "group": "default"
}
```

### Steps:
1. After connecting, type the JSON above in the message box
2. Click **Send**
3. You should see a confirmation (or error if symbols are invalid)

### Expected Response:
- If successful: No error message (subscription is silent)
- If error: You'll receive an error JSON

---

## 3. Receive Price Ticks

### Expected Price Tick Format:
After subscribing, you should receive price updates like this:

```json
{
  "type": "tick",
  "symbol": "BTCUSDT",
  "bid": "107438.65",
  "ask": "107438.66",
  "ts": 17123992123
}
```

### Notes:
- Prices come as strings (Decimal serialized)
- `bid` = Best bid price
- `ask` = Best ask price
- `ts` = Timestamp in milliseconds
- Updates arrive every ~100ms (or as Binance sends them)

---

## 4. Unsubscribe from Symbols

### Unsubscribe Message:
```json
{
  "action": "unsubscribe",
  "symbols": ["BTCUSDT"]
}
```

---

## 5. Test Different Symbols

### Available Symbols (from your database):
- BTCUSDT
- ETHUSDT
- SOLUSDT
- XRPUSDT
- BNBUSDT
- DOGEUSDT
- USDCUSDT
- PAXGUSDT
- etc.

### Example Subscription:
```json
{
  "action": "subscribe",
  "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"],
  "group": "default"
}
```

---

## 6. Troubleshooting

### If connection fails:
1. Check if data provider is running:
   ```bash
   curl http://localhost:9002/health
   ```
   Should return: `{"status":"healthy",...}`

2. Check server logs:
   ```bash
   tail -f /tmp/data-provider.log
   ```

### If no prices received:
1. Verify symbols are valid (uppercase, e.g., "BTCUSDT" not "btcusdt")
2. Check if Binance has the symbol (some symbols might not exist)
3. Wait a few seconds - first price might take 1-2 seconds

### Common Errors:
- `"Invalid message format"` - Check JSON syntax
- `"Rate limit exceeded"` - Too many subscription requests
- `"Unknown action"` - Use "subscribe" or "unsubscribe" only

---

## 7. Direct Binance WebSocket Test (Optional)

If you want to test Binance directly:

### Connection URL:
```
wss://stream.binance.com:9443/ws/btcusdt@bookTicker
```

### Expected Response:
```json
{
  "u": 1234567890,
  "s": "BTCUSDT",
  "b": "107438.65",
  "B": "0.001",
  "a": "107438.66",
  "A": "0.001",
  "E": 17123992123
}
```

Where:
- `b` = bid price
- `a` = ask price
- `s` = symbol
- `E` = event time

---

## 8. Postman WebSocket Tips

1. **Message History**: Postman saves sent messages - you can reuse them
2. **Auto-reconnect**: Postman will try to reconnect if connection drops
3. **Message Format**: Make sure JSON is valid (no trailing commas)
4. **Connection Status**: Green dot = connected, Red = disconnected

---

## Example Full Test Sequence:

1. **Connect**: `ws://localhost:9001/ws?group=default`
2. **Wait for welcome message**
3. **Subscribe**: 
   ```json
   {"action":"subscribe","symbols":["BTCUSDT"],"group":"default"}
   ```
4. **Wait for price ticks** (should arrive within 1-2 seconds)
5. **Unsubscribe** (optional):
   ```json
   {"action":"unsubscribe","symbols":["BTCUSDT"]}
   ```
6. **Disconnect**

---

## Server Status Check

Check if server is running:
```bash
curl http://localhost:9002/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": 1770729074,
  "region": "asia-1",
  "uptime_secs": 123
}
```

