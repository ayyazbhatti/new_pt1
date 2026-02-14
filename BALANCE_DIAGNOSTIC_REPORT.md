# Balance Not Showing - Complete Diagnostic Report

## Executive Summary

The balance display depends entirely on a WebSocket event flow with **NO API fallback**. If any step in the chain fails, the balance will remain at $0.00.

## Complete Flow Analysis

### 1. Frontend Initialization
**Location:** `src/shared/ws/wsClient.ts:275-281`
- WebSocket URL: `VITE_WS_URL` or defaults to `ws://localhost:3003/ws?group=default`
- Auto-connects on import (line 280)
- **Issue:** No error handling if connection fails

### 2. WebSocket Authentication
**Location:** `src/shared/ws/wsClient.ts:219-233`
- Sends JWT token from `useAuthStore.getState().accessToken`
- **Issue:** If token is null/expired, authentication fails silently

**Backend:** `backend/ws-gateway/src/ws/session.rs:152-208`
- Extracts `user_id` from JWT `claims.sub` (String type)
- Registers connection with `user_id` as String key
- Publishes to Redis `wallet:balance:request` channel
- **Issue:** No retry if Redis publish fails

### 3. Initial Balance Request
**Backend:** `backend/auth-service/src/main.rs:202-273`
- Subscribes to Redis `wallet:balance:request` channel
- Calculates balance using `calculate_wallet_balance()`
- Publishes to Redis `wallet:balance:updated` channel
- **Critical Issues:**
  - If auth-service is not running → request is lost
  - If Redis connection fails → request is lost
  - No retry mechanism
  - Timing issue: Request might arrive before auth-service is ready

### 4. Balance Broadcast
**Backend:** `backend/ws-gateway/src/stream/broadcaster.rs:444-482`
- Subscribes to Redis `wallet:balance:updated` channel
- Extracts `userId` or `user_id` from payload
- Looks up connections via `registry.get_user_connections(user_id)`
- **Critical Issue:** If no connections found, logs warning but balance never arrives

### 5. Frontend Event Handling
**Location:** `src/features/terminal/components/LeftSidebar.tsx:69-144`
- Listens for `wallet.balance.updated` events
- Compares `payload.userId` or `payload.user_id` with `user?.id`
- **Critical Issues:**
  - If user IDs don't match → event is ignored
  - No fallback API call if WebSocket fails
  - Balance stays at 0 if no event received

## Root Causes Identified

### 🔴 CRITICAL ISSUE #1: No API Fallback
**Problem:** Frontend never calls `fetchBalance()` API endpoint
**Location:** `src/features/terminal/components/LeftSidebar.tsx`
**Impact:** If WebSocket flow fails, balance stays at $0.00 forever
**Fix Required:** Add initial API call + periodic fallback

### 🔴 CRITICAL ISSUE #2: Service Dependency Chain
**Problem:** Balance requires ALL services running:
1. ws-gateway (port 3003)
2. auth-service (port 3000)
3. Redis
4. Database (PostgreSQL)

**Impact:** If any service is down, balance won't load
**Fix Required:** Add API fallback + better error handling

### 🟡 ISSUE #3: User ID Matching
**Problem:** User ID comparison might fail due to:
- UUID format differences (with/without dashes)
- String vs UUID type mismatches
- Case sensitivity

**Location:** `LeftSidebar.tsx:86-98`
**Current Code:**
```typescript
const eventUserId = payload.userId?.toString() || payload.user_id?.toString()
const currentUserId = user?.id?.toString()
if (eventUserId && currentUserId && eventUserId === currentUserId) {
  // Update balance
}
```

**Potential Issues:**
- UUID format: `fa586515-f90d-4a5a-b6ed-db3cf8dae6b8` vs `fa586515f90d4a5ab6eddb3cf8dae6b8`
- Whitespace differences
- Type coercion issues

### 🟡 ISSUE #4: Timing Race Condition
**Problem:** Initial balance request might be sent before:
- auth-service is fully subscribed to Redis
- WebSocket connection is fully registered
- User is fully authenticated

**Location:** `backend/ws-gateway/src/ws/session.rs:187-206`
**Impact:** Request might be lost if sent too early

### 🟡 ISSUE #5: No Error Visibility
**Problem:** Failures are logged but user sees no feedback
**Impact:** User doesn't know why balance isn't showing
**Fix Required:** Add user-facing error messages

## Verification Checklist

### ✅ Check 1: WebSocket Connection
**Browser Console Should Show:**
```
🔌 WebSocket opened, authenticating...
🔐 Sending auth message with token: ...
✅ WebSocket authenticated
📡 Auto-subscribed user to balances and wallet channels
```

**If Missing:** WebSocket not connecting or authenticating

### ✅ Check 2: Backend Logs (ws-gateway)
**Should Show:**
```
Published wallet balance request for user {user_id}
📡 Broadcasting wallet.balance.updated for user_id={user_id}
📤 Sending wallet.balance.updated to X connection(s) for user_id={user_id}
```

**If Missing:** Balance request not being sent or received

### ✅ Check 3: Backend Logs (auth-service)
**Should Show:**
```
✅ Subscribed to wallet:balance:request channel
📥 Received wallet balance request for user {user_id}
✅ Published initial wallet balance to Redis (X subscribers) for user_id={user_id}
```

**If Missing:** auth-service not running or not subscribed

### ✅ Check 4: Frontend Console
**Should Show:**
```
💰 [wsClient] Wallet balance update received: {...}
📨 [LeftSidebar] Received WebSocket event: wallet.balance.updated
🔔 [LeftSidebar] wallet.balance.updated event received: {...}
✅ [LeftSidebar] Updating wallet balance from WebSocket: {...}
```

**If Missing:** Event not received or user ID mismatch

### ✅ Check 5: User ID Comparison
**Console Should Show:**
```
🔍 [LeftSidebar] User ID comparison: {
  eventUserId: "fa586515-f90d-4a5a-b6ed-db3cf8dae6b8",
  currentUserId: "fa586515-f90d-4a5a-b6ed-db3cf8dae6b8",
  match: true
}
```

**If `match: false`:** User ID mismatch is the issue

## Environment Variables to Verify

```bash
# Frontend (.env or Vite config)
VITE_WS_URL=ws://localhost:3003/ws?group=default
VITE_API_URL=http://localhost:3000

# Backend (ws-gateway)
WS_PORT=3003
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=...
JWT_ISSUER=...

# Backend (auth-service)
PORT=3000
REDIS_URL=redis://127.0.0.1:6379
DATABASE_URL=...
```

## Services Required

1. **ws-gateway** - Port 3003 (WebSocket server)
2. **auth-service** - Port 3000 (handles balance requests)
3. **Redis** - Port 6379 (message broker)
4. **PostgreSQL** - Database for wallet data

## Most Likely Root Causes (Priority Order)

1. **auth-service not running** → Initial balance request has no handler
2. **WebSocket not connecting** → No events received
3. **User ID mismatch** → Events received but ignored
4. **Redis connection issues** → Messages not delivered
5. **Timing issue** → Request sent before service ready
6. **No API fallback** → Balance never loads if WebSocket fails

## Recommended Fixes

### Fix 1: Add API Fallback (CRITICAL)
- Call `fetchBalance()` on component mount
- Retry if WebSocket doesn't deliver balance within 5 seconds
- Periodic refresh as backup

### Fix 2: Improve User ID Matching
- Normalize UUIDs (remove dashes, lowercase)
- Add better logging for mismatches
- Handle both formats gracefully

### Fix 3: Add Error Handling
- Show user-friendly error messages
- Retry failed requests
- Fallback to API if WebSocket fails

### Fix 4: Add Health Checks
- Verify all services are running
- Check Redis connectivity
- Validate WebSocket connection

### Fix 5: Improve Logging
- Add more detailed logs at each step
- Include user IDs in all logs
- Track timing of each step

## Next Steps

1. **Verify Services:** Check all services are running
2. **Check Logs:** Review browser console and backend logs
3. **Verify User ID:** Ensure IDs match in all logs
4. **Test Manually:** Trigger balance update via API
5. **Implement Fixes:** Add API fallback and error handling

