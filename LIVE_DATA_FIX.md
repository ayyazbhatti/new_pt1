# Live Data Not Showing - Root Cause & Fix

## ✅ Issue Identified

The live price data was not showing in the frontend because:

1. **Frontend was connecting to wrong port**: 
   - Frontend tried to connect to `ws://localhost:9003`
   - No WebSocket server running on port 9003
   - `apps/data-provider` (port 3001) only publishes to NATS, has no WebSocket server

2. **Data flow was working but incomplete**:
   - ✅ Data-provider → NATS (working - 39K+ messages)
   - ✅ NATS → Order-engine (working - prices stored in Redis)
   - ❌ Order-engine → Frontend (broken - no WebSocket connection)

## ✅ Solution Applied

Updated frontend to use `gateway-ws` on port 3003, which:
- ✅ Already running and listening on port 3003
- ✅ Subscribes to `ticks.*` from NATS
- ✅ Forwards price ticks to WebSocket clients
- ✅ Handles `ActionSubscribe` messages from frontend

## Changes Made

**File: `src/features/symbols/hooks/usePriceStream.ts`**

Changed default WebSocket URL from:
```typescript
'ws://localhost:9003'  // ❌ No server
```

To:
```typescript
'ws://localhost:3003/ws'  // ✅ gateway-ws
```

## Verification

After the fix, the data flow is:

1. **Data-provider** (port 3001)
   - Fetches prices from Binance every 500ms
   - Publishes to NATS subjects: `ticks.BTCUSD`, `ticks.ETHUSD`, etc.

2. **Order-engine** (port 3002)
   - Subscribes to `ticks.*` from NATS
   - Processes ticks and stores in Redis
   - Executes orders when prices match

3. **Gateway-ws** (port 3003)
   - Subscribes to `ticks.*` from NATS
   - Forwards ticks to WebSocket clients
   - Handles frontend subscriptions

4. **Frontend**
   - Connects to `ws://localhost:3003/ws`
   - Sends: `{"action":"subscribe","symbols":["BTCUSD"],"group":"default"}`
   - Receives: `{"type":"tick","symbol":"BTCUSD","bid":"...","ask":"...","ts":...}`

## Testing

To verify live data is working:

1. Open browser console
2. Look for WebSocket connection logs
3. Check for price update messages
4. Verify prices updating in the UI

## Alternative Solutions (if needed)

If you want to use a dedicated data-provider WebSocket server:

1. Start `backend/data-provider` WebSocket server on port 9003
2. Set `VITE_DATA_PROVIDER_WS_URL=ws://localhost:9003` in `.env`

But `gateway-ws` is the recommended solution as it:
- Already handles all WebSocket connections
- Forwards both price ticks and order/position events
- Centralized WebSocket management

