# Account summary in position cache – real-time (no polling)

This document describes how account summary (Balance, Equity, Margin, Free Margin, Margin Level, RI PnL, UnR PnL) is calculated, where it lives in the position cache, what is already event-driven, and what is missing for **real-time, no delay, no polling**.

---

## 1. Where account summary is calculated and stored

| What | Where | Redis key (position cache) |
|------|--------|----------------------------|
| **Calculation** | Auth-service: `compute_account_summary_inner()` in `backend/auth-service/src/routes/deposits.rs` | — |
| **Input: position aggregates** | Read from Redis: `pos:{user_id}` (SET) + `pos:by_id:{position_id}` (HASH) for margin, unrealized_pnl, realized_pnl, status | Same position cache |
| **Input: ledger** | Postgres: `transactions` (deposits/withdrawals, completed, USD) | — |
| **Output (cached)** | Written by `compute_and_cache_account_summary()` | **`pos:summary:{user_id}`** (HASH) |
| **Pushed to clients** | Auth-service publishes JSON to Redis channel **`account:summary:updated`** → WS-gateway subscribes → broadcasts to user’s WebSocket connections | Channel, not a key |

Formulas (all in `compute_account_summary_inner`):

- **Balance** = (deposits − withdrawals) + realized_pnl  
- **Equity** = balance + unrealized_pnl  
- **Margin (margin_used)** = sum of `margin` over **open** positions (from Redis)  
- **Free margin** = equity − margin_used (or 0)  
- **Margin level** = (equity / margin_used) × 100 % or `"inf"`  
- **RI PnL (realized)** = sum of `realized_pnl` over **all** positions (Redis)  
- **UnR PnL (unrealized)** = sum of `unrealized_pnl` over **open** positions (Redis)

So: **all position-derived numbers (Margin, RI PnL, UnR PnL) and the final summary are already calculated from the same position cache** and written into `pos:summary:{user_id}`. No polling is used for this.

---

## 2. Current triggers (event-driven, no polling)

Summary is recomputed and cached only when something changes. **No timer or polling.**

| Trigger | Where it runs | What happens |
|--------|----------------|--------------|
| **Order filled** | Order-engine → NATS `evt.order.updated` → auth-service `OrderEventHandler` | `compute_and_cache_account_summary(user_id)` → read pos:* + DB, compute, write `pos:summary:{user_id}`, publish `account:summary:updated` |
| **Order cancelled** | Same chain | Same |
| **Position updated/closed** | Order-engine → NATS `evt.position.updated` → auth-service `PositionEventHandler` | Same |
| **Deposit approved** | Auth-service `approve_deposit` in deposits.rs | Same |
| **GET /api/account/summary** (cache miss) | Auth-service `get_account_summary` | Compute, then `compute_and_cache_account_summary` so next time is cache hit |

So today:

- **Margin, RI PnL, Balance, Equity, Free margin, Margin level** are updated in real time on **order / position / deposit** events.
- **UnR PnL** in the cache is the value stored in `pos:by_id:*` → `unrealized_pnl`. That field is updated by order-engine only when a position is **closed** or **modified** (e.g. add to position), **not on every price tick**. So between two such events, UnR PnL in `pos:summary` is **stale**.

---

## 3. What is missing for “real-time, no delay”

- **Unrealized PnL** should reflect **current price**, not the last value written at close/add.
- Today nothing **subscribes to price ticks** to recompute summary. So:
  - No polling ✅  
  - But also **no tick-driven update** → UnR PnL (and thus Equity, Free margin, Margin level) in the cache lag until the next order/position/deposit event.

To get **real-time** summary (including live UnR PnL) **without polling**:

- Keep the same event-driven model.
- Add a **tick-driven path**: when a **price tick** arrives (event), recompute summary for **affected users** using **that tick’s price** for unrealized PnL, then write `pos:summary` and publish `account:summary:updated`.

So the only missing piece is: **react to price ticks and recompute (and cache) account summary for users with open positions in that symbol.**

---

## 4. End-to-end flow (current + proposed)

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────────────────────────────┐
│  Order Engine   │     │    NATS      │     │  Auth-service                           │
│  - Fill/close   │────▶│ evt.order.*  │────▶│  OrderEventHandler                       │
│  - Writes       │     │ evt.position.*│────▶│  PositionEventHandler                   │
│  pos:* in Redis │     └──────────────┘     │    → compute_and_cache_account_summary  │
└─────────────────┘                          │    → read pos:* + DB                      │
                                             │    → write pos:summary:{user_id}         │
                                             │    → PUBLISH account:summary:updated    │
┌─────────────────┐     ┌──────────────┐     └─────────────────────────────────────────┘
│ Data-provider   │     │    Redis     │                          │
│ - Price ticks   │────▶│ price:ticks  │──────────────────────────┼─────────────────────┐
│ - Publishes     │     │ (channel)    │                          │                     │
└─────────────────┘     └──────────────┘                          ▼                     ▼
                        CURRENT: WS-gateway              ┌─────────────────┐   ┌─────────────────┐
                        subscribes to price:ticks        │ account:summary│   │  WS-gateway     │
                        only to broadcast ticks          │ :updated       │   │  subscribes     │
                        to frontend.                     │ (channel)      │   │  → push to UI   │
                                                         └─────────────────┘   └─────────────────┘

PROPOSED (missing today):
  Auth-service (or a dedicated worker) also subscribes to Redis "price:ticks".
  On each tick:
    1. Parse symbol and prices (e.g. per-group bid/ask).
    2. Get open position IDs for that symbol from Redis: pos:open:{symbol} (ZSET).
    3. For each position_id, get user_id (and group_id) from pos:by_id:{id}.
    4. For each affected user_id, compute summary with OVERRIDE: use this tick’s bid/ask
       for unrealized PnL instead of stored unrealized_pnl in Redis.
    5. Write pos:summary:{user_id}, PUBLISH account:summary:updated.
  → No polling; event = one price tick. UnR PnL (and Equity, etc.) stay in sync with last tick.
```

---

## 5. What we have already

| Component | Status |
|----------|--------|
| Position cache keys | ✅ `pos:{user_id}`, `pos:by_id:{id}`, `pos:summary:{user_id}` in `redis-model` |
| Reading position aggregates from Redis | ✅ `fetch_position_aggregates_from_redis()` in deposits.rs |
| Balance/equity/margin formulas | ✅ In `compute_account_summary_inner()` |
| Writing summary to Redis | ✅ `compute_and_cache_account_summary()` → HSET `pos:summary:{user_id}` |
| Publishing to WS | ✅ PUBLISH `account:summary:updated` → WS-gateway → `broadcast_account_summary()` |
| Triggers on order/position/deposit | ✅ NATS handlers + deposit approval |
| No polling | ✅ All triggers are event-based |

---

## 6. What we need to add (for real-time UnR PnL)

1. **Subscribe to Redis `price:ticks` in auth-service**  
   Same pattern as existing Redis subscriber for `wallet:balance:request`: a long-lived task that subscribes to `price:ticks` and, for each message, runs the logic below.

2. **Resolve “affected users” from the tick**  
   - Tick payload: e.g. `{ "symbol": "BTCUSDT", "ts": ..., "prices": [ { "g": "<group_id>", "bid": "...", "ask": "..." }, ... ] }`.  
   - Get open position IDs for symbol: **`pos:open:{symbol}`** (ZSET) — keys are in `redis-model` (see Lua scripts). If not exposed, add `Keys::positions_open_by_symbol(symbol)`.  
   - For each position_id, HGET `pos:by_id:{id}` → `user_id`, `group_id`.  
   - Build set of (user_id, group_id) that have open positions in this symbol.

3. **Compute summary with live price for unrealized**  
   - Add an optional “override prices” to the summary pipeline, e.g. `compute_account_summary_inner(..., price_overrides: Option<HashMap<(Symbol, GroupId), (Bid, Ask)>>)`.  
   - When aggregating from Redis in `fetch_position_aggregates_from_redis` (or a variant): for **open** positions, if override (symbol, group_id) exists, compute unrealized_pnl from (current_bid/ask − entry) × size instead of using stored `unrealized_pnl`.  
   - For each affected user, call this with the tick’s (bid, ask) for that user’s group_id, then `compute_and_cache_account_summary` (write `pos:summary`, publish).

4. **Optional: throttle per user**  
   To avoid recomputing on every tick for the same user (e.g. 10 ticks/sec), throttle: e.g. “at most one summary update per user per 100 ms” or “per 200 ms”. Still event-driven (tick), not polling.

5. **Redis key for “open positions by symbol”**  
   Order-engine Lua already uses `pos:open:{symbol}` (ZSET). Ensure auth-service can read it (e.g. add `Keys::positions_open_by_symbol(symbol)` in redis-model if needed).

---

## 7. Summary table

| Field | Source today | Real-time today? | After tick-driven update |
|-------|--------------|------------------|---------------------------|
| Balance | DB + Redis (realized_pnl) | ✅ On order/position/deposit | Same |
| Margin | Redis (open positions) | ✅ On order/position | Same |
| RI PnL | Redis (all positions) | ✅ On order/position | Same |
| UnR PnL | Redis (stored per position) | ❌ Stale until next event | ✅ Updated on each tick for affected users |
| Equity | balance + unrealized_pnl | ❌ Same as UnR | ✅ Real-time |
| Free margin | equity − margin | ❌ Same as UnR | ✅ Real-time |
| Margin level | equity / margin | ❌ Same as UnR | ✅ Real-time |

So: **all calculations already use the same position cache and are event-driven (no polling).** The only gap is **recomputing and caching summary when prices change**, by subscribing to **price:ticks** and updating **pos:summary** (and publishing) for affected users with **live unrealized PnL**. That gives you real-time, no delay, no polling, everything in the position cache.

---

## 8. File reference

| Purpose | File |
|--------|------|
| Summary calculation + cache write | `backend/auth-service/src/routes/deposits.rs` (`compute_account_summary_inner`, `fetch_position_aggregates_from_redis`, `compute_and_cache_account_summary`, `get_account_summary`) |
| Order event → summary | `backend/auth-service/src/services/order_event_handler.rs` |
| Position event → summary | `backend/auth-service/src/services/position_event_handler.rs` |
| Deposit approval → summary | `backend/auth-service/src/routes/deposits.rs` (approve_deposit) |
| Redis key helpers | `crates/redis-model/src/keys.rs` (`positions_set`, `position_by_id`, `position_summary` / `account_summary`) |
| WS push | `backend/ws-gateway/src/stream/broadcaster.rs` (`account:summary:updated` → `broadcast_account_summary`) |
| Price ticks published | `backend/data-provider` (Redis `price:ticks`) |
| Position cache (open by symbol) | Order-engine Lua: `pos:open:{symbol}` (ZSET) |

**Implemented:** Auth-service subscribes to Redis `price:ticks` in `services::price_tick_summary_handler::PriceTickSummaryHandler`. On each tick it resolves affected users from `pos:open:{symbol}`, builds per-user `PriceOverrides`, and calls `compute_and_cache_account_summary_with_prices` with a 100ms per-user throttle.

**All users in Redis:** On startup, auth-service runs `services::account_summary_cache_warmup::warm_all_users`: it loads every user ID from the `users` table and calls `compute_and_cache_account_summary` for each. So `pos:summary:{user_id}` is populated for all users, not only those who log in or load the summary. After that, order/position events and price ticks keep the cache updated.

If you tell me your preferred place for the tick subscriber (auth-service vs small worker) and whether you want per-user throttling, the next step is to implement the subscription and the “affected users + override price” computation path.
