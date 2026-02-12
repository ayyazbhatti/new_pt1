# Order Fill Issue - Root Cause Analysis

## Problem Statement
Orders are being created successfully but are NOT being filled, even for MARKET orders that should execute immediately.

## Investigation Findings

### 1. Order Creation Flow ✅ WORKING
- Frontend sends POST to `/v1/orders` ✅
- Core API receives request ✅
- Core API publishes to NATS `cmd.order.place` ✅
- Order ID is generated and returned ✅

### 2. Order Engine Reception ⚠️ NEEDS VERIFICATION
- Order engine subscribes to `cmd.order.place` ✅
- **ISSUE**: Need to verify if orders are actually being received

### 3. Order Validation ⚠️ POTENTIAL ISSUE
**Location:** `apps/order-engine/src/engine/validation.rs`

**Validation Checks:**
1. Symbol status check: `symbol:status:{symbol}` or `symbol:{symbol}`
2. Balance check: `user:{user_id}:balance`
3. Size > 0 check
4. Limit price check (for LIMIT orders)

**FINDING:**
- Balance exists in Redis: `user:00000000-0000-0000-0000-000000000001:balance` ✅
- Balance has sufficient funds: `available: 10000.0` ✅
- **BUT**: Validation might be failing silently if:
  - Symbol status key doesn't exist
  - Symbol format mismatch
  - Balance key format mismatch

### 4. Order Storage ⚠️ CRITICAL ISSUE FOUND
**Location:** `apps/order-engine/src/engine/order_handler.rs:143-152`

**Code Flow:**
```rust
// Add to pending zset
let pending_key = format!("orders:pending:{}", cmd.symbol);
redis::cmd("ZADD")... // Stores in Redis ✅

// Update cache
self.cache.add_pending_order(&cmd.symbol, order_id, order.clone()); // Stores in memory cache ✅
```

**FINDING:**
- Redis check shows: `orders:pending:*` → **EMPTY** ❌
- This means orders are either:
  1. NOT being stored in Redis (ZADD failing silently?)
  2. Being stored but immediately removed
  3. Being stored with wrong symbol format

### 5. Tick Handler Execution ✅ WORKING BUT NO ORDERS
**Location:** `apps/order-engine/src/engine/tick_handler.rs:110-116`

**Code:**
```rust
let pending_order_ids = self.cache.get_pending_orders(&tick.symbol);

if pending_order_ids.is_empty() {
    debug!("No pending orders for symbol {}", tick.symbol);
    return Ok(());
}
```

**FINDING:**
- Ticks are being received correctly ✅
- Logs show: `"No pending orders for symbol BTCUSDT"` for every tick ❌
- This confirms: **Cache is empty - no orders in pending list**

### 6. Symbol Format Consistency ⚠️ POTENTIAL MISMATCH
**Ticks Published:**
- Format: `ticks.BTCUSDT` → Symbol: `BTCUSDT` ✅

**Orders Created:**
- Need to verify: What symbol format is used when order is created?
- Frontend might send: `BTCUSDT` or `BTCUSD` or different format?

**FINDING:**
- Need to verify symbol format consistency between:
  - Order creation (frontend → API)
  - Order storage (order-engine cache)
  - Tick reception (tick handler)

## Root Cause Hypotheses

### Hypothesis 1: Validation Failing Silently ⚠️ MOST LIKELY
**Theory:** Orders are being rejected during validation, but rejection events aren't being logged/displayed properly.

**Evidence:**
- No pending orders in Redis
- No pending orders in cache
- Validation checks for symbol status and balance
- If validation fails, order is rejected and NOT stored

**Check:**
- Are `evt.order.rejected` events being published?
- Is frontend receiving rejection events?
- Are validation errors being logged?

### Hypothesis 2: Order Not Reaching Order Engine ⚠️ POSSIBLE
**Theory:** NATS message not being delivered to order-engine.

**Evidence:**
- Core API publishes to NATS ✅
- Order engine subscribes to NATS ✅
- But: No logs showing "Received place order command"

**Check:**
- Is order-engine actually receiving NATS messages?
- Is subscription working correctly?
- Are there NATS connection issues?

### Hypothesis 3: Symbol Format Mismatch ⚠️ POSSIBLE
**Theory:** Orders stored with one symbol format, ticks arrive with different format.

**Evidence:**
- Ticks: `BTCUSDT` format
- Orders: Unknown format (need to verify)
- Cache lookup is case-sensitive and exact match

**Check:**
- What symbol format does frontend send?
- What format is stored in cache?
- Are they normalized/uppercased consistently?

### Hypothesis 4: Cache Not Persisting ⚠️ UNLIKELY
**Theory:** Orders added to cache but cache is being cleared/reset.

**Evidence:**
- Cache is in-memory (DashMap)
- If order-engine restarts, cache is lost
- But Redis should persist

**Check:**
- Has order-engine restarted?
- Are orders in Redis but not in cache?

## Diagnostic Steps Needed

1. **Check if orders are being received:**
   - Add logging to `handle_place_order()` to confirm message reception
   - Check NATS message delivery

2. **Check validation results:**
   - Add detailed logging to `validate_order()`
   - Check if validation is passing or failing
   - Verify symbol status keys exist in Redis

3. **Check symbol format:**
   - Log exact symbol format when order is created
   - Log exact symbol format when tick arrives
   - Compare for consistency

4. **Check Redis storage:**
   - Verify ZADD is actually executing
   - Check if orders are being stored then removed
   - Verify Redis connection is working

5. **Check rejection events:**
   - Monitor `evt.order.rejected` events
   - Check if frontend is receiving rejections
   - Verify rejection reason

## Most Likely Root Cause

Based on evidence, **Hypothesis 1 (Validation Failing Silently)** is most likely:

1. Orders are being created and sent to order-engine ✅
2. Validation is checking for symbol status in Redis
3. Symbol status keys might not exist: `symbol:status:BTCUSDT` or `symbol:BTCUSDT`
4. Validation fails → Order rejected → NOT stored in cache/Redis
5. No rejection events reaching frontend (or not displayed)
6. User sees order as "PENDING" but it's actually rejected

**Next Step:** Check if symbol status keys exist in Redis and if validation is passing.

