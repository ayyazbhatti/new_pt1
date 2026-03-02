# Order 455f0983-d14e-4c79-9665-1a7f94a0efd0 — Why It Does Not Execute (Root Cause Analysis)

**Order ID:** `455f0983-d14e-4c79-9665-1a7f94a0efd0`  
**Scope:** Find root cause only. Do not apply fixes until you approve.

---

## 1. How order execution works (short)

1. **Auth-service** (or core-api): User places order → insert row in DB (status `pending`) → publish **PlaceOrderCommand** to NATS subject `cmd.order.place` (JetStream + basic pub/sub), with `order_id` from DB.
2. **Order-engine**: Subscribes to `cmd.order.place` → receives command → validates → stores order in **Redis** (`order:{order_id}` as JSON, and `orders:pending:{symbol}` sorted set) → adds to **in-memory cache** → for market orders may fill immediately if tick exists, else waits for ticks.
3. **Tick handler**: On each price tick for symbol `X`, order-engine gets `cache.get_pending_orders(X)` → for each pending order (market or limit with price crossed) calls **atomic_fill_order** (Lua) → updates order/position/balance in Redis and publishes events.

So for this order to execute, it must:

- Be **in Redis**: key `order:455f0983-d14e-4c79-9665-1a7f94a0efd0` and member of `orders:pending:{symbol}`.
- Be **in order-engine cache**: loaded either when the place command was handled or on startup via **warm_cache** (which reads `orders:pending:*` and `order:{id}` from Redis).
- Receive **ticks** for the same **symbol** (e.g. `BTCUSDT`).
- Pass **fill conditions**: market → always; limit → bid/ask must cross limit price.
- **Lua** must succeed (order status `PENDING`, limit price met if applicable, etc.).

If any of these fail, the order stays “pending” and never executes.

---

## 2. Possible root causes (and how they map to this order)

### A. Command never reached order-engine

- **What:** Auth-service inserted the order in DB and returned 200, but the NATS message was never consumed (or not yet).
- **Why:** Order-engine was down when the message was published; NATS disconnect; wrong subject; JetStream consumer bound to a different subject/deliver queue so this message went elsewhere or was never delivered.
- **Effect:** Order exists in **DB** with status `pending`, but **Redis** has no `order:455f0983-d14e-4c79-9665-1a7f94a0efd0` and no entry in `orders:pending:{symbol}`. Cache never sees it, so no fill.

### B. Order-engine received command but validation failed

- **What:** `handle_place_order` ran but `validator.validate_order()` returned an error (symbol not enabled, size ≤ 0, limit price invalid, balance check failed, etc.).
- **Why:** Redis key `symbol:status:{symbol}` not `enabled`; or `user:{user_id}:balance` available &lt; rough margin; or invalid limit/SL/TP.
- **Effect:** Handler returns `Err`, order is **not** written to Redis and not added to cache. DB still has the row as `pending`.

### C. Idempotency treated as duplicate (wrong order_id path)

- **What:** Order-engine uses idempotency key `idempotency:{idempotency_key}` (30 min TTL). If that key was already set (e.g. by a previous request with same idempotency key), the handler returns `Ok(())` **without** storing the new order.
- **Why:** Client retried with same idempotency key; first request already stored a **different** order_id; second request gets the same idempotency hit and is skipped.
- **Effect:** The order_id `455f0983-d14e-4c79-9665-1a7f94a0efd0` might be the **second** request: it’s in DB (auth-service always inserts and returns this id), but order-engine only stored the **first** order_id under that idempotency key. So Redis/cache have the other order_id, not this one. This order then never gets ticks/fill.

### D. Order in Redis but not in cache (e.g. after restart)

- **What:** Order was stored in Redis by order-engine, but on restart **warm_cache** didn’t load it.
- **Why:** Warm cache does `KEYS orders:pending:*`, then for each key `ZRANGE` and for each order_id `GET order:{order_id}` and `serde_json::from_str::<Order>(json)`. If the value is missing, not valid JSON, or doesn’t deserialize to `Order` (e.g. different shape or enum variant), that order is skipped. Also if `order.status != Pending` it’s skipped.
- **Effect:** Redis has `order:455f0983-d14e-4c79-9665-1a7f94a0efd0` and it’s in `orders:pending:{symbol}`, but in-memory cache doesn’t have it, so tick handler never tries to fill it.

### E. Order in cache but symbol / tick mismatch

- **What:** Pending orders are keyed by **symbol** (e.g. `BTCUSDT`). Ticks arrive for the same symbol. If the order’s symbol in Redis/cache differs from the tick symbol (e.g. `BTCUSD` vs `BTCUSDT`), or ticks never arrive for that symbol, no fill.
- **Why:** Different symbol normalization (auth vs data-provider); or symbol not subscribed / no feed.
- **Effect:** Order sits in cache under symbol `X`, but ticks only for `Y`, so `get_pending_orders(tick.symbol)` never returns this order.

### F. Limit order and price never crossed

- **What:** Order type is LIMIT; fill only when (buy: ask ≤ limit_price, sell: bid ≥ limit_price). If market never traded there, order never fills.
- **Why:** Limit price too aggressive or not yet reached.
- **Effect:** Order is in Redis and cache and gets ticks, but `should_fill` is false every time.

### G. atomic_fill_order (Lua) fails each time

- **What:** Tick handler calls `execute_fill` → `atomic_fill_order`. Lua returns an error (e.g. `order_not_found`, `order_not_pending`, `limit_price_not_met`).
- **Why:** Order in Redis has wrong status (e.g. not `PENDING`); or limit condition not met in Lua’s check; or key mismatch (e.g. Lua expects `order:{id}` with JSON, but key or value format is wrong).
- **Effect:** Order stays in Redis and cache, ticks keep coming, but every fill attempt fails and is logged.

---

## 3. Diagnostic steps (no fixes — only to find root cause)

Run these and record the results to see which of the above applies.

### Step 1: Database

```sql
SELECT id, user_id, symbol_id, symbol_id::text, side, type, size, price, status, reference, created_at
FROM orders
WHERE id = '455f0983-d14e-4c79-9665-1a7f94a0efd0';
```

- If **no row**: order was never created (wrong id or different DB).
- If **row exists**: note `symbol_id` (resolve to symbol code, e.g. `BTCUSDT`), `type` (market/limit), `price` (limit price if limit), `status` (`pending` → never filled).

### Step 2: Redis — order and pending set

```bash
# Order key (order-engine stores JSON here)
redis-cli GET "order:455f0983-d14e-4c79-9665-1a7f94a0efd0"

# If you know the symbol (e.g. BTCUSDT), check pending set
redis-cli ZRANGE "orders:pending:BTCUSDT" 0 -1
```

- **GET returns (nil):** Order was never stored by order-engine → likely **A**, **B**, or **C**.
- **GET returns JSON:** Check that `"status"` is `"PENDING"` (Lua expects string `"PENDING"`). Check `symbol` matches the symbol used by ticks. If symbol is e.g. `BTCUSD` but ticks are `BTCUSDT`, see **E**.
- **Order not in ZRANGE for its symbol:** It’s not in the pending set; either never added (A/B/C) or already removed (e.g. filled/cancelled by another path). If still in DB as pending, something inconsistent.

### Step 3: Order-engine logs (when order was placed)

- Search for this order_id and for place-order handling around the time the order was created:
  - `455f0983-d14e-4c79-9665-1a7f94a0efd0`
  - `handle_place_order`, `Deserialized PlaceOrderCommand`, `Order ... accepted`, `Error handling place order`, `validation`, `Duplicate order`
- If you see **“Order ... accepted for symbol X”** with this order_id → command was received and stored (so not A). If you see **“Error handling place order”** or validation error → **B**.
- If you see **“Duplicate order detected”** and no “Order ... accepted” for this id → **C** (another order_id was stored under same idempotency key).

### Step 4: Ticks and fill attempts

- In order-engine logs, for the **symbol** of this order (e.g. `BTCUSDT`): do you see tick activity (`process_tick`, `No pending orders`, or “Order … filled at”)?
- If there are **no** ticks for that symbol → **E** (no fill possible).
- If there are ticks but **no** “Order 455f0983... filled” and **no** “Failed to fill order 455f0983...” → either order not in cache (**D**) or symbol mismatch (**E**).
- If you see **“Failed to fill order 455f0983...”** with a Lua/atomic_fill error → **G** (inspect the error message: `order_not_found`, `order_not_pending`, `limit_price_not_met`, etc.).

### Step 5: Warm cache (if order-engine was restarted after place)

- On startup, order-engine logs: “Cache warmed: loaded N pending orders”.
- If you **know** this order was in Redis (from Step 2) before the last restart but N didn’t increase when this order was present, or this order_id is not in cache after restart → **D** (deserialization or key/format issue).

### Step 6: Idempotency (if you have the client idempotency key)

- Auth-service uses `order:idempotency:{req.idempotency_key}` and stores `order_id`.
- Order-engine uses `idempotency:{cmd.idempotency_key}` and stores `order_id` (30 min TTL).
- If you can inspect Redis: `redis-cli GET "idempotency:{idempotency_key}"`. If it returns a **different** uuid than `455f0983-d14e-4c79-9665-1a7f94a0efd0`, then for that idempotency key the engine only ever stored the first order_id → **C**.

---

## 4. Summary table

| Finding | Likely root cause |
|--------|---------------------|
| No row in DB | Wrong order_id or DB. |
| Row in DB, no Redis `order:...` | **A** (command not received) or **B** (validation failed) or **C** (idempotency skip). |
| Redis has order, not in `orders:pending:{symbol}` | Inconsistent state or already removed (e.g. fill/cancel). |
| Redis has order + in pending set, not in cache after restart | **D** (warm_cache didn’t load it). |
| In cache but no ticks for that symbol | **E** (symbol/tick mismatch or no feed). |
| In cache, ticks present, limit order, price never crossed | **F**. |
| In cache, ticks present, fill attempted but Lua error | **G** (Lua error message gives detail). |

---

## 5. Next step

Run the diagnostics in §3 (DB, Redis, logs, idempotency if available). From the results you can assign one (or a combination) of **A–G** to this order. Once the root cause is known, we can propose a concrete fix (e.g. re-publish command, fix validation, fix idempotency/key format, or fix warm_cache/Lua) and only then implement after your approval.

**No code or configuration has been changed; this document is for analysis and diagnosis only.**
