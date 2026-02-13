# WebSocket Balance Debugging Guide

## Issue: Balance not showing via WebSocket

## Steps to Fix:

### 1. Restart Services (REQUIRED)
The services are running old code. You MUST restart them:

```bash
# Stop all services (Ctrl+C in terminal running start-all-servers.sh)
# Or kill the processes:
pkill -f "auth-service"
pkill -f "gateway-ws"

# Then restart:
bash scripts/start-all-servers.sh
```

### 2. Verify Services Started with New Code
After restart, check logs for:

**Auth Service should show:**
```
✅ Subscribed to wallet:balance:request channel
🔄 Starting to listen for wallet balance requests...
```

**Gateway WS should show:**
```
Published wallet balance request for user {user_id}
```

### 3. Test the Flow Manually

1. **Connect to WebSocket from frontend** - Open browser console
2. **Check for auth_success message** - Should see: `✅ WebSocket authenticated`
3. **Check for balance request** - Gateway should publish to Redis
4. **Check for balance response** - Auth-service should respond
5. **Check for balance update** - Frontend should receive `wallet.balance.updated`

### 4. Check Redis Channels

```bash
# Check if auth-service is subscribed
redis-cli PUBSUB CHANNELS

# Manually test the flow
redis-cli PUBLISH "wallet:balance:request" '{"user_id":"YOUR_USER_ID","request_type":"initial_balance"}'
```

### 5. Common Issues

1. **Services not restarted** - Most common issue
2. **Redis connection failed** - Check Redis is running
3. **User ID mismatch** - Check user_id in logs matches
4. **Subscription not working** - Check gateway subscription handling

### 6. Debug Logs to Check

**Auth Service logs:**
- `✅ Subscribed to wallet:balance:request channel`
- `📥 Received wallet balance request for user {id}`
- `✅ Published initial wallet balance to Redis`

**Gateway WS logs:**
- `Published wallet balance request for user {id}`
- `📡 Broadcasting wallet.balance.updated for user_id={id}`
- `✅ Sent wallet.balance.updated to connection {id}`

**Frontend console:**
- `✅ WebSocket authenticated`
- `📡 Auto-subscribed user to balances and wallet channels`
- `🔔 Received wallet.balance.updated event`
- `✅ Updating wallet balance from WebSocket`

