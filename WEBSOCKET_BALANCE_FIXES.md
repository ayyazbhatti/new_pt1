# WebSocket Balance Fixes - WebSocket Only (No Fallback)

## Changes Made

### 1. **User ID Normalization** ✅
**Problem:** UUID format differences (with/without dashes, case sensitivity) caused user ID mismatches, preventing balance updates from being applied.

**Fixed in:**
- `src/features/terminal/components/LeftSidebar.tsx`
- `src/shared/hooks/useGlobalWalletBalance.ts`
- `src/features/wallet/hooks/useDepositFlow.ts`
- `src/features/wallet/hooks/useWithdrawalFlow.ts`

**Solution:** Added `normalizeUserId()` function that:
- Converts to lowercase
- Removes all dashes
- Trims whitespace
- Handles both `userId` and `user_id` fields

**Before:**
```typescript
const eventUserId = payload.userId?.toString() || payload.user_id?.toString()
const currentUserId = user?.id?.toString()
if (eventUserId === currentUserId) { // Could fail due to format differences
```

**After:**
```typescript
const normalizeUserId = (id: string | undefined | null): string => {
  if (!id) return ''
  const str = id.toString().trim().toLowerCase()
  return str.replace(/-/g, '') // Remove dashes
}
const eventUserId = normalizeUserId(payload.userId || payload.user_id)
const currentUserId = normalizeUserId(user?.id)
if (eventUserId === currentUserId) { // Now matches regardless of format
```

### 2. **WebSocket Connection on Login** ✅
**Problem:** WebSocket auto-connected on import, but if user wasn't logged in yet, it would fail authentication. Also, if user logged in after page load, WebSocket wouldn't connect.

**Fixed in:**
- `src/shared/ws/wsClient.ts` - Only auto-connect if user is already logged in
- `src/shared/store/auth.store.ts` - Connect WebSocket after login/register/hydration

**Solution:**
- Modified auto-connect to check if user is authenticated first
- Added WebSocket connection calls after successful login/register
- Added WebSocket connection after hydration (when restoring session from storage)

**Before:**
```typescript
// Auto-connect on import (lazy)
if (typeof window !== 'undefined') {
  wsClient.connect() // Would try to connect even without user
}
```

**After:**
```typescript
// Auto-connect on import (lazy) - but only if user is already logged in
if (typeof window !== 'undefined') {
  const authState = useAuthStore.getState()
  if (authState.accessToken && authState.user) {
    wsClient.connect()
  }
}
```

**And in auth.store.ts:**
```typescript
login: async (email: string, password: string) => {
  // ... login logic ...
  // Connect WebSocket after successful login
  if (typeof window !== 'undefined') {
    const { wsClient } = await import('@/shared/ws/wsClient')
    wsClient.connect()
  }
}
```

### 3. **Improved Logging** ✅
**Enhanced:** Added better logging for user ID comparison to help debug issues.

**Added:**
- Raw user IDs before normalization
- Normalized user IDs after normalization
- Match status
- Type information

## WebSocket Flow (After Fixes)

1. **User Logs In** → `auth.store.login()` called
2. **WebSocket Connects** → `wsClient.connect()` called after successful login
3. **Authentication** → JWT token sent to WebSocket server
4. **Backend Auth** → ws-gateway validates token, extracts user_id
5. **Initial Balance Request** → Backend publishes to Redis `wallet:balance:request`
6. **Auth-Service Responds** → Calculates balance, publishes to Redis `wallet:balance:updated`
7. **ws-gateway Broadcasts** → Sends `wallet.balance.updated` event to user's WebSocket connection
8. **Frontend Receives** → Event handler normalizes user IDs and matches
9. **Balance Updated** → Wallet store updated with new balance

## Testing Checklist

### ✅ Verify WebSocket Connection
1. Open browser console
2. Login to the app
3. Should see: `🔌 WebSocket opened, authenticating...`
4. Should see: `✅ WebSocket authenticated`
5. Should see: `📡 Auto-subscribed user to balances and wallet channels`

### ✅ Verify Balance Update
1. Check console for: `💰 [wsClient] Wallet balance update received`
2. Check console for: `📨 [LeftSidebar] Received WebSocket event: wallet.balance.updated`
3. Check console for: `🔍 [LeftSidebar] User ID comparison: { match: true }`
4. Check console for: `✅ [LeftSidebar] Updating wallet balance from WebSocket`
5. Balance should appear in UI

### ✅ Verify User ID Matching
1. Check console logs for user ID comparison
2. Both `eventUserId` and `currentUserId` should be normalized (no dashes, lowercase)
3. `match` should be `true`

## Potential Issues Still to Watch

1. **Service Dependencies:** All services must be running:
   - ws-gateway (port 3003)
   - auth-service (port 3000)
   - Redis (port 6379)
   - PostgreSQL

2. **Timing:** Initial balance request might arrive before WebSocket is fully ready (backend handles this with retries)

3. **Network Issues:** If WebSocket disconnects, it will auto-reconnect, but balance might be delayed

## No API Fallback

As requested, **NO API fallback** has been added. The balance will ONLY load via WebSocket events. If WebSocket fails, balance will remain at $0.00 until WebSocket reconnects and receives the balance update.

## Next Steps for Debugging

If balance still doesn't show:

1. **Check Browser Console:**
   - Look for WebSocket connection logs
   - Look for authentication success
   - Look for balance update events
   - Check user ID comparison logs

2. **Check Backend Logs (ws-gateway):**
   - `Published wallet balance request for user {user_id}`
   - `Broadcasting wallet.balance.updated for user_id={user_id}`
   - `Sending wallet.balance.updated to X connection(s)`

3. **Check Backend Logs (auth-service):**
   - `✅ Subscribed to wallet:balance:request channel`
   - `📥 Received wallet balance request for user {user_id}`
   - `✅ Published initial wallet balance to Redis`

4. **Verify Services:**
   - All services running
   - Redis connected
   - Database accessible

