# Critical WebSocket Issue Found

## Problem Identified

The backend ws-gateway is returning a **placeholder user_id** (`00000000-0000-0000-0000-000000000001`) instead of the actual user ID from the JWT token (`fa586515-f90d-4a5a-b6ed-db3cf8dae6b8`).

## Test Results

When testing with your JWT token:
- **Expected User ID:** `fa586515-f90d-4a5a-b6ed-db3cf8dae6b8`
- **Received User ID:** `00000000-0000-0000-0000-000000000001` ❌

## Root Cause

The JWT validation is likely **failing silently** or the **JWT_SECRET is incorrect**. The backend code looks correct - it should extract `claims.sub` from the JWT, but it's returning a placeholder instead.

## Possible Causes

1. **JWT_SECRET mismatch** - The secret used to sign the token doesn't match the secret in ws-gateway
2. **JWT validation failing** - The token validation is failing but not being logged properly
3. **Default/fallback logic** - There might be fallback logic using a placeholder (not found in code)

## What I Fixed

1. ✅ Added detailed logging to show:
   - When token validation succeeds
   - The actual claims extracted (sub, email, role)
   - When token validation fails (with error details)

2. ✅ Enhanced error logging to show:
   - Full error message
   - First 50 chars of token for debugging

## Next Steps

1. **Check ws-gateway logs** after connecting with your JWT token
2. **Verify JWT_SECRET** matches between auth-service and ws-gateway
3. **Check if token validation is actually succeeding** - look for the new log messages

## How to Verify

1. Connect to WebSocket with your JWT token
2. Check ws-gateway logs for:
   - `✅ Token validated successfully`
   - `Claims - sub (user_id): fa586515-f90d-4a5a-b6ed-db3cf8dae6b8`
   - OR `❌ Token validation failed` with error details

If validation is failing, you'll see the error. If it's succeeding but still returning placeholder, there's another issue.

## Files Modified

- `backend/ws-gateway/src/ws/session.rs` - Added detailed logging for JWT validation


