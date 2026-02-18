# Redis cache – trading platform

This document describes how Redis is used as a cache (and source of truth for hot data) in the trading platform. It focuses on **positions** today and is intended as a reference when adding more cached data.

---

## Overview

- **Shared key schema:** `crates/redis-model/src/keys.rs` defines all key builders. Use these everywhere so keys stay consistent.
- **Writers:** Order Engine (positions/orders/balance), Auth Service (positions SL/TP, account summary, markup), Data Provider (ticks, markup).
- **Readers:** Auth Service (positions API, account summary), WS Gateway (prices), Data Provider (markup, ticks).
- **Connection:** `REDIS_URL` (default `redis://localhost:6379`). Same Redis instance is used across services.

---

## Position cache (centralized)

All position-related and account-summary data lives under the **`pos:*`** namespace so one cache holds positions and the derived summary (Balance, Equity, Margin, PnL, etc.). Auth-service computes the summary from Postgres (deposits/withdrawals) + Redis position data and stores it under `pos:summary:{user_id}`.

### Position-related keys (current usage)

Positions are the main cached entity for the user trading panel. Data is written by the Order Engine (and Auth Service for SL/TP updates) and read by the Auth Service for `GET /v1/users/:user_id/positions`.

### 1. User’s position IDs (set)

| Key pattern | Type | Builder | Description |
|-------------|------|---------|-------------|
| `pos:{user_id}` | SET | `Keys::positions_set(user_id)` | Set of position IDs (UUIDs as strings) for that user. Includes open and closed positions. |

- **Written by:** Order Engine (Lua `atomic_fill_order.lua` → SADD when creating/updating position; atomic_close may SREM old id and SADD new when migrating).
- **Read by:** Auth Service `get_user_positions` (SMEMBERS) to get the list of position IDs, then each position is loaded by ID.

### 2. Position by ID (hash)

| Key pattern | Type | Builder | Description |
|-------------|------|---------|-------------|
| `pos:by_id:{position_id}` | HASH | `Keys::position_by_id(position_id)` | One hash per position. All fields below are strings (or "null") in Redis. |

**Hash fields (position payload):**

| Field | Description | Example |
|-------|-------------|---------|
| `user_id` | Owner (UUID) | `"550e8400-e29b-..."` |
| `symbol` | Instrument | `"BTCUSDT"` |
| `group_id` | User’s group (optional) | UUID or `""` |
| `side` | `LONG` or `SHORT` | `"LONG"` |
| `size` | Position size | `"0.5"` |
| `entry_price` | Entry price | `"50000.00"` |
| `avg_price` | Average fill price | `"50000.00"` |
| `leverage` | Leverage | `"10"` |
| `margin` | Margin used | `"2500.00"` |
| `unrealized_pnl` | Unrealized P&amp;L | `"0"` or number |
| `realized_pnl` | Realized P&amp;L | `"0"` or number |
| `status` | `OPEN` or `CLOSED` | `"OPEN"` |
| `opened_at` | Open time (ms) | `"1700000000000"` |
| `updated_at` | Last update (ms) | `"1700000000000"` |
| `sl` | Stop-loss price or `null` | `"49000"` or `"null"` |
| `tp` | Take-profit price or `null` | `"52000"` or `"null"` |
| `original_size` | Size before close (closed positions) | optional |
| `exit_price` | Exit price (closed positions) | optional |
| `closed_at` | Close time ms (closed positions) | optional |

- **Written by:** Order Engine (Lua scripts HSET on fill/close; Rust `execution.rs` `set_redis_hash` for PositionModel). Auth Service updates `sl`/`tp` (and SL/TP indexes) in `update_position_sltp`.
- **Read by:** Auth Service `get_user_positions` (HGETALL per ID), `update_position_sltp` (HGETALL), position close handler; Order Engine position_handler (HGETALL), Lua scripts.

### 3. SL/TP indexes (per-symbol sorted sets)

| Key pattern | Type | Description |
|-------------|------|-------------|
| `pos:sl:{symbol}` | ZSET | Score = SL price, member = position_id. Used to find positions whose SL is triggered by current price. |
| `pos:tp:{symbol}` | ZSET | Score = TP price, member = position_id. Used for TP triggers. |

- **Written by:** Order Engine (Lua: ZADD when creating/updating position with SL/TP). Auth Service (ZADD/ZREM when user updates SL/TP via API).
- **Read by:** Order Engine (or dedicated service) for SL/TP trigger checks.

### 4. Open positions by symbol (sorted set)

| Key pattern | Type | Description |
|-------------|------|-------------|
| `pos:open:{symbol}` | ZSET | Score = entry price, member = position_id. Used to track open positions per symbol (e.g. for fills/aggregates). |

- **Written by:** Order Engine Lua scripts (ZADD when opening/adding to position).
- **Read by:** Order Engine / trigger logic as needed.

### 5. Account summary (Bottom Dock) – under position cache

| Key pattern | Type | Builder | Description |
|-------------|------|---------|-------------|
| `pos:summary:{user_id}` | HASH | `Keys::position_summary(user_id)` or `Keys::account_summary(user_id)` | Cached account summary: balance, equity, margin_used, free_margin, margin_level, realized_pnl, unrealized_pnl, updated_at. |

- **Written by:** Auth Service `compute_and_cache_account_summary()` after computing from DB (deposits/withdrawals) + Redis position aggregates (`pos:{user_id}`, `pos:by_id:*`).
- **Read by:** Auth Service `get_account_summary()` (GET /api/account/summary). On hit returns this; on miss computes, writes here, returns.
- **Pub/Sub:** After writing, auth-service publishes to channel `account:summary:updated` for real-time WS updates.

Keeping this key under `pos:*` makes the position cache the single place for position data and the derived summary (PnL, margin, etc.).

### 6. Legacy / compatibility

- `position:{id}` (GET/set) – old JSON position format; Lua may still read for backward compatibility. Prefer `pos:by_id:{id}` for all new code.

---

## Other keys in the same Redis (for context)

Defined in `crates/redis-model/src/keys.rs`; used by auth-service, order-engine, data-provider, or ws-gateway.

| Key / pattern | Type | Builder | Purpose |
|---------------|------|---------|---------|
| `tick:{symbol}` | HASH | `Keys::tick(symbol)` | Latest bid/ask tick (data-provider). |
| `user:{user_id}` | HASH | `Keys::user(user_id)` | User profile (group, leverage profile, status). |
| `bal:{user_id}:{currency}` | HASH | `Keys::balance(user_id, currency)` | Balance (available, locked, equity, etc.). |
| `ord:{user_id}:open` | ZSET | `Keys::orders_open(user_id)` | Open order IDs. |
| `ord:by_id:{order_id}` | HASH | `Keys::order_by_id(order_id)` | Order payload. |
| `sym:{symbol}` | HASH | `Keys::symbol(symbol)` | Symbol config. |
| `levprof:all`, `levprof:{id}`, `levprof:{id}:tiers`, `levtier:{id}` | — | `Keys::*` | Leverage profiles and tiers. |
| `psprof:*` | — | `Keys::*` | Price stream profiles. |
| `idempo:{user_id}:{key}` | — | `Keys::idempotency(...)` | Idempotency keys. |
| `pos:summary:{user_id}` | HASH | `Keys::position_summary(user_id)` / `Keys::account_summary(user_id)` | Cached account summary for Bottom Dock (auth-service). Stored under position cache. See [Account summary (Bottom Dock)](#account-summary-bottom-dock) below. |

Data-provider and admin markup also use custom keys (e.g. `price:groups`, markup by group/symbol); see those services for details.

---

## Data flow (positions)

1. **Order fill (Order Engine)**  
   Lua script `atomic_fill_order.lua` runs: updates or creates position in `pos:by_id:{id}`, updates `pos:{user_id}` set, updates `pos:open:{symbol}` and `pos:sl:{symbol}` / `pos:tp:{symbol}` if SL/TP set.

2. **Position close (Order Engine)**  
   Lua script `atomic_close_position.lua`: sets position status to CLOSED, updates size/exit_price/realized_pnl/closed_at; index cleanup may SREM from `pos:{user_id}` or leave ID in set (implementation-specific).

3. **SL/TP update (Auth Service)**  
   `update_position_sltp`: HGETALL `pos:by_id:{id}`, HSET `sl`/`tp`, and ZADD/ZREM `pos:sl:{symbol}` / `pos:tp:{symbol}`.

4. **List positions (Auth Service)**  
   `get_user_positions`: SMEMBERS `pos:{user_id}`, then for each ID HGETALL `pos:by_id:{id}`, convert to JSON and return.

5. **Frontend**  
   Calls `GET /v1/users/:userId/positions` (auth-service) and optionally receives WebSocket position updates (driven by events that reflect the same Redis state).

---

## Account summary (Bottom Dock)

The **Bottom Dock** stats bar (Balance, Equity, Margin, Free Margin, Bonus, Margin Level, RI PNL, UnR Net PNL) is filled from the **account summary** API and kept in sync via WebSocket.

### Where it’s shown (frontend)

- **File:** `src/features/terminal/components/BottomDock.tsx`
- **Section:** “Bottom Stats Bar” (around lines 1096–1150)
- **State:** `accountSummary` (`AccountSummaryResponse` from `@/features/wallet/api`)
- **Initial load:** On mount, `fetchAccountSummary()` → `GET /api/account/summary`
- **Real-time:** WebSocket subscription to `account.summary.updated`; payload is applied to `accountSummary`

### Where values are calculated (backend)

- **Service:** auth-service  
- **File:** `backend/auth-service/src/routes/deposits.rs`
- **Entry:** `compute_account_summary_inner(pool, redis, user_id)`

**Formulas:**

| Field | Calculation |
|-------|-------------|
| **Balance** | `(deposits - withdrawals) + realized_pnl` — deposits/withdrawals from Postgres `transactions` (completed, USD). |
| **Margin** (margin_used) | Sum of `margin` over **open** positions (from Redis or DB). |
| **Unrealized PnL** | Sum of `unrealized_pnl` over **open** positions. |
| **Realized PnL** (RI PNL) | Sum of `realized_pnl` over **all** positions (open + closed). |
| **Equity** | `balance + unrealized_pnl`. |
| **Free Margin** | `equity - margin_used` (or 0 if negative). |
| **Margin Level** | `(equity / margin_used) * 100` %, or `"inf"` if no margin used. |
| **Bonus** | Not from API; UI shows hardcoded `$0.00` in BottomDock. |

Position-derived fields (margin_used, unrealized_pnl, realized_pnl) are read from **Redis** when available (`fetch_position_aggregates_from_redis`), so they match the Positions tab; on Redis miss, auth-service falls back to Postgres `positions` table.

### Redis cache used for account summary

1. **Position aggregates (input to calculation)**  
   Same as the Positions tab:
   - `pos:{user_id}` (SET) – list of position IDs  
   - `pos:by_id:{position_id}` (HASH) – per-position `margin`, `unrealized_pnl`, `realized_pnl`, `status`  
   Used inside `fetch_position_aggregates_from_redis()` to compute margin_used, unrealized_pnl, realized_pnl.

2. **Cached summary (API response)**  
   - **Key:** `pos:summary:{user_id}` (HASH) — builder: `Keys::position_summary(user_id)` or `Keys::account_summary(user_id)` (alias). Part of the centralized position cache.  
   - **Fields:** `balance`, `equity`, `margin_used`, `free_margin`, `margin_level`, `realized_pnl`, `unrealized_pnl`, `updated_at`  
   - **Written by:** `compute_and_cache_account_summary()` after computing the summary (e.g. after order/position events, deposit/withdrawal approval).  
   - **Read by:** `get_account_summary()` handler; on cache hit it returns this; on miss it calls `compute_account_summary_inner()`, then `compute_and_cache_account_summary()` to fill the cache and return.

3. **Pub/Sub (real-time updates)**  
   After writing the HASH, auth-service publishes the full summary JSON to Redis channel **`account:summary:updated`**. Subscribers (e.g. WS gateway) push `account.summary.updated` to the client so the Bottom Dock updates without a full page reload.

---

## Adding new cached data

- **Key namespace:** Use a short prefix (e.g. `pos:`, `ord:`, `bal:`) and document it in this file and in `crates/redis-model/src/keys.rs`.
- **Key builders:** Add a function in `Keys` in `crates/redis-model/src/keys.rs` and use it in all services (no raw `format!("...")` in app code).
- **Types:** Prefer HASH for struct-like data (field names, easy partial updates); use SET/ZSET when you need membership or range queries (e.g. “all IDs for user”, “positions by SL price”).
- **Writers/readers:** Document which service writes and which reads each key; avoid multiple writers for the same key unless you use Lua or another coordination mechanism.
- **TTL:** If you add cache-only data (e.g. session, rate limits), consider setting TTL (EXPIRE) in the writer.

---

## References

- Key builders: `crates/redis-model/src/keys.rs`
- Position/order models: `crates/redis-model/src/models.rs`
- Auth Service positions API: `backend/auth-service/src/routes/deposits.rs` (`get_user_positions`, `update_position_sltp`, close position)
- Order Engine execution: `apps/order-engine/src/execution.rs`, `apps/order-engine/src/engine/position_handler.rs`
- Lua scripts: `apps/order-engine/lua/atomic_fill_order.lua`, `apps/order-engine/lua/atomic_close_position.lua`
