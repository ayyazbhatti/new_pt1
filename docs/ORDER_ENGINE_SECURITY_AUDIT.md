# Order Engine Security & Correctness Audit

**Scope:** `apps/order-engine/`, `crates/contracts/`, `crates/redis-model/`, `crates/risk/`, `apps/order-engine/lua/`, and `backend/auth-service/src/routes/orders.rs` (NATS integration only).  
**Method:** Static read-only review. No code was modified.  
**Date:** 2026-05-19

---

# 0. Executive Summary

The order engine is a NATS-driven, Redis/Lua-backed execution service for market/limit orders, tick-driven fills, SL/TP, and position lifecycle commands. Rust uses `rust_decimal::Decimal` for money in handlers; **Lua scripts use `tonumber()` on string prices/sizes**, and **`atomic_fill_order.lua` does not debit margin or update `margin_used` on open**—only bumps `balance.updated_at`. Margin is checked in auth-service and again in engine validation against a **stale, non-atomic** Redis balance snapshot, so **concurrent orders can over-commit margin**. **IOC/FOK are stored but never enforced.** Idempotency is split across two Redis key namespaces with weak semantics (no body hash, race on SET, silent duplicate return in engine).

**Trust score: 3/10** — Core fill/margin/accounting paths are not safe for real-money CFD trading without major fixes.

**Go/no-go:** **No-go** for production go-live on margin trading.

**Top 3 issues by severity:**

1. **Margin not reserved atomically at fill** — Lua fill does not lock/decrement free margin; validation is non-atomic (F2, F3).
2. **IOC/FOK/GTC semantics not implemented in execution path** — FOK is not atomic; partial fills impossible in practice but TIF is ignored (F4).
3. **Idempotency broken / unsafe** — split keys, no payload binding, races, JetStream ack on handler error (F1, F5, F6).

---

# 1. Module Inventory

| Path | Lines | Modified* | Purpose |
|------|------:|-----------|---------|
| `apps/order-engine/src/main.rs` | 462 | 2026-03-16 | Tokio entry: NATS subs, spawns handlers, health HTTP |
| `apps/order-engine/src/config.rs` | 28 | 2026-02-11 | Env: NATS, Redis, `MAX_PENDING_ORDERS_PER_SYMBOL`, log level |
| `apps/order-engine/src/nats.rs` | 253 | 2026-02-12 | NATS/JetStream connect, publish `VersionedMessage`, ORDERS stream |
| `apps/order-engine/src/redis.rs` | 37 | 2026-02-11 | Redis connection pool wrapper |
| `apps/order-engine/src/subjects.rs` | 50 | 2026-03-13 | NATS subject constants + tick subject parsers |
| `apps/order-engine/src/models.rs` | 213 | 2026-04-28 | Internal `Order`, events, commands |
| `apps/order-engine/src/leverage.rs` | 3 | 2026-04-28 | Re-export `risk::effective_leverage` |
| `apps/order-engine/src/execution.rs` | 436 | 2026-04-28 | **Dead code** (references `AppState`; not in `main.rs`) |
| `apps/order-engine/src/engine/mod.rs` | 22 | 2026-02-21 | Engine module exports |
| `apps/order-engine/src/engine/order_handler.rs` | 532 | 2026-04-28 | `cmd.order.place` → validate, Redis pending, market fill |
| `apps/order-engine/src/engine/tick_handler.rs` | 392 | 2026-04-28 | Tick → pending limit/market fills, SL/TP invoke |
| `apps/order-engine/src/engine/cancel_handler.rs` | 119 | 2026-02-11 | `cmd.order.cancel` |
| `apps/order-engine/src/engine/position_handler.rs` | 653 | 2026-03-13 | Close/reopen/update/close_all positions |
| `apps/order-engine/src/engine/sltp_handler.rs` | 302 | 2026-03-16 | SL/TP trigger → `atomic_close_position` |
| `apps/order-engine/src/engine/validation.rs` | 139 | 2026-04-28 | Symbol/size/price/margin pre-checks |
| `apps/order-engine/src/engine/lua.rs` | 221 | 2026-04-28 | Lua script loader/invoker |
| `apps/order-engine/src/engine/cache.rs` | 111 | 2026-03-12 | In-memory pending orders + last ticks |
| `apps/order-engine/src/engine/warm_cache.rs` | 64 | 2026-02-19 | Startup `KEYS orders:pending:*` warm |
| `apps/order-engine/src/engine/position_events.rs` | 74 | 2026-04-28 | `evt.position.updated` publisher |
| `apps/order-engine/src/observability/*` | ~120 | 2026-02–03 | Logging, metrics |
| `apps/order-engine/src/health/*` | ~56 | 2026-02-11 | Subscription staleness monitor |
| `apps/order-engine/src/utils/*` | ~34 | 2026-02-11 | Time, UUID helpers |
| `crates/contracts/src/*.rs` | ~350 | 2026-02–04 | Commands, enums, `VersionedMessage`, events |
| `crates/redis-model/src/keys.rs` | 111 | 2026-03-12 | Canonical Redis key builders |
| `crates/redis-model/src/models.rs` | 88 | 2026-02-11 | Redis model structs |
| `crates/risk/src/effective_leverage.rs` | 179 | 2026-04-28 | Tiered leverage + user clamp |
| `crates/risk/src/margin.rs` | 50 | 2026-02-11 | Margin math helpers |
| `crates/risk/src/liquidation.rs` | 38 | 2026-02-11 | Placeholder liquidation price |
| `crates/risk/src/validation.rs` | 115 | 2026-02-11 | SL/TP/size/tick validators (**unused by engine**) |
| `backend/auth-service/src/routes/orders.rs` | ~1432 | (in scope) | API margin check, idempotency, NATS publish |

\*Last modified from filesystem `stat` where available.

### Lua scripts

| Script | Atomic unit | State mutated |
|--------|-------------|---------------|
| `atomic_fill_order.lua` (541 lines) | Single order fill if `PENDING` | `order:{id}`, `orders:pending:{symbol}`, `pos:*`, `pos:by_id:*`, `pos:open/sl/tp:{symbol}`, `user:{user}:balance` (timestamp only on open) |
| `atomic_cancel_order.lua` (35) | Cancel if `PENDING` | `order:{id}`, `orders:pending:{symbol}` |
| `atomic_close_position.lua` (189) | Full/partial close if `OPEN` | `pos:by_id:*`, indexes, `user:{user}:balance` (PnL via `tonumber`) |
| `atomic_reopen_position.lua` (67) | Reopen closed position | `pos:by_id:*`, sets/indexes |
| `atomic_reopen_position_with_params.lua` (90) | Reopen with overrides | Same |
| `atomic_update_position_params.lua` (80) | Update OPEN params | `pos:by_id:*`, SL/TP ZSETs |
| `check_sltp_triggers.lua` (118) | Read-only scan + return trigger list | None (read ZSETs/hashes) |

All scripts run as single Redis `EVAL` calls (atomic per key batch). **Fill/close scripts scan `SMEMBERS` over user positions — O(n) per fill.**

---

# 2. Architecture & Data Flow

```
[Client] --> [auth-service POST /orders] 
              |  margin check (Postgres/Redis summary)
              |  SET order:idempotency:{key}
              |  INSERT orders (Postgres pending)
              |  SET user:{id}:balance (sync snapshot)
              v
         NATS cmd.order.place (JetStream OR pub/sub)
              v
[order-engine] handle_place_order
              |  GET idempotency:{key}  (different key!)
              |  validate_order (symbol, size, margin read)
              |  SETEX idempotency:{key}
              |  SET order:{id}, ZADD orders:pending:{symbol}
              |  cache.add_pending_order
              |  optional: lua atomic_fill_order (market)
              v
[data-provider] --> NATS ticks.SYMBOL[.GROUP]
              v
[tick_handler] process_tick
              |  SET prices:{symbol}:{group}
              |  for pending: lua atomic_fill_order
              |  lua check_sltp_triggers --> sltp_handler --> atomic_close_position
              v
         NATS event.order.* / evt.order.updated / evt.position.updated
              v
[auth-service / core-api consumers] --> Postgres sync
```

### NATS subjects

**Subscribes (engine):**

- `ticks.>` (wildcard)
- `cmd.order.place` (JetStream deliver `order-engine.deliver` OR basic)
- `cmd.order.cancel`
- `cmd.position.close`
- `cmd.position.close_all`
- `cmd.position.reopen`
- `cmd.position.reopen_with_params`
- `cmd.position.update_params`

**Publishes (engine):**

- `event.order.accepted` / `rejected` / `filled` / `canceled`
- `evt.order.updated`
- `event.position.opened` / `closed`
- `evt.position.updated`
- `event.balance.updated`
- Redis pub/sub: `positions:updates` (SL/TP, close paths)

**Auth-service → engine:** `cmd.order.place` via JetStream `ORDERS` stream or fallback pub/sub (`orders.rs:663–681`).

### Redis keys (engine touch)

| Keys::* / pattern | Use |
|-------------------|-----|
| `order:{uuid}` | Order JSON (not `Keys::order_by_id`) |
| `orders:pending:{symbol}` | ZSET pending order IDs |
| `idempotency:{key}` | Engine idempotency (global string) |
| `order:idempotency:{key}` | Auth idempotency (separate) |
| `user:{user_id}:balance` | Validation + Lua default $10k |
| `pos:{user_id}` | Open position set |
| `pos:by_id:{id}` | Position hash |
| `pos:open:{symbol}` / `pos:sl:` / `pos:tp:` | Indexes |
| `prices:{symbol}:{group}` | Last tick cache |
| `symbol:status:{symbol}` / `symbol:{symbol}` | Symbol enablement |
| `pos:closing:{id}` | SL/TP close lock |
| `Keys::account_summary` | Auth margin (not used in engine validation) |

### Postgres

Engine is **Redis-first**; Postgres `orders` / `positions` updated via NATS event consumers (auth-service), not by engine directly.

### Concurrency model

- **One Tokio runtime**, **~8 long-lived tasks** (ticks, place, cancel, close, reopen×2, update_params, close_all, HTTP health, heartbeat).
- Shared state: `Arc<OrderCache>` (DashMap), `Arc<RedisClient>`, `Arc<LuaScripts>`, `Arc<NatsClient>`.
- **No mutex around margin/balance**; reliance on Lua per-order atomicity only.
- Place-order JetStream path **acks after handler returns**, including on error (`main.rs:255–268`).

---

# 3. Findings (DETAILED)

---
### F1: Split idempotency namespaces and weak duplicate handling
- **Severity:** 🔴 Critical
- **Category:** Idempotency
- **Location:** `backend/auth-service/src/routes/orders.rs:487–507`, `apps/order-engine/src/engine/order_handler.rs:156–167`
- **Code:**

```487:507:backend/auth-service/src/routes/orders.rs
    let idempotency_key = format!("order:idempotency:{}", req.idempotency_key);
    let existing_order_id: Option<String> = conn.get(&idempotency_key).await
    // ...
    let _: () = conn.set_ex(&idempotency_key, order_id.to_string(), 86400).await
```

```156:167:apps/order-engine/src/engine/order_handler.rs
        let idempotency_key = format!("idempotency:{}", cmd.idempotency_key);
        let existing: Option<String> = { conn.get(&idempotency_key).await? };
        if existing.is_some() {
            warn!("⚠️ Duplicate order detected: {}", cmd.idempotency_key);
            return Ok(());
        }
```

- **What's wrong:** Auth and engine use **different Redis keys** and TTLs (86400s vs 1800s). Engine returns `Ok(())` on duplicate **without** replying with the original order id or rejecting body mismatch. Engine key is **not scoped by `user_id`** — two users sharing the same idempotency string collide.
- **Attack scenario:** Client A and B reuse idempotency key `"1"`. B's order is silently dropped by engine. Client retries same key with **different size** after auth stored key: auth returns old order id while engine may have accepted a different path.
- **Impact:** Lost orders, wrong deduplication, audit confusion.
- **Recommended fix:** Single key `Keys::idempotency(user_id, key)` with `SET key order_id NX` + hash of canonical order body; on duplicate return stored `order_id` and verify body hash matches.

---
### F2: Margin not reserved or decremented on fill (Lua)
- **Severity:** 🔴 Critical
- **Category:** State Consistency | Numeric Precision
- **Location:** `apps/order-engine/lua/atomic_fill_order.lua:501–515`
- **Code:**

```501:515:apps/order-engine/lua/atomic_fill_order.lua
local balance_key = 'user:' .. user_id .. ':balance'
local balance_json = redis.call('GET', balance_key)
local balance = balance_json and cjson.decode(balance_json) or {
    currency = "USD",
    available = "10000.0",
    -- ...
    free_margin = "10000.0"
}
balance.updated_at = timestamp_ms
redis.call('SET', balance_key, cjson.encode(balance))
```

- **What's wrong:** Opening a position **does not increase `margin_used` or decrease `free_margin`**. Default balance is **$10,000** if key missing.
- **Attack scenario:** User with $100 free margin places 50 concurrent market orders; each passes validation reading the same snapshot; all fill; exposure far exceeds equity.
- **Impact:** Uncapped notional / margin exposure → direct money loss.
- **Recommended fix:** In `atomic_fill_order`, atomically: compute `required_margin = notional/eff_lev`, update `Keys::account_summary` / balance; reject fill if insufficient; mirror in same Lua script as position create.

---
### F3: Non-atomic margin check (TOCTOU) in engine validation
- **Severity:** 🔴 Critical
- **Category:** Race Condition
- **Location:** `apps/order-engine/src/engine/validation.rs:81–131`
- **Code:**

```128:131:apps/order-engine/src/engine/validation.rs
                let required_margin = notional / eff;
                if free_margin < required_margin && available < required_margin {
                    return Err(anyhow::anyhow!("Insufficient balance"));
                }
```

- **What's wrong:** Read-check-act gap between validation and Lua fill; balance not updated on fill (F2). Logic uses **AND** — order passes if **either** `free_margin` OR `available` is sufficient.
- **Attack scenario:** Two orders validated against `free_margin=1000`; both fill; total margin need 800 each.
- **Impact:** Over-leveraging.
- **Recommended fix:** Move margin check **inside** `atomic_fill_order` Lua with atomic read-update; reject if both fields insufficient per product rules.

---
### F4: Time-in-force (IOC/FOK) not enforced
- **Severity:** 🔴 Critical
- **Category:** State Consistency
- **Location:** `apps/order-engine/src/engine/tick_handler.rs:140–152`, `apps/order-engine/src/engine/order_handler.rs:194` (stored only)
- **Code:**

```140:152:apps/order-engine/src/engine/tick_handler.rs
                    let should_fill = match order.order_type {
                        contracts::enums::OrderType::Market => true,
                        contracts::enums::OrderType::Limit => { /* price check */ }
                    };
                    if should_fill {
                        match self.execute_fill(&mut conn, &order, fill_price, order.size).await {
```

- **What's wrong:** `cmd.tif` / `order.time_in_force` is never read in tick or place handlers. **FOK is not atomic** (no “fill entire size or cancel” in one Lua op). **IOC** does not cancel remainder. **Partial fills** (`OrderStatus::PartiallyFilled`) unused.
- **Impact:** Regulatory/contract violation; user expects FOK/IOC behavior.
- **Recommended fix:** Implement TIF in `atomic_fill_order` + tick loop: FOK = fill full size or cancel in one script; IOC = fill available then cancel rest.

---
### F5: Idempotency race (check-then-set) and in-flight duplicates
- **Severity:** 🟠 High
- **Category:** Idempotency | Race Condition
- **Location:** `apps/order-engine/src/engine/order_handler.rs:157–227`, `orders.rs:487–503`
- **What's wrong:** Both layers `GET` then later `SET`/`SETEX` without `SET NX`. Concurrent duplicate requests can both proceed.
- **Impact:** Double orders on NATS redelivery or double-click.
- **Recommended fix:** `SET idempotency_key order_id NX EX 1800` at start; if nil, return existing.

---
### F6: JetStream ack on handler failure
- **Severity:** 🟠 High
- **Category:** Error Handling | Idempotency
- **Location:** `apps/order-engine/src/main.rs:255–268`
- **Code:**

```255:268:apps/order-engine/src/main.rs
                        match order_handler_clone.handle_place_order(msg).await {
                            Ok(_) => { /* ... */ }
                            Err(e) => { error!("❌ Error handling place order: {}", e); }
                        }
                        if let Some(reply) = reply_subject {
                            if let Err(e) = nats_client_for_deliver.publish(reply, "".into()).await {
```

- **What's wrong:** Ack sent even when `handle_place_order` fails after partial side effects (idempotency set, order in Redis).
- **Impact:** Message not redelivered; order stuck inconsistent vs Postgres.
- **Recommended fix:** Ack only on success; `NAK` or omit ack on error; idempotent handler design.

---
### F7: Auth burns idempotency key before margin validation completes
- **Severity:** 🟠 High
- **Category:** Idempotency
- **Location:** `backend/auth-service/src/routes/orders.rs:502–546`
- **What's wrong:** `set_ex` idempotency at line 503 **before** free-margin check at 540. Failed margin rejects client but key remains → retries get wrong “existing order” response.
- **Impact:** Client cannot safely retry; ops confusion.
- **Recommended fix:** Set idempotency only after all validations + DB insert, or use `NX` with rollback on failure.

---
### F8: `VersionedMessage.v` never validated
- **Severity:** 🟡 Medium
- **Category:** Input Validation
- **Location:** `apps/order-engine/src/engine/order_handler.rs:122–136`
- **What's wrong:** Deserializes `v` and logs it; no rejection on unknown version.
- **Impact:** Forward incompatible payloads may deserialize incorrectly.
- **Recommended fix:** `if versioned.v != 1 { return Err(...) }`.

---
### F9: Engine trusts `user_id` from NATS without auth
- **Severity:** 🟠 High
- **Category:** Authorization
- **Location:** `apps/order-engine/src/engine/order_handler.rs:149–151` (all command handlers)
- **What's wrong:** Any publisher to `cmd.order.place` can place orders for arbitrary `user_id`. Cancel checks ownership (`cancel_handler.rs:74–78`); place does not.
- **Impact:** Insider/compromised NATS publisher can trade on victim accounts.
- **Recommended fix:** NATS auth + subject ACLs; signed commands; engine rejects if publisher identity ≠ `user_id`.

---
### F10: Symbol defaults to enabled if Redis status missing
- **Severity:** 🟡 Medium
- **Category:** Input Validation
- **Location:** `apps/order-engine/src/engine/validation.rs:38–41`
- **Code:**

```38:41:apps/order-engine/src/engine/validation.rs
            if symbol_json.is_none() {
                warn!("Symbol {} status not found in Redis, defaulting to enabled", symbol);
```

- **Impact:** Disabled/delisted symbols may still fill if cache not warmed.
- **Recommended fix:** Fail closed: reject if no `symbol:status:{symbol}` == `enabled`.

---
### F11: Lua uses `tonumber()` for prices, sizes, PnL
- **Severity:** 🟠 High
- **Category:** Numeric Precision
- **Location:** `atomic_fill_order.lua` (e.g. 40–44, 357–361), `atomic_close_position.lua:66–86`
- **What's wrong:** IEEE doubles in Redis Lua; large/small crypto notionals lose precision.
- **Impact:** Wrong fills, PnL, margin on edge sizes.
- **Recommended fix:** Integer tick arithmetic (pip/scaled integers) or decimal-safe string math in Lua.

---
### F12: Stale tick / no monotonicity / unauthenticated ticks
- **Severity:** 🟡 Medium
- **Category:** State Consistency
- **Location:** `apps/order-engine/src/engine/tick_handler.rs:70–88`, `main.rs:107–108`
- **What's wrong:** Subscribes to all `ticks.>` with no auth; no max age on `tick_event.ts`; `seq` stored but not used to reject out-of-order ticks.
- **Impact:** Fills on stale prices after feed outage.
- **Recommended fix:** Reject ticks older than N seconds; enforce `seq` monotonic per symbol/group.

---
### F13: `MAX_PENDING_ORDERS_PER_SYMBOL` configured but unused
- **Severity:** 🟡 Medium
- **Category:** Resource Limits
- **Location:** `apps/order-engine/src/config.rs:19–22` (default **50000**)
- **What's wrong:** Field loaded never referenced in codebase.
- **Impact:** Unbounded pending ZSET / cache growth per symbol → DoS.
- **Recommended fix:** Enforce in `order_handler` before `ZADD`; reject with `ORDER_REJECTED`.

---
### F14: Startup `KEYS orders:pending:*`
- **Severity:** 🟡 Medium
- **Category:** Resource Limits
- **Location:** `apps/order-engine/src/engine/warm_cache.rs:21–24`
- **Impact:** Redis blocking on large keyspaces at restart.
- **Recommended fix:** `SCAN` iterator.

---
### F15: Cancel vs fill — Rust cancel not fully atomic with fill
- **Severity:** 🟡 Medium
- **Category:** Race Condition
- **Location:** `apps/order-engine/src/engine/cancel_handler.rs:54–88`
- **What's wrong:** Loads order, checks pending in Rust, then Lua cancel. Fill Lua also checks `PENDING` — **Redis winner is deterministic**. Cancel does not publish `evt.order.updated` on success (only `event.order.canceled`).
- **Impact:** Usually safe at Redis layer; cache may be stale briefly.
- **Recommended fix:** Sync cache from Lua result; publish unified order-updated on cancel.

---
### F16: SL/TP not validated against side at engine
- **Severity:** 🟡 Medium
- **Category:** Input Validation
- **Location:** `apps/order-engine/src/engine/validation.rs:67–78`; `crates/risk/src/validation.rs:45–96` (**unused**)
- **What's wrong:** Only checks SL/TP > 0; `risk::validate_sl_tp_buy/sell` never called. 2s Lua grace only (`check_sltp_triggers.lua:43–46`).
- **Impact:** Instant stop-out on misconfigured SL.
- **Recommended fix:** Call `risk::validate_sl_tp_*` with expected entry (limit price or market hint).

---
### F17: Default $10,000 balance in Lua on missing key
- **Severity:** 🔴 Critical (combined with F2)
- **Category:** State Consistency
- **Location:** `atomic_fill_order.lua:504–510`, `atomic_close_position.lua:162–168`
- **Impact:** Wrong accounting when balance key missing.
- **Recommended fix:** Abort fill with error if balance/summary missing.

---
### F18: `liquidation.rs` placeholder; engine does not auto-liquidate on tick
- **Severity:** 🟡 Medium (stop-out exists in auth-service)
- **Category:** Other
- **Location:** `crates/risk/src/liquidation.rs:4–25`
- **What's wrong:** Simplified formula, not used in order-engine. Stop-out: auth-service publishes `cmd.position.close_all` — engine executes closes but **no in-engine margin_level loop**.
- **Impact:** Depends on auth-service cache freshness.
- **Recommended fix:** Document single owner for liquidation; or engine tick hook.

---
### F19: `execution.rs` dead code with correct margin pattern
- **Severity:** 🔵 Low
- **Category:** Other
- **Location:** `apps/order-engine/src/execution.rs` (not in `main.rs` modules)
- **What's wrong:** Alternate implementation using `Keys::idempotency`, `has_sufficient_margin`, balance updates — **not wired**.
- **Impact:** Maintainer confusion.
- **Recommended fix:** Delete or integrate; do not leave dual paths.

---
### F20: Position admin commands use raw JSON, not `VersionedMessage`
- **Severity:** 🟡 Medium
- **Category:** Input Validation
- **Location:** `apps/order-engine/src/engine/position_handler.rs:46–46`, reopen/update paths
- **Impact:** Inconsistent envelope; easier schema drift.
- **Recommended fix:** Use `contracts` commands + version check.

---
### F21: Reopen/update params use `f64` from JSON
- **Severity:** 🟡 Medium
- **Category:** Numeric Precision
- **Location:** `apps/order-engine/src/engine/position_handler.rs:367–371`
- **Code:** `v.as_f64().map(|f| f.to_string())`
- **Recommended fix:** Parse as string/Decimal in Rust before Lua.

---
### F22: Harmful `unwrap()` on hot-adjacent paths
- **Severity:** 🟡 Medium
- **Category:** Error Handling
- **Locations:**
  - `validation.rs:43` — `symbol_json.unwrap()`
  - `position_handler.rs:115` — `position_json.unwrap()`
  - `nats.rs:67,80` — `duration_since(UNIX_EPOCH).unwrap()`
- **Recommended fix:** Replace with `?` and error mapping.

---
### F23: Swallowed publish errors (`let _ =`)
- **Severity:** 🔵 Low
- **Category:** Audit Trail
- **Location:** `order_handler.rs:405–454`, `tick_handler.rs:325,377`
- **Impact:** DB sync may miss position events.
- **Recommended fix:** Log at error level with order_id; retry queue.

---

## 3.1 Order placement correctness — checklist

| Check | Result |
|-------|--------|
| Numeric precision | Rust: `Decimal` ✓. Lua: `tonumber` ✗ (F11). |
| Size/price validation | Size > 0; limit price > 0; **no max size, step, tick alignment** in engine. |
| Symbol at fill time | Re-read via validation only at place; fill does not re-check symbol enabled (F10). |
| Side validation | `serde` enum `Side` ✓ — case via JSON `UPPERCASE`. |
| LIMIT vs MARKET | Limit requires price ✓; market ignores limit ✓. |
| TIF GTC/IOC/FOK | **Not implemented** (F4). |
| Margin / `effective_leverage` | Called at fill in Rust; **not enforced in Lua balance** (F2,F3). TOCTOU ✓. |

## 3.2 Race conditions — checklist

| Check | Result |
|-------|--------|
| Concurrent orders same user | **Over-commit possible** (F2,F3). |
| Tick + limit fill | Lua re-checks limit at fill ✓; stale tick price still possible (F12). |
| Cancel + fill | Lua `PENDING` gate ✓ deterministic. |
| Position close + tick | SL/TP uses `pos:closing:` lock ✓. |
| Lua atomicity | Per-script atomic ✓; **O(n) position scan** in fill. |
| WATCH/MULTI | **None** in engine. |
| Order IDs | UUID v4 from auth ✓. |

## 3.3 Idempotency — checklist

| Scenario | Result |
|----------|--------|
| Same key, different body | **Not detected** (F1). |
| In-flight duplicate | **Race** (F5,F7). |
| Redis eviction | TTL 86400 auth / 1800 engine; eviction → duplicate processing possible. |

## 3.4 NATS — checklist

| Check | Result |
|-------|--------|
| VersionedMessage | Used ✓; version not checked (F8). |
| Subject parsing | Commands don't embed user_id in subject ✓. |
| Duplicate delivery | Weak idempotency (F1,F5,F6). |
| Crash mid-fill | Ack on error loses redelivery (F6). |
| Backpressure | Unbounded in-memory NATS/client; no engine queue limit. |

## 3.5 Risk — checklist

**`effective_leverage` (plain English):** Among tiers where `notional_from <= notional < notional_to` (open-ended top tier allowed), pick the tier with the **largest** `notional_from`, take its `max_leverage`, then clamp to `[user_min, user_max]`. Sub-minimum notional uses lowest tier. Empty tiers → `None`.

Tier boundary at exactly `notional_to`: uses **strict** `< to` — at edge belongs to higher `from` tier (test `picks_highest_from_bracket_at_boundary` ✓). Zero tiers → `None` ✓.

**Liquidation:** Placeholder only; engine does not compute/update `liquidation_price` on tick. Stop-out delegated to auth-service `close_all` publisher.

**Self-trade:** Dealer model — no order book matching ✓.

**Group leverage caps:** Enforced via tiers + user min/max in command payload from auth ✓; not re-fetched in engine at fill.

## 3.6 Price feed — checklist

Ticks from NATS `ticks.*` (data-provider). **Not authenticated** at engine (F12). Markup: per-group subject `ticks.SYMBOL.GROUP_ID`; engine stores `prices:{symbol}:{group}`.

## 3.7 Position management — checklist

| Check | Result |
|-------|--------|
| State machine | OPEN/CLOSED/LIQUIDATED via Lua ✓; reopen scripts exist. |
| Hedging vs netting | `account_type` in order JSON ✓. |
| Partial close | `atomic_close_position` supports partial ✓. |
| Mark price | Tick updates `prices:`; no separate mark in engine. |
| Fast tick DoS | Every tick runs SL/TP Lua + pending scan — **no throttle**. |

## 3.8 SL/TP — checklist

Evaluated **on tick** via `check_sltp_triggers.lua` → `sltp_handler`. Exit at bid/ask, not trigger price (slippage). No engine validation SL vs side (F16).

## 3.9 Cancellation — checklist

Cancel: user ownership in Rust ✓; Lua does not check user. Cannot revive canceled order. Cancel/fill: Lua serializes ✓.

## 3.10 Panics / errors — see F22, F23; Redis Lua parse errors return `Err` up stack ✓.

## 3.11 Logging — structured `ORDER_FILLED`, `idempotency_key` as correlation ✓. Partial event loss on `let _ =` (F23).

## 3.12 Resource limits — F13, F14. No per-user order cap found.

## 3.13 Crypto — engine holds no JWT ✓; trusts NATS payload (F9).

## 3.14 Configuration — `MAX_PENDING_ORDERS_PER_SYMBOL` default **50000** dangerous (F13).

## 3.15 Test coverage

| Area | Coverage |
|------|----------|
| `apps/order-engine/` tests | **None** |
| `crates/risk/effective_leverage.rs` | Unit tests ✓ |
| Integration / property / fuzz | **Not found** |

---

# 4. Strengths

- **Lua scripts gate fills on `order.status == PENDING`** and cancels similarly — core race between fill/cancel is Redis-serialized.
- **`effective_leverage` tier selection** is thoughtfully implemented with boundary tests and user clamp (`crates/risk/src/effective_leverage.rs`).
- **Symbol normalization** (`cache::normalize_symbol`) avoids case mismatch between orders and ticks.
- **Cancel handler verifies `order.user_id == cmd.user_id`** (defense in depth).
- **SL/TP close lock** (`pos:closing:{id}`) reduces double-close races.
- **JetStream + pub/sub fallback** for order commands with explicit comment avoiding double-publish in auth (`orders.rs:663–664`).
- **Panic recovery** on basic place-order subscriber (`main.rs:325–341`).
- **Structured tracing** on order lifecycle (`ORDER_ACCEPTED`, `ORDER_FILLED`, etc.).

---

# 5. Trust Score Breakdown

| Dimension | Score | Justification |
|-----------|------:|---------------|
| Correctness | 3 | Fills work for happy path; margin/TIF/accounting wrong |
| Robustness | 4 | Some validation; dangerous defaults |
| Concurrency safety | 4 | Per-order Lua OK; margin cross-order unsafe |
| Numeric precision | 5 | Rust OK; Lua double |
| Auditability | 6 | Good logs; some events dropped |
| Resource bounds | 3 | Unused limits; KEYS; 50k default |
| Test coverage | 1 | No engine tests |
| Documentation | 4 | Comments sparse; dead `execution.rs` |

**Harmonic mean ≈ 3.0 → Overall 3/10**

---

# 6. Production Go-Live Verdict

## 🔴 **Not ready**

Fundamental gaps: **margin not enforced atomically at execution**, **TIF not implemented**, **idempotency unsafe**, **balance updates in fill Lua are no-ops**. Auth-service margin checks alone are insufficient because the engine can accept unlimited fills after a single API check.

---

# 7. Prioritized Fix List

| # | Finding | Effort | Risk if not fixed | Sprint order |
|---|---------|--------|-------------------|--------------|
| 1 | F2, F17 — Atomic margin reserve in `atomic_fill_order` | L | Uncapped exposure | 1 |
| 2 | F3 — Remove TOCTOU; single Lua margin gate | M | Over-leveraging | 1 |
| 3 | F4 — Implement IOC/FOK/GTC | L | Wrong execution semantics | 2 |
| 4 | F1, F5, F7 — Unified idempotency `SET NX` + body hash | M | Duplicates, stuck clients | 2 |
| 5 | F6 — JetStream ack only on success | S | Lost/stuck orders | 2 |
| 6 | F9 — NATS ACL / signed commands | M | Cross-user trading | 3 |
| 7 | F11 — Lua decimal-safe math | L | Precision loss | 3 |
| 8 | F10 — Fail closed symbol enablement | S | Trading halted symbols | 3 |
| 9 | F13, F14 — Enforce pending cap; SCAN warm | S | DoS | 4 |
| 10 | F12 — Stale tick rejection | M | Bad fills | 4 |
| 11 | F16 — SL/TP validation via `risk::validation` | S | Instant triggers | 4 |
| 12 | F19 — Remove or wire `execution.rs` | S | Confusion | 5 |
| 13 | Add integration tests (concurrent orders, FOK, idempotency) | L | Regressions | 1–ongoing |

---

*End of audit. Static analysis only; race proofs for margin should be validated with concurrent integration tests once fixes land.*
