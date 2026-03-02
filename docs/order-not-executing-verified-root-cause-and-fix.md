# Verified Root Cause and Fix — Order Not Executing

**Order ID checked:** `455f0983-d14e-4c79-9665-1a7f94a0efd0`  
**Status:** Root cause verified. Fix described below; implement only after your approval.

---

## 1. Verified root cause

**Check performed:** Redis lookup for this order.

- **Command:** `redis-cli GET "order:455f0983-d14e-4c79-9665-1a7f94a0efd0"`
- **Result:** Key is missing (no value in Redis).

So this order was **never stored in Redis** by the order-engine. Execution only happens when the order is in Redis + in the engine’s in-memory cache and then filled on ticks. If it’s not in Redis, it will never execute.

So the root cause for this order is:

**The place-order command either never reached the order-engine, or the order-engine rejected it (e.g. validation) before writing to Redis.**

In both cases the outcome is the same: no `order:{order_id}` and no entry in `orders:pending:{symbol}`, so the order never runs.

- **Likely “command never reached”:** e.g. order-engine was down when the order was placed, or NATS didn’t deliver (basic pub/sub is fire-and-forget).
- **Possible “rejected”:** e.g. symbol not enabled, balance check, or other validation in `validate_order()`.

So we have one **confirmed** root cause: **order missing from Redis because it was never successfully accepted and stored by the order-engine.**

---

## 2. Why this fix will resolve the issue

We need to **repair** orders that are already in the DB as `pending` but missing from Redis, and **reduce** the chance of the same situation in the future.

### 2.1 Fix that will work: sync pending orders from DB into Redis/order-engine

**Idea:** Periodically (or on demand) find orders that are **pending in the DB** but **not present in Redis** (`order:{order_id}`), and **re-send a place-order command** for them so the order-engine can store and then execute them when ticks arrive.

**Why this fixes this order:**

- Order `455f0983-d14e-4c79-9665-1a7f94a0efd0` is in the DB as `pending` and is **not** in Redis (verified).
- Sync will detect “pending in DB, missing in Redis” and publish a `PlaceOrderCommand` for this order (with a dedicated sync idempotency key so the engine accepts it).
- Order-engine will receive the command, validate, store in Redis and cache, and the tick handler will then be able to fill it when ticks for the symbol arrive.

So **once sync runs for this order, it will be in Redis and in cache, and it will execute** under the same rules as any other pending order (market vs limit, price, etc.).

**Why this is safe and won’t break things:**

- We only sync orders that are **pending in DB** and **missing in Redis**. We do not touch orders that are already in Redis (no double-insert, no duplicate execution).
- We use a **separate idempotency key** for sync (e.g. `sync-{order_id}`) so:
  - The engine does not treat the sync as a duplicate of the original request (which may have used a different idempotency key or never reached the engine).
  - Re-running sync for the same order is idempotent: after the first sync the order is in Redis; we can either skip “already in Redis” or send again and let the engine overwrite/ignore by order_id; design below uses “skip if already in Redis” so we don’t rely on engine idempotency for sync.
- We do **not** change how normal place-order works; we only add a recovery path for stuck pending orders.

**Scope:**

- Fixes **this** order (455f0983-d14e-4c79-9665-1a7f94a0efd0) once sync runs.
- Fixes **any other** order that is pending in DB but missing from Redis (same root cause).
- Does **not** change the root cause of “command not received” or “validation failed” (those remain operational/validation concerns), but **repairs** the symptom so those orders can still execute.

---

## 3. Concrete fix design (implementation plan)

### 3.1 Where to implement

- **Auth-service** (or a small admin/sync job that has DB + Redis + NATS):
  - Has DB (orders table, symbol, user, etc.).
  - Can check Redis `GET order:{order_id}`.
  - Can publish to NATS `cmd.order.place`.

### 3.2 Sync flow

1. **Select** from DB: orders with `status = 'pending'` (and optionally `created_at` in a recent window, e.g. last 24–48 hours, to avoid scanning all history).
2. **For each** order_id:
   - **Check Redis:** `GET order:{order_id}`. If key exists, **skip** (order already in engine).
   - If key **missing**:
     - Build **PlaceOrderCommand** from DB row (order_id, user_id, symbol code, side, type, size, limit_price, sl, tp, tif, client_order_id, etc.). Use symbol **code** from the symbols table (e.g. `BTCUSDT`).
     - Set **idempotency_key** to a sync-dedicated value, e.g. `sync-{order_id}`, so the order-engine does not treat it as a duplicate of the original request.
     - **Publish** to NATS subject `cmd.order.place` (same as normal place order), using the same **VersionedMessage** format the order-engine already expects.
3. **Optional:** Run this as a **periodic job** (e.g. every 1–5 minutes) or an **admin endpoint** (e.g. “Sync pending orders”) or both.

### 3.3 Order-engine side

- **No change required** for the basic fix. It already:
  - Subscribes to `cmd.order.place`.
  - Validates, writes Redis, updates cache, and fills on ticks.
- If validation often fails for valid orders (e.g. symbol or balance), that should be fixed separately; sync will still help for orders that failed only because the command was never received.

### 3.4 Edge cases

- **Order already filled in DB but we didn’t update status:** Sync would re-send; order-engine would try to store. If the order is already in Redis as FILLED, we skip (we only sync when Redis key is missing). If it’s missing and we sync, engine might fill again — so sync should only run for orders that are **pending in DB** and **missing in Redis**; that’s the definition we use.
- **Limit order:** After sync, order is in Redis/cache; it will fill when ticks cross the limit price (same as a normal limit order).
- **Duplicate sync runs:** Safe: first run stores in Redis; next run sees key exists and skips.

---

## 4. Summary

| Item | Conclusion |
|------|------------|
| **Root cause (verified)** | Order is not in Redis → order-engine never successfully stored it (command not received or validation failed). |
| **Fix** | Sync pending orders from DB to order-engine: find pending orders missing from Redis and re-publish `PlaceOrderCommand` with idempotency `sync-{order_id}`. |
| **Will it fix this order?** | Yes. Once sync runs for `455f0983-d14e-4c79-9665-1a7f94a0efd0`, it will be stored in Redis and cache and will execute when ticks arrive (subject to market/limit and price rules). |
| **Will it fix the issue in general?** | Yes for any order that is pending in DB but missing from Redis (same root cause). It does not fix “engine down” or “validation too strict” by itself, but it recovers stuck orders. |

---

## 5. Implementation checklist (when you approve)

- [ ] Auth-service (or sync job): query DB for `status = 'pending'` orders (optional: filter by `created_at`).
- [ ] For each order: check Redis `GET order:{order_id}`; if missing, build `PlaceOrderCommand` from DB (symbol code, user, size, type, etc.), set `idempotency_key = "sync-{order_id}"`, publish to `cmd.order.place`.
- [ ] Optional: expose admin endpoint “Sync pending orders” and/or run sync on a timer.
- [ ] Optional: log sync actions (order_id, “synced” / “skipped (already in Redis)”).
- [ ] No change to order-engine for the minimal fix.

After you approve, implementation can start from this plan.
