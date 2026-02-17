# Plan Verification: Per-Group Price Stream — 100% Implementation Check

This document verifies each item in **Section 4 (File Checklist)** and **Phases A–H** of `docs/PLAN_PER_GROUP_PRICE_STREAM.md` against the current codebase.

---

## Section 4 — File Checklist

| # | Component | File(s) | Plan requirement | Status |
|---|-----------|---------|-------------------|--------|
| 1 | Auth JWT | `backend/auth-service/src/utils/jwt.rs` | Add `group_id` to Claims | ✅ Done — `Claims` has `group_id: Option<Uuid>` |
| 2 | Auth session | `backend/auth-service/src/services/auth_service.rs` | Set `claims.group_id = user.group_id` when creating tokens | ✅ Done — `Claims::new(..., user.group_id)` in login/refresh |
| 3 | Markup save | `backend/auth-service/src/routes/admin_markup.rs` | Resolve profile → groups; SET Redis; SADD price:groups; PUBLISH markup:update | ✅ Done — `get_group_ids_by_profile_id`, `sync_redis_markup_for_override` |
| 4 | Auth bootstrap | Auth-service startup | On startup: populate price:groups and symbol:markup:* from DB | ✅ Done — `bootstrap_price_groups_redis` in `main.rs` |
| 5 | Group profile | `backend/auth-service/src/routes/admin_groups.rs` | On default_price_profile_id update: update Redis for that group; SADD price:groups | ✅ Done — `sync_redis_after_group_profile_change` |
| 6 | Data-provider | `backend/data-provider/src/main.rs` | Cached group set; subscribe markup:update; tick loop: prices[], per-group NATS | ✅ Done — `price_groups`, subscriber, one Redis msg + `ticks.{symbol}.{group_id}` |
| 7 | Data-provider | `backend/data-provider/src/cache/redis_client.rs` | GET markup; key format; optional SET | ✅ Done — `smembers_price_groups`, `get_markup`; SET is done in auth only |
| 8 | Data-provider | `backend/data-provider/src/stream/broadcaster.rs` | Broadcast only per-group rooms; remove default-only | ✅ Done — primary path is `group:{id}:symbol:{sym}`; fallback `symbol:{sym}` only when `group` is None (loop always passes `Some(group_id)`) |
| 9 | ws-gateway | `backend/ws-gateway/src/stream/broadcaster.rs` | Parse prices[]; for each conn send tick for conn.group_id | ✅ Done — `prices` array, lookup by `g`, fallback to first entry |
| 10 | Contracts | `crates/contracts/src/commands.rs` | Add group_id to PlaceOrderCommand | ✅ Done — `group_id: Option<String>` |
| 11 | Order-engine | `apps/order-engine/src/engine/cache.rs` | last_ticks key (symbol, group_id); get_last_tick(symbol, group_id) | ✅ Done — `tick_key(symbol, group_id)`, `get_last_tick`, `update_tick` |
| 12 | Order-engine | `apps/order-engine/src/engine/tick_handler.rs` | Subscribe ticks.*.*; parse symbol and group_id; update_tick; Redis prices:{symbol}:{group_id} | ✅ Done — `parse_tick_subject_per_group`, `process_tick(..., group_id)` |
| 13 | Order-engine | `apps/order-engine/src/execution.rs` | get_last_tick(symbol, cmd.group_id); use for fill price | ⚠️ **Gap** — See [Gap: execution.rs](#gap-executionrs) below |
| 14 | Order-engine | `apps/order-engine/src/models.rs` | Add group_id to Order | ✅ Done — `group_id: Option<String>` on Order |
| 15 | Order-engine | `apps/order-engine/src/engine/order_handler.rs` | Build Order with cmd.group_id; immediate fill get_last_tick(symbol, cmd.group_id); filter pending by group_id | ✅ Done |
| 16 | Order-engine | `apps/order-engine/src/engine/tick_handler.rs` | process_tick filter pending by group_id; pass group_id to SL/TP | ✅ Done — `order.group_id.as_deref() != group_id` skip; SL/TP with group_id |
| 17 | Order-engine | `apps/order-engine/src/engine/position_handler.rs` | get_last_tick(symbol, position.group_id) for exit price | ✅ Done |
| 18 | Order-engine | `apps/order-engine/src/engine/sltp_handler.rs` | Pass group_id to Lua | ✅ Done |
| 19 | Order-engine | `apps/order-engine/lua/check_sltp_triggers.lua` | ARGV[4]=group_id; skip position if HGET group_id != | ✅ Done — `filter_group_id = ARGV[4]`, HGET pos group_id |
| 20 | Order-engine | `apps/order-engine/lua/atomic_fill_order.lua` | Accept group_id; store in position hash | ✅ Done — position hash has `group_id` |
| 21 | Auth orders | `backend/auth-service/src/routes/orders.rs` | Set group_id on PlaceOrderCommand from user | ✅ Done — `group_id: claims.group_id.map(...)` |
| 22 | Auth admin order | `backend/auth-service/src/routes/admin_trading.rs` | Set group_id from target user's group_id | ✅ Done — `group_id: user_row.group_id.map(...)` on PlaceOrderCommand |

---

## Phases A–H (summary)

- **Phase A (Auth Redis + JWT):** ✅ A.1–A.4 implemented (JWT group_id, profile→groups, Redis SET/SADD/PUBLISH, bootstrap, admin_groups sync).
- **Phase B (Data-provider):** ✅ B.1–B.3 (key format, price_groups cache + markup:update, tick loop with prices[] and per-group NATS). **B.4:** Broadcaster uses per-group rooms when group is provided; fallback to `symbol:{sym}` when group is None (current loop always passes group).
- **Phase C (ws-gateway):** ✅ C.1–C.3 (parse prices[], route by conn.group_id, single channel).
- **Phase D (Frontend):** ✅ No change required.
- **Phase E (Order-engine):** ✅ E.1–E.4 (PlaceOrderCommand group_id, cache key (symbol, group_id), order_handler uses get_last_tick(symbol, cmd.group_id); auth sets group_id). **Exception:** execution.rs (see gap).
- **Phase F (NATS subject):** ✅ ticks.{symbol}.{group_id}, subscribe ticks.*.*, parse (symbol, group_id).
- **Phase G (Redis keys / bootstrap):** ✅ Keys and bootstrap as specified.
- **Phase H (Data-provider WS optional):** ✅ Broadcaster only sends to `group:{id}:symbol:{sym}` when group is provided; no reliance on a single default stream in the main path.

---

## Gap: execution.rs

- **Checklist item:** *Order-engine | apps/order-engine/src/execution.rs | get_last_tick(symbol, cmd.group_id); use for fill price.*

- **Current state:**
  - `execution.rs` is **not part of the order-engine binary**: there is no `mod execution` in `apps/order-engine/src/main.rs`, so this file is never compiled or called.
  - The **active place-order path** is `OrderHandler` in `engine/order_handler.rs`, which already uses `get_last_tick(&cmd.symbol, cmd.group_id.as_deref())` for immediate market fill.
  - Inside `execution.rs`, tick lookup is still **symbol-only**: `state.last_ticks.get(&cmd.symbol)`. The file also references `crate::AppState`, which is not defined in this crate.

- **Conclusion:** For the **live code path**, the plan is fully implemented (order_handler uses per-group tick). The only deviation is the **unused** `execution.rs` module, which still uses symbol-only tick and is not wired into the build. To satisfy the checklist literally, `execution.rs` would need to be updated to use a tick cache with `get_last_tick(symbol, cmd.group_id)` (and wired to a state that provides such a cache) if it is ever re-enabled.

---

## Optional / edge cases (from summary)

- **execution.rs:** Covered above. No change to the active flow required.
- **Integration/runtime tests:** Not run; only compilation was verified. Plan Section 5 (Testing) remains for future work.

---

## Summary

- **File checklist:** 21 of 22 items are fully implemented. The only item not implemented is the tick lookup in **execution.rs**, which is dead code (not in build; active path is order_handler).
- **Phases A–H:** Implemented as described; B.4 and Phase H allow the current broadcaster behavior (per-group when group is provided).
- **Verdict:** The plan is **fully implemented for all active code paths**. For strict 100% checklist compliance, update or remove `execution.rs` so that any future use would use `get_last_tick(symbol, cmd.group_id)`.
