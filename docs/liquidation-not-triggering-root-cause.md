# Liquidation not triggering — root cause analysis

**Context:** After adding the “Enable liquidation email” toggle in the settings panel, users report that liquidation no longer triggers. **No code changes have been made; this document only analyses the cause.**

---

## 1. Does the toggle affect whether liquidation triggers?

**No.** The toggle only controls whether the user receives an **email** after a position is liquidated. It does not affect:

- Whether `cmd.position.close_all` is published
- Whether the order-engine closes positions
- Whether margin level is computed or checked

**Evidence:**

- **Trigger path:** Liquidation is triggered in `backend/auth-service/src/routes/deposits.rs`:
  - `try_publish_liquidation_close_all(redis, user_id, &margin_level)` is called from `compute_and_cache_account_summary_with_prices` when `margin_level` parses to a value **&lt; 0**.
  - This function has **no** reference to `get_enable_liquidation_email` or any user preference. It only checks margin level and a Redis cooldown, then publishes to NATS.

- **Email path:** `get_enable_liquidation_email` is used only in `create_liquidation_notifications_and_push` in the same file (~line 1467), **after** positions are already closed and `event.position.closed` has been received. It only gates the “Send HTML email to user” block. Notification insert, Redis push, and admin notifications always run.

So the toggle cannot stop liquidation from triggering. The fact that “liquidation doesn’t trigger” after adding the toggle is either coincidental (same timeframe as other changes) or due to a different bug.

---

## 2. How liquidation is supposed to trigger

1. **auth-service** recomputes account summary (including `margin_level`) for the user. This happens:
   - On **price ticks** (Redis `price:ticks`), for users with open positions on that symbol, via `price_tick_summary_handler` → `compute_and_cache_account_summary_with_prices`.
   - On **events** (e.g. `event.position.closed`, order fill, deposit) via `compute_and_cache_account_summary` → same function with `price_overrides: None`.

2. Inside `compute_and_cache_account_summary_with_prices`, after computing and caching the summary:
   - `try_publish_stop_out_close_all(...)` runs if `margin_level < stop_out_threshold`.
   - `try_publish_liquidation_close_all(redis, user_id, &margin_level)` runs if **`margin_level < 0`**.

3. **try_publish_liquidation_close_all** sets a Redis cooldown and publishes **`cmd.position.close_all`** on NATS with `reason: "liquidated"`.

4. **order-engine** subscribes to `cmd.position.close_all`, and `position_handler.handle_close_all_positions` closes each OPEN position (using last tick for exit price) and publishes `event.position.closed` with `trigger_reason: "liquidated"`.

5. **auth-service** receives `event.position.closed`; if `trigger_reason == "liquidated"` it spawns `create_liquidation_notifications_and_push` (notification + optional email).

So liquidation “not triggering” can only happen if:

- **A.** auth-service never sees `margin_level < 0` (e.g. summary not recomputed on ticks, or wrong data), or  
- **B.** auth-service publishes `cmd.position.close_all` but order-engine does not close positions (e.g. no tick for exit price, so each position is skipped).

---

## 3. Root cause 1 — Margin level not updated on ticks (same as stale account summary)

**Symptom:** Liquidation never fires when margin goes negative because `margin_level` in the recompute is stale or the recompute never runs for the user on price ticks.

**Cause:** The same bug that made the account summary show old data affected liquidation:

- **price_tick_summary_handler** (auth-service) subscribes to Redis `price:ticks` and, for each symbol in the payload, looks up open positions to recompute account summary with live prices.
- Previously it used a **symbol key mismatch**: it converted `BTCUSDT` → `BTCUSD` and queried `pos:open:BTCUSD`, while the order-engine stores positions under `pos:open:BTCUSDT`. So it found **no positions** for that symbol and never called `compute_and_cache_account_summary_with_prices` for any user on ticks.
- So on price moves, **margin_level was not recomputed** from tick data. The only recomputes were on discrete events (e.g. order fill, position close). If the user’s margin went negative purely due to price movement, auth-service often never saw `margin_level < 0` and never published `cmd.position.close_all`.

**Status:** This was fixed as part of the account summary stale fix (symbol key alignment + legacy `price:ticks` payload support in `price_tick_summary_handler`). After that fix, tick-driven recompute runs for the correct symbols and users, so `try_publish_liquidation_close_all` can see `margin_level < 0` when it happens.

**Conclusion:** If the liquidation-not-triggering issue was observed **before** deploying the account-summary fix, root cause 1 explains it. The toggle was unrelated; the real problem was that margin level was not updated on ticks.

---

## 4. Root cause 2 — Order-engine skips positions in close_all when tick cache key misses

**Symptom:** auth-service publishes `cmd.position.close_all` with `reason: "liquidated"`, but no (or fewer) positions are closed, so it looks like “liquidation doesn’t trigger”.

**Cause:** In **order-engine** `apps/order-engine/src/engine/position_handler.rs`, `handle_close_all_positions` closes each OPEN position by:

1. Reading position’s `symbol` and `group_id` from Redis.
2. Getting exit price from **tick cache**: `self.cache.get_last_tick(&symbol, group_id.as_deref())`.
3. If **no tick** is found, it **skips** that position (warns and `continue`). It does **not** fall back to a tick for the same symbol with `group_id = None`.

Ticks from the data-provider are published as `ticks.SYMBOL` (no group), so they are stored in the cache under key `"SYMBOL:"` (i.e. `group_id = None`). Positions can have a non-empty `group_id`. So:

- Cache has: `BTCUSDT:` (from `ticks.BTCUSDT`).
- Position has: `symbol = BTCUSDT`, `group_id = "some-uuid"`.
- Lookup: `get_last_tick("BTCUSDT", Some("some-uuid"))` → key `BTCUSDT:some-uuid` → **missing**.
- Result: position is skipped; no close, no `event.position.closed` for that position.

By contrast, the **single-position** close path in the same file (~lines 144–146) does:

```rust
let tick = self.cache.get_last_tick(&symbol, group_id.as_deref())
    .or_else(|| self.cache.get_last_tick(&symbol, None))  // fallback
    .context("No tick data available for symbol")?;
```

So for “close one position”, a position with a group_id still gets a tick (symbol-level). For **close_all** (liquidation/stop_out), there is **no** `.or_else(|| self.cache.get_last_tick(&symbol, None))`, so any position with a non-empty `group_id` can be skipped if the cache only has a symbol-level tick.

**Conclusion:** If positions have a `group_id` and ticks are only stored under symbol (no group), **handle_close_all_positions** can skip every position. Then no positions are closed and no liquidation events are emitted, even though auth-service correctly published `cmd.position.close_all`. This is a **second, independent bug** in the order-engine; it is not caused by the liquidation email toggle.

---

## 5. Summary

| Question | Answer |
|----------|--------|
| Does the “Enable liquidation email” toggle affect whether liquidation triggers? | **No.** It only affects whether an email is sent after liquidation. |
| Why might liquidation appear not to trigger after the toggle was added? | Coincidental timing. The real causes are (1) margin level not recomputed on ticks (fixed with account summary fix) and/or (2) order-engine skipping positions in close_all when tick lookup uses group_id and cache has only symbol-level ticks. |
| Root cause 1 | auth-service never saw `margin_level < 0` because tick-driven account summary recompute did not run (symbol key mismatch in price_tick_summary_handler). **Fixed** in the account-summary stale fix. |
| Root cause 2 | order-engine `handle_close_all_positions` does not fall back to `get_last_tick(symbol, None)` when the position has a group_id, so positions can be skipped and no liquidation events occur. **Not yet fixed.** |

---

## 6. Recommended fix for root cause 2 (when you approve)

In **`apps/order-engine/src/engine/position_handler.rs`**, in `handle_close_all_positions`, change the tick lookup from:

```rust
let tick = match self.cache.get_last_tick(&symbol, group_id.as_deref()) {
    Some(t) => t,
    None => {
        warn!("Close all: no tick for symbol {}, skipping position {}", symbol, position_id);
        continue;
    }
};
```

to:

```rust
let tick = self.cache.get_last_tick(&symbol, group_id.as_deref())
    .or_else(|| self.cache.get_last_tick(&symbol, None));
let tick = match tick {
    Some(t) => t,
    None => {
        warn!("Close all: no tick for symbol {}, skipping position {}", symbol, position_id);
        continue;
    }
};
```

This aligns close_all with the single-position close path: use symbol-level tick when position has a group_id and no group-specific tick is in cache, so liquidation/stop_out actually close all positions.

---

**No code has been changed.** This document is for analysis only. Apply the fix above only after you approve.
