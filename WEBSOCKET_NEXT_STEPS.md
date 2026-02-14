# Next Steps for WebSocket Balance Test

## Current Status
✅ Connected to WebSocket
✅ Authenticated successfully
⚠️ **Issue:** user_id in auth_success is placeholder (`00000000-0000-0000-0000-000000000001`) instead of actual user ID (`fa586515-f90d-4a5a-b6ed-db3cf8dae6b8`)

## Step 1: Subscribe to Balance Updates

Send this message in Postman:

```json
{
  "type": "subscribe",
  "channels": ["balances", "wallet"],
  "symbols": []
}
```

**Expected Response:**
```json
{
  "type": "subscribed",
  "symbols": []
}
```

## Step 2: Wait for Balance Updates

After subscription, you should receive balance update messages like:

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

## Potential Issue: User ID Mismatch

The `auth_success` response shows a placeholder user_id. This might cause issues if:
- Balance updates use the actual user_id from the JWT token
- The backend doesn't properly extract the user_id from the token

**To verify:**
1. Check if balance updates include the correct user_id (`fa586515-f90d-4a5a-b6ed-db3cf8dae6b8`)
2. If balance updates don't arrive, check backend logs for user_id matching

## Troubleshooting

### No Balance Updates After Subscription?

1. **Check if balance update was triggered:**
   - Make a deposit/withdrawal via API
   - Or check backend to manually trigger balance update

2. **Check Backend Logs:**
   Look for:
   - `Published wallet.balance.updated to Redis`
   - `Broadcasting wallet.balance.updated for user_id=fa586515-f90d-4a5a-b6ed-db3cf8dae6b8`
   - `Sending wallet.balance.updated to X connection(s)`

3. **Verify User ID Matching:**
   The balance update payload should have:
   ```json
   {
     "userId": "fa586515-f90d-4a5a-b6ed-db3cf8dae6b8"
   }
   ```

## Test Balance Update via API

If you want to trigger a balance update, you can:
1. Make a deposit request
2. Approve it (if admin)
3. This should trigger a `wallet.balance.updated` event

## Summary

1. ✅ Connect: Done
2. ✅ Authenticate: Done (but user_id is placeholder)
3. ⏳ Subscribe: Send subscribe message
4. ⏳ Wait for balance updates: Should receive after subscription

