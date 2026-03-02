# Account Summary Stale Data — Fix Solution

**Status:** Proposal (awaiting approval)  
**Date:** 2026-03-02  
**Related:** Root cause analysis (symbol key mismatch, cache-only HTTP response, optional `price:ticks` format)

**Verification:** This solution has been cross-checked against the codebase. Fix 1 includes the override-key alignment so that `PriceOverrides` keys match the symbol format stored in position hashes (`pos:by_id:*`), ensuring no regression in PnL calculation.

**In short:** We change only `backend/auth-service/src/services/price_tick_summary_handler.rs`: (1) use payload symbol as-is for `pos:open:*` lookup and for override keys, so tick-driven recompute finds positions and PnL uses the right prices; (2) when `price:ticks` has no `prices` array, build a single (bid, ask) from top-level and run the same logic. No other services or Redis schema are modified.

---

## 1. Problem Summary

The account summary in the bottom dock (Balance, Equity, Margin, Free Margin, Margin Level, RI PNL, UnR Net PNL) shows **old values** and does not update in real time when:

- Prices move (unrealized PnL should change).
- The user expects the HTTP-refetched or WebSocket-pushed summary to reflect the latest state.

**Root causes identified:**

1. **Symbol key mismatch:** Auth-service `price_tick_summary_handler` looks up `pos:open:{SYMBOL_USD}` (e.g. `pos:open:BTCUSD`) while order-engine stores positions under `pos:open:{SYMBOL_USDT}` (e.g. `pos:open:BTCUSDT`), so tick-driven recompute never finds positions and never runs.
2. **HTTP always returns cache:** `GET /api/account/summary` returns Redis cache whenever all fields exist, with no staleness check or forced recompute.
3. **Optional:** When `price:ticks` payload has no `prices` array (e.g. no `price:groups`), the handler errors and skips the tick.

---

## 2. Solution Overview

| # | Fix | Goal |
|---|-----|------|
| 1 | Use same symbol format as order-engine for `pos:open:*` lookup in auth-service. | Tick-driven account summary runs for all symbols; real-time unrealized PnL/equity/free margin updates. |
| 2 | Support both `prices` array and legacy `bid`/`ask` in `price:ticks` handler. | Ticks are processed even when data-provider sends fallback format (no `price:groups`). |
| 3 | Optional: Add cache staleness or “force refresh” behavior for `GET /api/account/summary`. | Reduce risk of serving very old cache if other triggers fail; keep implementation simple. |

We do **not** change order-engine or Redis key schema; we only fix auth-service (and optionally data-provider contract) so that the existing `pos:open:*` keys are used correctly and ticks are always consumable.

---

## 3. Detailed Fixes

### 3.1 Fix 1: Symbol key alignment in `price_tick_summary_handler` (required)

**File:** `backend/auth-service/src/services/price_tick_summary_handler.rs`

**Current logic:**  
Tick symbol from payload (e.g. `BTCUSDT`) is converted to `symbol_for_positions = BTCUSD` and used for:
- `Keys::positions_open_by_symbol(&symbol_for_positions)` → `pos:open:BTCUSD` (no positions found; order-engine uses `pos:open:BTCUSDT`).
- Building `user_overrides`: `.insert((symbol_for_positions.clone(), group_id), (bid, ask))` → key `(BTCUSD, group_id)`.

In `deposits.rs`, `fetch_position_aggregates_from_redis` looks up overrides with `(symbol, group_id)` where `symbol` is read from the position hash (`pos:by_id:*`), which stores the order symbol (e.g. `BTCUSDT`). So override key `(BTCUSD, group_id)` never matches and unrealized PnL from overrides is never used.

**Proposed change:**  
Use the **same symbol as the order-engine and position hashes** everywhere in this handler: payload symbol (e.g. `BTCUSDT`) for both the open-positions lookup and the override map key.

**Implementation (exact changes):**

1. **Remove** the `symbol_for_positions` conversion (the block that does `if symbol.ends_with("USDT") { symbol.replace("USDT", "USD") } else { symbol.clone() }`).
2. **Use `symbol` (payload symbol) for the open-positions key:**
   - `let open_key = Keys::positions_open_by_symbol(&symbol);`
   - So we read from `pos:open:BTCUSDT`, matching order-engine and current Redis keys.
3. **Use `symbol` (not `symbol_for_positions`) when building `user_overrides`:**
   - In the loop over `position_ids`, change:
     - `user_overrides.entry(user_id).or_default().insert((symbol_for_positions.clone(), group_id), (bid, ask));`
     - to:
     - `user_overrides.entry(user_id).or_default().insert((symbol.clone(), group_id), (bid, ask));`
   - So the override key `(BTCUSDT, group_id)` matches the key used in `fetch_position_aggregates_from_redis` when it reads `symbol` from each position hash.
4. **Update the debug log** to use `symbol` instead of `symbol_for_positions` so logs reflect the key actually used.

**Why this is safe and does not disturb other functionality:**

- **Order-engine and Redis:** No change. They continue to use `pos:open:{symbol}` and `pos:by_id:*` with the same symbol format (e.g. `BTCUSDT`). Only auth-service’s reader is aligned.
- **deposits.rs:** No change. It already looks up overrides by `(position.symbol, group_id)`; we only fix the producer of those overrides to use the same symbol.
- **Other callers of `positions_open_by_symbol`:** Only this handler and the same crate’s key builder use it; no other code path is affected.
- **Data-provider / gateway-ws:** No change. They keep publishing and forwarding `price:ticks` as today.

**Risk:** Low. Aligning auth-service with existing Redis key and position hash format; no schema or API change.

**Validation:**  
After deploy: open a position (e.g. BTCUSDT), wait for a few price ticks; confirm Redis `pos:summary:{user_id}` `updated_at` and `unrealized_pnl` change, and that the UI account summary updates (via WS or next HTTP refetch).

---

### 3.2 Fix 2: Support legacy `price:ticks` payload (no `prices` array) (required)

**File:** `backend/auth-service/src/services/price_tick_summary_handler.rs`

**Current logic:**  
Handler requires `payload.get("prices").and_then(|v| v.as_array())` and returns `Err("Missing prices array")` when absent. Data-provider sometimes sends `{ "symbol", "bid", "ask", "ts" }` without `prices`.

**Proposed change:**  
Support both formats so every tick can be processed.

1. **If `prices` is present and non-empty:**  
   Keep current behavior: iterate `prices` (with optional `g` for group), build per-user price overrides, then recompute and cache account summary as today.

2. **If `prices` is missing or empty:**  
   Treat as a single global price:
   - Read `bid` and `ask` from the top-level payload (string or number).
   - Build one override entry for the symbol with an empty or default group key (e.g. `""`) so that `compute_account_summary_inner` can still use this (bid, ask) for unrealized PnL for positions in that symbol.
   - Use the same `positions_open_by_symbol(symbol)` as in Fix 1; for each position, if the position has no `group_id` or we use a single global price, use this (bid, ask) for that symbol when building `user_overrides`.

**Implementation outline:**

- After parsing `symbol`, define `prices_array`:
  - If `payload.get("prices")` is a non-empty array, use it as today (iterate and match by `g` / `group_id`; fallback to first element).
  - Else, if `payload` has `"bid"` and `"ask"` (string or number), build a single-element “virtual” prices array: one object with `"g": ""`, `"bid"` and `"ask"` from the payload. Then run the same downstream loop: for each position we get `group_id` from Redis; when matching prices, no entry will have `g == group_id` (unless group_id is empty), so we fall back to the existing `None => first` branch and use that single (bid, ask) for every position. Insert `(symbol.clone(), group_id)` with that (bid, ask) so each position’s override key matches what `fetch_position_aggregates_from_redis` expects.
- Use `symbol` (from payload) for `positions_open_by_symbol` and for override keys, per Fix 1.

**Risk:** Low. Only adds a branch when `prices` is missing or empty; existing `prices`-based path unchanged.

**Validation:**  
With `price:groups` empty (or data-provider sending fallback format), confirm auth-service logs show tick handling and that `pos:summary:*` and UI update on ticks.

---

### 3.3 Fix 3 (optional): Staleness or force-refresh for `GET /api/account/summary`

**File:** `backend/auth-service/src/routes/deposits.rs` → `get_account_summary`

**Current logic:**  
If Redis hash has all required fields, return cache immediately. No TTL or `updated_at` check.

**Proposed change (choose one):**

- **Option A — Staleness threshold:**  
  If cache exists, parse `updated_at` (RFC3339). If older than e.g. 30 seconds, trigger a background recompute (e.g. `tokio::spawn(compute_and_cache_account_summary(...))`) and still return the current cache this time; next request (or WS push) gets fresh data. Optional: return cache with a header like `X-Account-Summary-Cache-Age-Sec` for debugging.

- **Option B — Simpler:**  
  Do not change HTTP semantics. Rely on Fix 1 and Fix 2 so that tick-driven and event-driven recomputes keep the cache fresh; HTTP continues to return cache when present. Revisit staleness only if stale behaviour persists.

**Recommendation:**  
Implement **Fix 1** and **Fix 2** first; then if product still sees stale summary in edge cases, add **Option A** (staleness threshold + background recompute).

---

## 4. Implementation Order

1. **Fix 1** — In `price_tick_summary_handler.rs`: use payload `symbol` as-is for `positions_open_by_symbol` (open key) and for `user_overrides` keys `(symbol, group_id)`; remove `symbol_for_positions` conversion.
2. **Fix 2** — In the same file: when `prices` is missing or empty, build a single (bid, ask) from top-level payload and run the same downstream loop.
3. **Fix 3** — Optional, only if needed after 1 and 2 (staleness in `get_account_summary`).

No changes to order-engine, core-api, or Redis key schema. Frontend and gateway-ws unchanged.

---

## 5. Testing and Validation

- **Unit / integration (auth-service):**
  - Mock Redis: `pos:open:BTCUSDT` with one position; send `price:ticks` with `symbol: "BTCUSDT"` and either `prices: [...]` or top-level `bid`/`ask`; assert that `compute_and_cache_account_summary_with_prices` is invoked and Redis `pos:summary:{user_id}` is updated.
  - Same with `pos:open:BTCUSD` empty and `pos:open:BTCUSDT` non-empty: only the USDT key should be used (after Fix 1).
- **Manual:**
  - Open a position (e.g. BTCUSDT). Confirm account summary in bottom dock updates as price moves (WS or 5s HTTP refetch).
  - Check Redis: `HGET pos:summary:{user_id} updated_at` and `unrealized_pnl` change after ticks.
- **Regression:**  
  Existing flows (order fill, position close, deposit, etc.) should still trigger recompute and publish; no change to their behaviour.

---

## 6. Performance / Speed Impact

| Aspect | Impact |
|--------|--------|
| **Fix 1** | **Neutral or slightly positive.** We remove the `symbol_for_positions` conversion (no `.replace("USDT", "USD")`). Same number of Redis calls: one `ZRANGE` for `pos:open:{symbol}`, then per-position `HGET`s (status, user_id, group_id), then same `compute_and_cache_account_summary_with_prices` per user. No extra loops or round-trips. |
| **Fix 2** | **Neutral.** When `prices` exists we take the same path as today. When `prices` is missing we build one virtual price and run the same downstream loop (same Redis lookups, same per-user compute). No additional Redis calls, no extra iterations. Parsing `bid`/`ask` from the payload is trivial. |
| **Throttle / coordinator** | **Unchanged.** Per-user throttle (100 ms) and account-summary coordinator publish throttle (250 ms) are not modified. |
| **Redis and CPU** | **Unchanged.** Same keys read, same number of positions and users processed per tick. No new keys or subscriptions. |

**Conclusion:** The fix does not add meaningful work per tick and does not slow down the service. It only corrects the key and payload handling so that the same existing logic runs when it currently does not.

---

## 7. Guarantees and No Regressions (see also §6 Performance)

| Area | Guarantee |
|------|-----------|
| **Order-engine** | No code or config change. Continues to write `pos:open:{symbol}` and `pos:by_id:*` with the same symbol (e.g. BTCUSDT). |
| **Redis schema** | No new keys, no migration. We only fix how auth-service reads existing keys. |
| **Core-api / Frontend / Gateway-ws** | No change. No API or WebSocket contract change. |
| **GET /api/account/summary** | Unchanged in Fix 1 and Fix 2. Still returns cache when present; cache will now be updated by tick-driven recompute. |
| **Event-driven recompute** | Unchanged. Order fill, position open/close, deposit, etc. still call `compute_and_cache_account_summary` as today. |
| **PnL calculation** | Correct. Override key `(symbol, group_id)` matches position hash symbol and group_id, so unrealized PnL uses the tick (bid, ask) we supply. |
| **Legacy payload** | Additive only. When `prices` is missing we derive one (bid, ask) and reuse the same loop; when `prices` exists behaviour is unchanged. |

---

## 8. Rollback

- Fixes are limited to `backend/auth-service` (one module and one route handler).
- Revert the commit(s); redeploy auth-service. No data migration or Redis schema change to roll back.

---

## 9. Approval

Once this solution is reviewed and approved, implementation will:

1. Apply Fix 1 and Fix 2 in `backend/auth-service`.
2. Optionally apply Fix 3 (staleness/force-refresh) if approved.
3. Add or adjust tests as above and run existing tests.

**End of solution document.**
