# WebSocket Balance Test for ayyazbhatti3@gmail.com

## User Information
- **Email:** ayyazbhatti3@gmail.com
- **User ID:** `fa586515-f90d-4a5a-b6ed-db3cf8dae6b8`
- **JWT Token:** (provided)

## Quick Test Methods

### Method 1: Using the Test Script (Recommended)

```bash
# Run the test script
./test-balance-websocket.sh
```

Or directly:
```bash
node test-websocket-balance.js
```

### Method 2: Using Postman

1. **Connect to WebSocket:**
   - URL: `ws://localhost:3003/ws?group=default`

2. **Send Authentication:**
   ```json
   {
     "type": "auth",
     "token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYTU4NjUxNS1mOTBkLTRhNWEtYjZlZC1kYjNjZjhkYWU2YjgiLCJlbWFpbCI6ImF5eWF6YmhhdHRpM0BnbWFpbC5jb20iLCJyb2xlIjoidXNlciIsImV4cCI6MTc3MDk3Nzk4MCwiaWF0IjoxNzcwOTc3MDgwfQ.-hAODAW1UVEwuiMWl9oSokl5ZfgTKAFvzIPvmTCwb-Q"
   }
   ```

3. **Wait for auth_success:**
   ```json
   {
     "type": "auth_success",
     "user_id": "fa586515-f90d-4a5a-b6ed-db3cf8dae6b8",
     "group_id": "default"
   }
   ```

4. **Subscribe to Balance Updates:**
   ```json
   {
     "type": "subscribe",
     "channels": ["balances", "wallet"],
     "symbols": []
   }
   ```

5. **Wait for Balance Update:**
   ```json
   {
     "type": "wallet.balance.updated",
     "payload": {
       "userId": "fa586515-f90d-4a5a-b6ed-db3cf8dae6b8",
       "balance": 1000.00,
       "currency": "USD",
       "available": 1000.00,
       "locked": 0,
       "equity": 1000.00,
       "margin_used": 0,
       "free_margin": 1000.00,
       "updatedAt": "2024-01-01T00:00:00Z"
     }
   }
   ```

## Expected Flow

1. ✅ Connect to WebSocket
2. ✅ Authenticate with JWT token
3. ✅ Receive `auth_success` response
4. ✅ Subscribe to `balances` and `wallet` channels
5. ✅ Receive `subscribed` confirmation
6. ✅ Wait for `wallet.balance.updated` events

## Troubleshooting

### No Balance Updates Received?

1. **Check if balance update was triggered:**
   - Make a deposit/withdrawal
   - Or check if backend publishes balance updates on connection

2. **Check WebSocket Gateway:**
   ```bash
   lsof -i :3003
   ```

3. **Check Redis:**
   ```bash
   # Check if Redis is running
   redis-cli ping
   
   # Monitor Redis pub/sub
   redis-cli MONITOR
   ```

4. **Check Backend Logs:**
   - Look for: `Published wallet.balance.updated to Redis`
   - Look for: `Broadcasting wallet.balance.updated for user_id=...`

### Authentication Fails?

- Check if token is expired (exp: 1770977980)
- Verify token format
- Check JWT_SECRET matches between services

### Connection Fails?

- Verify ws-gateway is running on port 3003
- Check firewall/network settings
- Verify URL format: `ws://localhost:3003/ws?group=default`

## Manual Redis Test (Advanced)

If you want to manually trigger a balance update via Redis:

```bash
redis-cli PUBLISH wallet:balance:updated '{
  "userId": "fa586515-f90d-4a5a-b6ed-db3cf8dae6b8",
  "balance": 1000.00,
  "currency": "USD",
  "available": 1000.00,
  "locked": 0,
  "equity": 1000.00,
  "margin_used": 0,
  "free_margin": 1000.00,
  "updatedAt": "2024-01-01T00:00:00Z"
}'
```

## Notes

- The WebSocket gateway subscribes to Redis channel: `wallet:balance:updated`
- Balance updates are published by the auth-service when:
  - Deposits are approved
  - Withdrawals are processed
  - Manual balance updates occur
- The user_id in the balance update payload must match the authenticated user's ID

