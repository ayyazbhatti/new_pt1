# Account Summary Real-Time – Full Check and Fixes

## What was checked

1. **Redis keys** – Account summary is stored in `pos:summary:<user_id>` (hash: balance, equity, margin_used, free_margin, margin_level, realized_pnl, unrealized_pnl, updated_at). Keys exist and have data.
2. **Pub/sub** – Channel `account:summary:updated` has 1 subscriber (ws-gateway). Channel `price:ticks` has 2 subscribers (data-provider publishes; auth-service subscribes).
3. **Live test** – For a user with an open position (BTCUSDT), `pos:summary:*` did **not** change over a 12s window (same `updated_at` and `unrealized_pnl`).
4. **Order-engine vs auth-service symbol** – Open positions are stored under `pos:open:BTCUSDT` (feed symbol). Auth-service was looking up `pos:open:BTCUSD` (normalized USDT→USD), so it found **no** positions and exited early.

---

## Root causes

### 1. Symbol mismatch (fixed)

- **Order-engine** stores open positions in Redis under the **feed symbol** (e.g. `pos:open:BTCUSDT`).
- **Auth-service** `price_tick_summary_handler` was normalizing tick symbol to “internal” form (BTCUSDT → BTCUSD) and querying `pos:open:BTCUSD`.
- Result: `position_ids` was always empty, so the handler returned without recomputing or publishing account summary.

**Fix (auth-service):** Use the tick symbol as-is for the open-positions key and for price overrides (no USDT→USD normalization in this path).  
File: `backend/auth-service/src/services/price_tick_summary_handler.rs`.

### 2. Empty `prices` when no groups (fixed)

- Data-provider only pushes entries into `prices` when `group_ids` is non-empty.
- When there are no price groups, it was still publishing to `price:ticks` but with `prices: []`.
- Auth-service does `if prices_array.is_empty() { return Ok(()); }`, so it did nothing on those ticks.

**Fix (data-provider):** When `prices_by_group` is empty, add one default price entry (`g: ""`, raw bid/ask) so auth-service always has at least one price to run with.  
File: `backend/data-provider/src/main.rs`.

---

## Changes made

### `backend/auth-service/src/services/price_tick_summary_handler.rs`

- Removed normalization of tick symbol to `symbol_for_positions` (BTCUSDT → BTCUSD).
- **Open positions key:** `Keys::positions_open_by_symbol(&symbol)` so it uses the same symbol as order-engine (e.g. `pos:open:BTCUSDT`).
- **Price overrides key:** `(symbol.clone(), group_id)` so it matches the position’s symbol (e.g. BTCUSDT) when `fetch_position_aggregates_from_redis` looks up overrides.

### `backend/data-provider/src/main.rs`

- After the loop over `group_ids`, if `prices_by_group.is_empty()`, push one entry: `{ "g": "", "bid": ..., "ask": ... }` (raw price_state.bid/ask).
- Ensures auth-service receives a non-empty `prices` array even when no price groups are configured.

---

## What to do next

1. **Restart auth-service and data-provider** so the new code is in effect.
2. **Re-test:** Pick a user with an open position (e.g. BTCUSDT). Read `pos:summary:<user_id>` `updated_at` and `unrealized_pnl`, wait 10–15 seconds, then read again. You should see `updated_at` (and possibly `unrealized_pnl`) change as ticks flow.
3. **Frontend:** With the same Redis and ws-gateway, account summary in the UI should now update in real time via `account.summary.updated` when ticks trigger recompute and publish.

---

## Optional: REDIS_URL

Auth-service and data-provider must use the **same** Redis (same `REDIS_URL`) so that:
- Data-provider’s `price:ticks` messages are received by auth-service.
- Auth-service’s `pos:open:*` and `pos:by_id:*` reads see the same data as order-engine.

If you run them via the same `.env` or the same start script, they already share Redis. If you run them separately, set `REDIS_URL` to the same value (e.g. `redis://127.0.0.1:6379`).
