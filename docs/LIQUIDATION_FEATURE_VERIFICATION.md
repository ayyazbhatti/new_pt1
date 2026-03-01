# Liquidation Feature – Verification (Will It Work 100%?)

## Requirement Recap

1. **Trigger:** When user margin level **&lt; 0** → close all positions.
2. **Position status:** Those positions must get status **liquidated** (not closed).
3. **Performance:** Use the **same Redis** as account summary (`pos:summary:{user_id}`) so the flow stays **&lt; 5 ms**.

---

## 1. Trigger (Margin Level &lt; 0)

| Check | Status | Detail |
|-------|--------|--------|
| Where margin level is computed | ✅ | `compute_account_summary_inner` in `backend/auth-service/src/routes/deposits.rs` (lines 1028–1032). |
| Same place writes Redis summary | ✅ | Right after, the summary (including `margin_level`) is written to `pos:summary:{user_id}` in `compute_and_cache_account_summary_with_prices`. |
| Can we branch on “margin_level &lt; 0”? | ✅ | `margin_level` is a string (`"123.45"` or `"inf"`). Parse as `f64`: negative value ⇒ margin level below zero. `"inf"` and invalid ⇒ no liquidation. |
| Existing pattern | ✅ | `try_publish_stop_out_close_all` already does: parse margin_level → compare to threshold → cooldown → publish `cmd.position.close_all`. We add a **separate** `try_publish_liquidation_close_all` that triggers when `margin_value < 0` (no threshold from DB). |

**Conclusion:** Trigger in the same code path that computes and writes account summary is correct and keeps everything in one place (&lt; 5 ms).

---

## 2. Close All Positions

| Check | Status | Detail |
|-------|--------|--------|
| Existing close-all command | ✅ | NATS `cmd.position.close_all` with payload `{ user_id, correlation_id }`. |
| Who handles it | ✅ | Order-engine `position_handler.handle_close_all_positions` (apps/order-engine/src/engine/position_handler.rs). |
| What it does | ✅ | SMEMBERS positions set → for each OPEN position → `atomic_close_position` → publish `event.position.closed`. |
| Need to pass “reason” | ✅ | Payload can include `"reason": "liquidated"`. Order-engine already has `trigger_reason: Some("stop_out")` in the event; we add a branch for `reason == "liquidated"`. |

**Conclusion:** Reusing `cmd.position.close_all` with an extra `reason` field is enough; no new command needed.

---

## 3. Position Status = Liquidated (Not Closed)

| Layer | Current state | Change needed |
|-------|----------------|---------------|
| **DB** | ✅ | `position_status` enum already has `'open', 'closed', 'liquidated'` (database/schema.sql line 24). |
| **Contracts (Rust)** | ⚠️ | `PositionStatus` in crates/contracts/src/enums.rs has only `Open`, `Closed`. **Add `Liquidated`.** |
| **Redis (position hash)** | ⚠️ | Lua sets `status` to `'CLOSED'` only (atomic_close_position.lua). **Add optional close_reason; if "liquidated" set `'LIQUIDATED'`.** |
| **Order-engine Lua API** | ⚠️ | `atomic_close_position(conn, position_id, exit_price, close_size)` – no reason. **Add optional 5th arg: close_reason.** |
| **Order-engine close_all** | ⚠️ | Uses `trigger_reason: Some("stop_out")`, does **not** call `publish_position_updated` → DB is not updated for close_all today. **Call `publish_position_updated(..., status_override)` after each close so auth gets `evt.position.updated` with status Liquidated/Closed.** |
| **Auth position_event_handler** | ⚠️ | Maps `PositionStatus::Closed` → `"closed"`. **Map `PositionStatus::Liquidated` → `"liquidated"`.** |
| **position_events.rs (order-engine)** | ⚠️ | `publish_position_updated` maps only OPEN/CLOSED from Redis. **Map LIQUIDATED; allow status_override = Liquidated.** |

**Conclusion:** Status “liquidated” is supported in DB and can be supported end-to-end with the listed changes (contracts, Lua, order-engine, auth, position_events).

---

## 4. Same Redis, &lt; 5 ms

| Point | Status | Detail |
|-------|--------|--------|
| Account summary key | ✅ | Single key `pos:summary:{user_id}` (hash). |
| Where decision is made | ✅ | Inside `compute_and_cache_account_summary_with_prices`, right after `compute_account_summary_inner` returns. We already have `margin_level` in memory; no extra Redis read. |
| Optional: store liquidation level | ✅ | If we want the threshold (e.g. 0) in Redis for visibility/config, add one field to the **same** hash, e.g. `liquidation_level` = "0", when writing the summary. Still one write to the same key. |
| Cooldown key | ✅ | Use a **different** key for liquidation cooldown (e.g. `pos:liquidation:triggered:{user_id}`) so it doesn’t conflict with stop_out cooldown. One SET NX EX in Redis. |
| NATS publish | ✅ | Fire-and-forget; doesn’t block the &lt; 5 ms path. |

**Conclusion:** Trigger, cooldown, and optional liquidation_level all fit in the same summary flow and same Redis key; no extra round-trips for the decision.

---

## 5. Edge Cases

| Case | Handling |
|------|----------|
| margin_level is `"inf"` (no positions) | Parse fails or returns non-finite → do not liquidate. ✅ |
| margin_level is negative string (e.g. "-12.34") | Parse as f64 → &lt; 0 → trigger liquidation. ✅ |
| Multiple rapid recomputes | Cooldown (e.g. 60s) per user, same pattern as stop_out. ✅ |
| User has no open positions | close_all runs; SMEMBERS returns empty or only non-OPEN; no positions closed. ✅ |
| Order-engine down | NATS publish succeeds; when order-engine is back, next account summary recompute can trigger again (after cooldown). ✅ |

---

## 6. Gaps Found (Must Fix for 100%)

1. **close_all does not send `evt.position.updated`**  
   So today, after stop_out close_all, the DB is **not** updated (only account summary is refreshed from `event.position.closed`).  
   **Fix:** In `handle_close_all_positions`, after each successful `atomic_close_position`, call `publish_position_updated(conn, position_id, status_override)` with `status_override = Liquidated` or `Closed` depending on `reason`. Then auth will persist status **liquidated** (or closed) in DB.

2. **Contracts and auth only know Open/Closed**  
   **Fix:** Add `Liquidated` to `PositionStatus` and map it in auth and in `publish_position_updated` (Redis ↔ enum).

3. **Lua always sets CLOSED**  
   **Fix:** Add optional close_reason argument to Lua and to `atomic_close_position`; in Lua set `status` to `'LIQUIDATED'` when reason is liquidated.

---

## 7. Implementation Checklist (Summary)

- [ ] **Auth (deposits.rs):** Add `try_publish_liquidation_close_all(margin_level)` (trigger when parsed value &lt; 0). Call it from `compute_and_cache_account_summary_with_prices` (same block as stop_out). Use cooldown key `pos:liquidation:triggered:{user_id}`. Publish `cmd.position.close_all` with `"reason": "liquidated"`. Optionally set `liquidation_level` in `pos:summary:{user_id}` hash.
- [ ] **Contracts:** Add `Liquidated` to `PositionStatus` (and serde).
- [ ] **Order-engine Lua:** Extend `atomic_close_position` with optional ARGV for close_reason; if `"liquidated"` then HSET status `'LIQUIDATED'`, else `'CLOSED'`.
- [ ] **Order-engine lua.rs:** Add optional `close_reason` parameter to `atomic_close_position` and pass it to the script.
- [ ] **Order-engine position_handler:** In `handle_close_all_positions`, read `reason` from payload. After each successful close, call `publish_position_updated(..., status_override)` with `Liquidated` if reason is liquidated else `Closed`. Set `trigger_reason` in PositionClosedEvent to `"liquidated"` when reason is liquidated.
- [ ] **Order-engine position_events.rs:** In `publish_position_updated`, support `PositionStatus::Liquidated` (override and when reading Redis `"LIQUIDATED"`).
- [ ] **Auth position_event_handler:** Map `PositionStatus::Liquidated` → `"liquidated"` for DB; treat like Closed for `closed_at` (set to Some(ts)).

---

## 8. Verdict

**Yes, this approach will work 100%** provided we:

1. Add the liquidation trigger (margin level &lt; 0) in the same place that computes and writes account summary (same Redis, &lt; 5 ms).
2. Pass a liquidation reason through the close_all path and into Lua so Redis and events carry status **liquidated**.
3. Add `Liquidated` to the contract enum and map it everywhere (Redis, NATS events, DB).
4. Fix the existing gap: have close_all publish `evt.position.updated` with the correct status so the DB is updated to liquidated (or closed for stop_out).

No architectural blocker found; only the listed code changes are required.
