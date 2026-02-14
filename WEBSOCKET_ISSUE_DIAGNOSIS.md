# WebSocket Issue Diagnosis

## Problem
When sending a subscribe message, the server echoes back the same message instead of responding with `{"type":"subscribed","symbols":[]}`.

## What Should Happen

### Expected Flow:
1. Send: `{"type":"subscribe","channels":["balances","wallet"],"symbols":[]}`
2. Receive: `{"type":"subscribed","symbols":[]}`

### What's Actually Happening:
1. Send: `{"type":"subscribe","channels":["balances","wallet"],"symbols":[]}`
2. Receive: `{"type":"subscribe","channels":["balances","wallet"],"symbols":[]}` (echoed back)

## Possible Causes

### 1. Wrong WebSocket Server
You might be connected to a different WebSocket server that echoes messages.

**Check:**
- Verify you're connected to `ws://localhost:3003/ws?group=default` (ws-gateway)
- NOT `ws://localhost:9003` (data-provider)

### 2. Message Not Being Parsed
The backend might not be recognizing the subscribe message format.

**Check Backend Logs:**
Look for:
- `"Received message from connection"`
- `"Parsed message from connection"`
- `"Connection X subscribed to Y symbols"`

### 3. Empty Symbols Array Issue
The backend code only processes symbols, not channels. With empty symbols, it might not be handling the subscription correctly.

**Backend Code Issue:**
```rust
for symbol in &symbols {  // This loop does nothing if symbols is empty
    registry.subscribe_symbol(conn_id, symbol.clone(), channels.clone());
}
```

## Solutions

### Solution 1: Check Which Server You're Connected To

Verify the WebSocket URL:
- ✅ Correct: `ws://localhost:3003/ws?group=default` (ws-gateway)
- ❌ Wrong: `ws://localhost:9003` (data-provider - this one might echo)

### Solution 2: Check Backend Logs

Run the ws-gateway service and check logs:
```bash
# Check if ws-gateway is running
lsof -i :3003

# Check backend logs for:
# - "Received message from connection"
# - "Parsed message from connection"
# - "Connection X subscribed to Y symbols"
```

### Solution 3: Try Subscribing with a Symbol

Even though you want balance updates (not symbol prices), try:
```json
{
  "type": "subscribe",
  "channels": ["balances", "wallet"],
  "symbols": ["BTCUSD"]
}
```

This might help identify if the issue is with empty symbols array.

### Solution 4: Check Authentication Status

The subscribe handler checks:
```rust
if let Some(conn) = registry.get(&conn_id) {
    // Process subscription
} else {
    // Send error: "NOT_AUTHENTICATED"
}
```

Make sure you received `auth_success` before subscribing.

## Debugging Steps

1. **Verify Connection:**
   - Check URL: `ws://localhost:3003/ws?group=default`
   - Check status: Should show "Connected"

2. **Verify Authentication:**
   - Did you receive `{"type":"auth_success",...}`?
   - Check the user_id in auth_success

3. **Check Backend Logs:**
   - Look for subscription-related log messages
   - Check for any errors

4. **Try Different Message:**
   - Try subscribing with a symbol to see if response changes
   - Try ping: `{"type":"ping"}` - should get `{"type":"pong"}`

5. **Check if Balance Updates Still Work:**
   - Even without proper subscription response, balance updates might still work
   - Wait for a balance update event
   - Or trigger one via API (deposit/withdrawal)

## Expected Behavior After Fix

After the issue is resolved, you should:
1. Send subscribe message
2. Receive: `{"type":"subscribed","symbols":[]}`
3. Start receiving balance updates: `{"type":"wallet.balance.updated",...}`

