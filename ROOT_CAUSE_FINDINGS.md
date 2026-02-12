# Root Cause Analysis: Orders Not Filling

## Executive Summary
Orders are created successfully but never fill because **orders are not being stored in the pending orders cache/Redis**, which means the tick handler has no orders to execute.

## Detailed Findings

### ✅ What's Working
1. **Frontend → Core API**: Order creation request works
2. **Core API → NATS**: Orders published to `cmd.order.place` subject
3. **Tick Reception**: Order engine receives price ticks correctly
4. **Symbol Status**: `symbol:status:BTCUSDT = "enabled"` exists in Redis
5. **User Balance**: Balance exists with sufficient funds (10000.0 USD)

### ❌ Critical Issues Found

#### Issue #1: No Pending Orders in Redis
**Finding:**
- Redis query: `KEYS "orders:pending:*"` → **EMPTY**
- Redis query: `ZRANGE "orders:pending:BTCUSDT" 0 -1` → **EMPTY**

**Impact:** Even if orders are accepted, they're not in the pending list for execution.

#### Issue #2: No Pending Orders in Cache
**Finding:**
- Logs show: `"No pending orders for symbol BTCUSDT"` for every tick
- `cache.get_pending_orders(&tick.symbol)` returns empty vector

**Impact:** Tick handler has nothing to execute.

#### Issue #3: Order Engine Message Reception - UNKNOWN
**Finding:**
- Code has logging: `"📥 Received NATS message on subject: {}"`
- Code has logging: `"Received place order command: user={}, symbol={}"`
- **BUT:** No logs found showing these messages

**Possible Causes:**
1. Order-engine not receiving NATS messages
2. Subscription not working correctly
3. Logs not being captured/output
4. Messages being received but handler not being called

### 🔍 Root Cause Analysis

#### Hypothesis A: Orders Not Reaching Order Engine (MOST LIKELY)
**Evidence:**
- No logs showing "Received NATS message" or "Received place order command"
- Orders return order_id from API (meaning they're published to NATS)
- But order-engine might not be subscribed correctly

**Check Needed:**
- Verify order-engine NATS subscription is active
- Check if `cmd.order.place` messages are being delivered
- Verify NATS connection between core-api and order-engine

#### Hypothesis B: Validation Failing Silently
**Evidence:**
- Validation code exists and checks:
  - Symbol status (✅ exists: "enabled")
  - Balance (✅ exists: 10000.0)
  - Size > 0 (should pass)
- If validation fails, order is rejected and NOT stored
- Rejection events might not be reaching frontend

**Check Needed:**
- Add detailed validation logging
- Check if `evt.order.rejected` events are being published
- Verify frontend receives rejection events

#### Hypothesis C: Storage Failing Silently
**Evidence:**
- Code shows: `redis::cmd("ZADD")` for pending orders
- Code shows: `cache.add_pending_order()` for cache
- But Redis shows no pending orders

**Check Needed:**
- Verify Redis ZADD is actually executing
- Check for Redis connection errors
- Verify cache.add_pending_order() is being called
- Check if there are errors being swallowed

#### Hypothesis D: Order Engine Not Running Correctly
**Evidence:**
- Process exists (PID: 89024)
- Health endpoint responds
- But might not be processing messages correctly

**Check Needed:**
- Verify order-engine is actually subscribed to NATS
- Check if subscription stream is active
- Verify message handler is being called

## Most Likely Root Cause

**Hypothesis A + B Combined:**

1. Orders are published to NATS by core-api ✅
2. Order-engine subscription might not be working correctly ⚠️
3. OR orders are received but validation fails silently ⚠️
4. If validation fails, order is rejected and NOT stored ❌
5. Rejection events might not reach frontend ❌
6. User sees order as "PENDING" but it's actually rejected ❌

## Diagnostic Evidence

### Redis State
```
✅ Symbol status: symbol:status:BTCUSDT = "enabled"
✅ User balance: user:00000000-0000-0000-0000-000000000001:balance = {"available":"10000.0"}
❌ Pending orders: orders:pending:* = EMPTY
❌ Order storage: orders:pending:BTCUSDT = EMPTY
```

### Logs Evidence
```
✅ Ticks received: "No pending orders for symbol BTCUSDT" (repeatedly)
❌ No logs: "📥 Received NATS message"
❌ No logs: "Received place order command"
❌ No logs: "Order {} accepted for symbol {}"
❌ No logs: "Order rejected: {}"
```

### Code Flow
```
1. Core API: place_order() → publishes to NATS ✅
2. Order Engine: Should receive on cmd.order.place ⚠️ UNKNOWN
3. Order Engine: handle_place_order() → validate → store ⚠️ NOT HAPPENING
4. Tick Handler: get_pending_orders() → EMPTY ❌
5. Tick Handler: No orders to fill ❌
```

## Next Steps to Confirm Root Cause

1. **Add Enhanced Logging:**
   - Log when NATS message received
   - Log validation results (pass/fail with reason)
   - Log when order stored in Redis
   - Log when order added to cache

2. **Verify NATS Subscription:**
   - Check if order-engine subscription is active
   - Monitor NATS message delivery
   - Verify subject name matches exactly

3. **Check Error Handling:**
   - Verify errors aren't being swallowed
   - Check if validation errors are logged
   - Verify rejection events are published

4. **Test Order Flow:**
   - Create order with detailed logging enabled
   - Trace through entire flow
   - Verify each step executes

## Conclusion

**Most Likely Root Cause:** Orders are either:
1. Not reaching order-engine (NATS subscription issue), OR
2. Reaching order-engine but failing validation silently (validation issue)

**Impact:** Orders are created but never stored in pending list, so tick handler has nothing to execute.

**Fix Required:** 
- Verify NATS subscription is working
- Add validation logging to see why orders might be rejected
- Ensure rejection events reach frontend
- Fix validation or NATS subscription issue

