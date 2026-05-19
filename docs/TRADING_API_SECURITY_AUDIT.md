# Trading API Security & Correctness Audit

**Scope:** HTTP trading surface in `backend/auth-service` (orders, positions, admin trading, symbols, terminal prices, leverage/markup/swap/groups config).  
**Method:** Static read-only review. Assumes known issues in order-engine and auth-service audits.  
**Date:** 2026-05-19

**Related audits:** [ORDER_ENGINE_SECURITY_AUDIT.md](./ORDER_ENGINE_SECURITY_AUDIT.md), [AUTH_SERVICE_SECURITY_AUDIT.md](./AUTH_SERVICE_SECURITY_AUDIT.md)

---

# 0. Executive Summary

The trading API layer validates user orders with **Decimal** margin math (`compute_order_margin_details` + `risk::effective_leverage`), enforces **`trading_access == full`** on place, and uses an atomic DB `UPDATE … WHERE status = pending` for user cancel. User **list/get orders** are scoped to `claims.sub`. However, several paths **break the engine contract** (user cancel NATS payload), **bypass horizontal scoping** (admin position/order actions without `ensure_user_in_allowed_groups`), or **fail to apply changes** (admin `modify-sltp` only emits a side-channel event). Admin order placement can **inflate Redis balance to $100k** for demo users and publishes **`cmd.order.place` without leverage tiers**, worsening engine margin gaps. Idempotency at place uses **`order:idempotency:{key}` without `user_id`**, stores the key before margin check, and does not bind request body hash.

**Trust score: 4/10** — User-facing order placement is partially guarded; admin trading and cancel/SLTP paths have critical correctness and authorization gaps.

**Go/no-go:** **No-go** for production until cancel reaches the engine correctly, admin mutations are scoped, and admin `modify-sltp` / `update-params` are audited and constrained.

**Top 3 issues by severity:**
1. **User cancel does not send `CancelOrderCommand` to `cmd.order.cancel`** — DB cancelled but engine likely never removes pending order (F1).
2. **Admin position/order actions lack tag scoping** — IDOR for scoped managers; `update-params` can rewrite open position economics (F2).
3. **Admin `POST …/modify-sltp` does not update Redis** — permission is only `trading:view`; no engine/Redis update (F3).

---

# 1. Module Inventory

| Path | Lines | Purpose |
|------|------:|---------|
| `routes/orders.rs` | 1431 | User place/list/cancel/estimate/sync-pending; NATS `cmd.order.*` |
| `routes/admin_trading.rs` | 1145 | Admin list/create/cancel/force orders; scoped list via `resolve_allowed_user_ids_for_trading` |
| `routes/admin_positions.rs` | 1358 | Admin list/close/liquidate/reopen/update-params/modify-sltp (not in `admin_trading.rs` but same surface) |
| `routes/deposits.rs` (position routes) | ~520 (subset) | `GET/PUT/POST /v1/users/.../positions*` |
| `routes/symbols.rs` | 111 | Public enabled symbol catalog |
| `routes/admin_symbols.rs` | 582 | Admin symbol CRUD + MMDPS sync |
| `routes/terminal_prices.rs` | 89 | JWT-scoped Redis price snapshot |
| `routes/admin_leverage_profiles.rs` | 816 | Leverage profile CRUD (tag-scoped list) |
| `routes/admin_markup.rs` | 728 | Markup profile CRUD (tag-scoped list) |
| `routes/admin_swap.rs` | 529 | Swap rules CRUD (tag-scoped list) |
| `routes/admin_groups.rs` (trading parts) | partial | Group price profile, symbol settings, leverage defaults |
| `services/admin_symbols_service.rs` | 941 | Symbol list/CRUD/sync-mmdps |
| `services/data_provider_integrations_service.rs` | 210 | External data-provider config |

**Duplicate / dead patterns:**
- `create_orders_router` mounted at **`/api/orders` and `/v1/orders`** (same handler).
- User cancel vs admin cancel use **different NATS subjects and payloads**.
- Position logic split across **`deposits.rs`** (user) and **`admin_positions.rs`** (admin).

---

# 2. Architecture & Data Flow

```
[Client] Bearer JWT
    |
    +-- POST /api/orders  --> place_order
    |       |-- compute_order_margin_details (DB symbol, leverage tiers, Redis price)
    |       |-- Redis SETEX order:idempotency:{key}
    |       |-- INSERT orders (Postgres pending)
    |       |-- SET user:{id}:balance (sync summary)
    |       '-- NATS cmd.order.place (PlaceOrderCommand, JetStream + fallback pub/sub)
    |
    +-- POST /api/orders/:id/cancel --> cancel_order
    |       |-- UPDATE orders (pending only, user_id match)
    |       '-- NATS cmd.order.cancel (VersionedMessage type "order.cancel" — NOT CancelOrderCommand)  *** broken ***
    |
    +-- POST /v1/users/:uid/positions/:pid/close --> close_position
    |       '-- NATS cmd.position.close (JSON cmd)
    |
    +-- PUT /v1/users/:uid/positions/:pid/sltp --> update_position_sltp (Redis HSET + ZADD indexes)
    |
    +-- POST /api/admin/orders --> create_admin_order --> cmd.order.place (may set balance 100k demo)
    |
    '-- POST /api/admin/positions/:id/update-params --> cmd.position.update_params (no group scope)
```

### Endpoint matrix (authorization)

| Method | Path | Permission / auth | Scoped (tags→users)? | Ownership | Notes |
|--------|------|-------------------|----------------------|-----------|-------|
| POST | `/api/orders` | JWT | N/A | `claims.sub` | place |
| GET | `/api/orders` | JWT | N/A | `user_id = claims.sub` | list |
| POST | `/api/orders/estimate` | JWT | N/A | `claims.sub` | margin preview |
| POST | `/api/orders/:id/cancel` | JWT | N/A | `WHERE user_id = claims.sub` | see F1 |
| POST | `/api/orders/sync-pending` | `trading:view` | **No** | global pending | admin recovery |
| GET | `/api/symbols` | **None** (public) | N/A | enabled only | catalog |
| GET | `/v1/terminal/prices` | JWT | group from JWT | self | Redis `prices:sym:group` |
| GET | `/v1/users/:user_id/positions` | JWT or `trading:view` | **No** | path user_id + Redis `user_id` field | IDOR read for admins |
| PUT | `/v1/users/:user_id/positions/:pid/sltp` | own or `trading:view` | **No** | Redis `user_id` on position | admin uses view only (F4) |
| POST | `/v1/users/:user_id/positions/:pid/close` | own or `trading:close_position` | **No** | Redis owner check | `disabled` blocks self-close |
| GET | `/api/admin/orders` | `trading:view` | **Yes** (`allowed_user_ids`) | filter | OK pattern |
| POST | `/api/admin/orders` | `trading:create_order` | **No** | body `user_id` | IDOR |
| POST | `/api/admin/orders/:id/cancel` | `trading:cancel_order` | **No** | any order UUID | IDOR |
| POST | `/api/admin/orders/:id/force` | `trading:cancel_order` | **No** | force any order | IDOR |
| GET | `/api/admin/positions` | `trading:view` | **Yes** | filter by allowed users | OK |
| POST | `/api/admin/positions/:id/close` | `trading:close_position` | **No** | position_id only | IDOR |
| POST | `/api/admin/positions/:id/liquidate` | same as close | **No** | alias route | IDOR |
| POST | `/api/admin/positions/:id/modify-sltp` | `trading:view` | **No** | no-op on Redis | F3 |
| POST | `/api/admin/positions/:id/update-params` | `trading:close_position` | **No** | open position | F2 |
| POST | `/api/admin/positions/:id/reopen*` | `trading:close_position` | **No** | | high risk |
| CRUD | `/api/admin/symbols`, markup, leverage, swap, groups | per-key `*:view/create/edit` | partial (tag lists) | N/A | config |

### Per-request stores (place order)

| Store | Keys / tables |
|-------|----------------|
| Postgres | `orders`, `symbols`, `users`, `leverage_profile_tiers`, … |
| Redis | `order:idempotency:{key}`, `pos:summary:{user}`, `user:{user}:balance`, publish `orders:updates` |
| NATS | `cmd.order.place` (JetStream OR pub/sub) |

**Postgres on cancel (user):** `orders` status → cancelled. **NATS:** intended `cmd.order.cancel` — see F1.

---

# 3. Findings (DETAILED)

---
### F1: User cancel publishes wrong NATS message — engine will not cancel in Redis
- **Severity:** 🔴 Critical
- **Category:** State Consistency | Other
- **Location:** `backend/auth-service/src/routes/orders.rs:1119–1132` vs `apps/order-engine/src/engine/cancel_handler.rs:44–48`
- **Code (API):**

```1119:1132:backend/auth-service/src/routes/orders.rs
    let cancel_event = serde_json::json!({
        "orderId": order_id.to_string(),
        "userId": user_id.to_string(),
        "cancelledAt": now.to_rfc3339(),
    });

    let msg = VersionedMessage::new("order.cancel", &cancel_event)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    ...
    orders_state.nats.publish("cmd.order.cancel".to_string(), payload.into()).await
        .ok(); // Don't fail if NATS publish fails
```

- **Code (engine expects):**

```44:48:apps/order-engine/src/engine/cancel_handler.rs
        let versioned: VersionedMessage = serde_json::from_slice(&bytes)?;
        let cmd: CancelOrderCommand = versioned.deserialize_payload()
            .context("Failed to deserialize CancelOrderCommand")?;
```

- **What's wrong:** Payload is camelCase `orderId`/`userId`, not `CancelOrderCommand` (`order_id`, `user_id`, `idempotency_key`). Deserialize fails; pending order may remain in Redis and fill on next tick. DB shows cancelled; engine may still fill.
- **Attack scenario:** User cancels limit order → UI shows cancelled → tick fills order → user loses money.
- **Impact:** Cancel does not reliably stop execution; financial loss.
- **Recommended fix:** Publish `VersionedMessage::new("cmd.order.cancel", &CancelOrderCommand { user_id, order_id, idempotency_key, ts })` matching `contracts::commands::CancelOrderCommand`.

---
### F2: Admin position `update-params` without scoping — can change any user's open position economics
- **Severity:** 🔴 Critical
- **Category:** IDOR | Authorization
- **Location:** `backend/auth-service/src/routes/admin_positions.rs:1200–1333`
- **Code:**

```1207:1210:backend/auth-service/src/routes/admin_positions.rs
    permission_check::check_permission(&_pool, &claims, "trading:close_position")
        .await
        .map_err(permission_denied_to_response)?;
    // No ensure_user_in_allowed_groups / resolve_allowed_user_ids_for_trading
```

```1292:1314:backend/auth-service/src/routes/admin_positions.rs
    let cmd = serde_json::json!({
        "position_id": position_id.to_string(),
        "user_id": user_id_str,
        "size": req.size,
        "entry_price": req.entry_price,
        "stop_loss": req.stop_loss,
        "take_profit": req.take_profit,
    });
    admin_state.nats.publish("cmd.position.update_params".to_string(), payload.into()).await
```

- **What's wrong:** Any principal with `trading:close_position` (or `admin` role bypass) can change **size, entry_price, SL/TP** on any open position UUID. No tag→user scope. Engine applies via Lua — direct PnL/margin manipulation.
- **Attack scenario:** Scoped manager calls `POST /api/admin/positions/{victim-uuid}/update-params` with `entry_price` moved to favor their book → reported PnL changes.
- **Impact:** Integrity of positions and PnL; regulatory nightmare.
- **Recommended fix:** `ensure_user_in_allowed_groups` on target user; separate permission e.g. `trading:update_position_params`; audit to `user_events`; dual-control for production.

---
### F3: Admin `modify-sltp` does not update Redis — only publishes `admin.position.sltp.modified`
- **Severity:** 🔴 Critical
- **Category:** State Consistency | Authorization
- **Location:** `backend/auth-service/src/routes/admin_positions.rs:858–904`
- **Code:**

```866:903:backend/auth-service/src/routes/admin_positions.rs
    permission_check::check_permission(&pool, &claims, "trading:view")
        .await
        .map_err(permission_denied_to_response)?;
    ...
    admin_state.nats.publish("admin.position.sltp.modified".to_string(), payload.into()).await.ok();
    Ok(StatusCode::OK)
```

- **What's wrong:** User path (`deposits.rs:update_position_sltp`) writes Redis `pos:by_id` and SL/TP ZSETs. Admin path only emits NATS event **no consumer shown in engine for `admin.position.sltp.modified`**. SL/TP unchanged; UI may show success incorrectly.
- **Impact:** False admin assurance; wrong permission tier (`view` not `edit`).
- **Recommended fix:** Reuse user Redis update logic or publish `cmd.position.update_params`; require `trading:edit` + scope check.

---
### F4: `GET /v1/users/:user_id/positions` — IDOR for principals with `trading:view`
- **Severity:** 🟠 High
- **Category:** IDOR | Information Disclosure
- **Location:** `backend/auth-service/src/routes/deposits.rs:3210–3216`
- **Code:**

```3210:3216:backend/auth-service/src/routes/deposits.rs
    let is_own_positions = claims.sub == user_id;
    if !is_own_positions {
        permission_check::check_permission(&pool, &claims, "trading:view")
            .await
            .map_err(|_| StatusCode::FORBIDDEN)?;
    }
```

- **What's wrong:** No `scoped_access::ensure_user_in_allowed_groups`. Any user with `trading:view` (or `admin` JWT bypass) can read **any** user's Redis positions by UUID. Pagination capped (`limit` 200 on closed).
- **Attack scenario:** Manager lists competitor client positions and live SL/TP levels.
- **Impact:** Confidential trading data leak.
- **Recommended fix:** Resolve allowed user IDs; reject if `user_id` not in set unless `super_admin`.

---
### F5: Admin cancel/force order without scoping on order owner
- **Severity:** 🟠 High
- **Category:** IDOR
- **Location:** `backend/auth-service/src/routes/admin_trading.rs:878–945`, `1007–1070`
- **What's wrong:** `trading:cancel_order` updates `orders` by id only; publishes `admin.order.canceled` but **not** `cmd.order.cancel` with `CancelOrderCommand`. No check that order's `user_id` is in caller's allowed set.
- **Impact:** Manager can cancel orders outside their book; engine pending state may diverge (same as F1).
- **Recommended fix:** Join `orders.user_id` against `resolve_allowed_user_ids_for_trading`; publish proper engine cancel command.

---
### F6: Admin create order — no target user scope; demo balance injection; weak engine payload
- **Severity:** 🟠 High
- **Category:** Authorization | State Consistency
- **Location:** `backend/auth-service/src/routes/admin_trading.rs:452–736`
- **Code:**

```711:718:backend/auth-service/src/routes/admin_trading.rs
    let free_margin_raw = get_free_margin_from_db_fast(&pool, user_id).await;
    let free_margin = match free_margin_raw {
        None => rust_decimal::Decimal::from(100_000),
        Some(v) if v <= rust_decimal::Decimal::ZERO => rust_decimal::Decimal::from(100_000),
        Some(v) => v,
    };
```

```665:684:backend/auth-service/src/routes/admin_trading.rs
    let place_order_cmd = PlaceOrderCommand {
        ...
        min_leverage: None,
        max_leverage: None,
        leverage_tiers: None,
        account_type,
    };
```

- **What's wrong:** (1) No scoped check that `req.user_id` is allowed. (2) Sets Redis balance to **$100,000** when user has no margin — bypasses engine validation snapshot. (3) **`leverage_tiers: None`** — engine may reject or use weak defaults while API path computed margin with tiers.
- **Impact:** Unauthorized admin trading on out-of-scope users; false margin; engine/API inconsistency.
- **Recommended fix:** Scope check; use same `compute_order_margin_details` as user place; never fake balance without audit flag.

---
### F7: Place-order idempotency key not bound to user; race; stores key before margin check
- **Severity:** 🟠 High
- **Category:** Idempotency | Race Condition
- **Location:** `backend/auth-service/src/routes/orders.rs:487–507`, `540–546`
- **Code:**

```487:507:backend/auth-service/src/routes/orders.rs
    let idempotency_key = format!("order:idempotency:{}", req.idempotency_key);
    ...
    if let Some(existing_id) = existing_order_id {
        return Ok(Json(PlaceOrderResponse { order_id: existing_id, status: "PENDING".to_string() }));
    }
    let _: () = conn.set_ex(&idempotency_key, order_id.to_string(), 86400).await?;
    // ... free margin check follows at 540
```

- **What's wrong:** Key is **global** (two users same key → collision). **SETEX after GET** without NX — concurrent requests double-place. Key stored **before** margin failure → client cannot retry after insufficient margin. No body hash — same key + different symbol returns old order id without validating body (returns existing id only).
- **Impact:** Wrong order linkage; double execution with engine; stuck clients.
- **Recommended fix:** `order:idempotency:{user_id}:{key}` + `SET key NX`; store only after margin+DB success; hash canonical request into value.

---
### F8: Admin `POST …/modify-sltp` and weak permission — pattern with F3
- **Severity:** 🟠 High  
- **Category:** Authorization  
- **Location:** `admin_positions.rs:866`  
- **Confirmed:** Same as F3; listed for permission calibration (`trading:view` vs `trading:close_position` on update-params).

---
### F9: User SLTP update uses `f64` for Redis ZSET scores
- **Severity:** 🟡 Medium
- **Category:** Numeric Precision
- **Location:** `backend/auth-service/src/routes/deposits.rs:3513–3557`
- **Code:**

```3513:3524:backend/auth-service/src/routes/deposits.rs
            let sl_price: f64 = sl.parse().map_err(|_| { ... })?;
            ...
            let _: () = conn.zadd(&sl_key, position_id.to_string(), sl_price).await
```

- **What's wrong:** SL/TP index scores use IEEE doubles; precision loss on crypto prices.
- **Recommended fix:** Store string scores or integer ticks in ZSET.

---
### F10: No `symbols.trading_enabled` check at place order (API)
- **Severity:** 🟡 Medium
- **Category:** Input Validation
- **Location:** `orders.rs` — `compute_order_margin_details` uses `symbols WHERE code = $1` only; no `trading_enabled` filter
- **What's wrong:** Disabled symbol in DB can still be traded if code resolves; engine may fail-open if Redis symbol status missing (engine audit F10).
- **Recommended fix:** Reject unless `symbols.trading_enabled AND is_enabled` at API.

---
### F11: `trading_access` only enforced on place (not cancel/SLTP)
- **Severity:** 🟡 Medium
- **Category:** Authorization
- **Location:** `orders.rs:434–439`; `deposits.rs:3606–3627` (only `disabled` blocks self-close)
- **Confirmed:** `close_only` users blocked from **place** (`!= full`). They **can cancel** pending orders and **update SLTP**. `disabled` users cannot self-close. Product intent should be documented.

---
### F12: Public symbol catalog exposes internal fields
- **Severity:** 🟡 Medium
- **Category:** Information Disclosure
- **Location:** `symbols.rs:79–100`
- **What's wrong:** Public `GET /api/symbols` returns `provider_symbol`, `mmdps_category`, `leverage_profile_id`, etc.
- **Recommended fix:** Public DTO with display fields only.

---
### F13: `sync_pending_orders` republishes all pending orders globally
- **Severity:** 🟡 Medium
- **Category:** Authorization | Resource Limits
- **Location:** `orders.rs:1188–1214`
- **What's wrong:** Requires only `trading:view`; loads up to **500** pending orders **across all users** and republishes `cmd.order.place` without per-user scope.
- **Impact:** Privileged misuse can flood engine with arbitrary pending replay.

---
### F14: Minimal trading audit on user place/cancel
- **Severity:** 🟡 Medium
- **Category:** Audit Trail
- **Location:** `orders.rs` — no `user_events` / `log_audit` on place or cancel (only `info!` logs)
- **What's wrong:** User trading actions not in `user_events` category=trading at API layer (unlike auth paths in auth_service).
- **Recommended fix:** `record_user_event` on place, cancel, close, sltp with IP/UA.

---
### F15: Admin list/response DTOs use `f64` for display (admin_trading)
- **Severity:** 🔵 Low (API boundary; DB uses Decimal)
- **Category:** Numeric Precision
- **Location:** `admin_trading.rs:413–419`, request bodies `CreateOrderRequest.size: f64`
- **Note:** User order path uses string→Decimal; admin create uses `Decimal::try_from(req.size)`.

---

## 3.1 Authorization at the route layer — summary

**No issue found (good patterns):**
- User `list_orders` / `list_orders` filter: `WHERE o.user_id = $1` with `claims.sub` (`orders.rs:874`, `949`).
- User `cancel_order`: `WHERE id = $2 AND user_id = $3 AND status = pending` (`orders.rs:1085–1094`).
- User `close_position`: verifies Redis `user_id` matches path (`deposits.rs:3646–3649`).
- Admin `list_admin_orders` / `list_admin_positions`: `resolve_allowed_user_ids_for_trading` (`admin_trading.rs:249`, `admin_positions.rs:343`).

**Issues:** F2, F4, F5, F6, F8 — admin actions without group scope; F4 admin read any user with `trading:view`.

---

## 3.2 Input validation — summary

| Check | Result |
|-------|--------|
| Size/price as Decimal (user place) | Yes (`Decimal::from_str`, `> 0`) |
| Limit requires price | Yes |
| Side/type uppercase | Yes (`BUY`/`SELL`, `MARKET`/`LIMIT`) |
| TIF | Accepted (`GTC`/`IOC`/`FOK`); **engine ignores** (engine F4) |
| Symbol exists | Yes (DB); **not** `trading_enabled` (F10) |
| Max string length on idempotency_key | **Not found** |
| SL/TP validated vs entry | **Not at API** (engine grace only) |

---

## 3.3 Idempotency — summary

| Operation | Behavior |
|-----------|----------|
| Place | `order:idempotency:{key}` global; no NX; no body hash; SET before margin (F7) |
| Cancel | DB idempotent for non-pending; repeat cancel → 400; engine not updated (F1) |
| Close position | No idempotency key; duplicate NATS close possible |
| SLTP update | Last write wins; no version |

---

## 3.4 Margin / leverage at API — `compute_order_margin_details`

**Paste (entry):** `orders.rs:152–324` — resolves symbol, leverage profile via `resolve_leverage_profile_id_for_user_symbol`, loads tiers from Postgres, execution price from limit or Redis (`get_price_from_redis`), then `effective_leverage` + `required_margin = notional / eff`.

**Confirmed:**
- **Min margin:** `MIN_REQUIRED_MARGIN_USD = 10` hardcoded (`orders.rs:27`, `464–477`).
- **Free margin:** Redis `pos:summary:{user}` then `get_free_margin_from_db_fast` fallback (`509–537`).
- **TOCTOU:** Margin checked at API; engine does not reserve (engine F2/F3) — API layer does not mitigate.
- **Edge cases:** Returns `LeverageConfigurationInvalid` for missing profile/empty tiers/zero leverage — **good**.

---

## 3.5 Race conditions at API layer

| Scenario | API serialization |
|----------|-------------------|
| Concurrent places same user | **None** — double margin check possible |
| Cancel + fill | DB atomic cancel; engine race if cancel broken (F1) |
| Concurrent SLTP + close | Redis per-field; engine Lua atomic per command |
| Admin update-params + close | Engine Lua per position; no API lock |

---

## 3.6 Admin trading endpoints — summary

| Endpoint | Scoped? | Engine message | Audit |
|----------|---------|----------------|-------|
| create order | No (F6) | `cmd.order.place` | log only |
| cancel / force | No (F5) | `admin.order.canceled` only, not engine cancel | log |
| close / liquidate | No | `cmd.position.close` | partial NATS admin event |
| update-params | No (F2) | `cmd.position.update_params` | log only |
| reopen | No | `cmd.position.reopen*` | log |
| modify-sltp | No (F3) | **none** | misleading event |

**Liquidate:** Route `POST …/liquidate` calls same handler as close (`admin_positions.rs:1345`) — sets close reason via separate liquidate path in engine when reason=liquidated from stop-out flow in deposits, not this handler.

---

## 3.7 Configuration endpoints — summary

| Area | Permission | Audit | Validation |
|------|------------|-------|------------|
| admin_symbols | `symbols:*` | partial (service-level) | service validates |
| admin_markup | `markup:*` + tag scope on list | not fully verified | profile validation in service |
| admin_leverage_profiles | `leverage_profiles:*` + tag scope | tiers validated in admin routes | negative leverage checks in admin_leverage_profiles.rs (grep shows parse validation) |
| admin_swap | `swap:*` + tag scope | | |
| admin_groups symbol settings | `groups:symbol_settings` | | |

**Effective time:** Changes apply on next read/sync — **immediate** for new orders via DB/Redis reload paths; no grand-fathering audit found.

**Redis sync:** Symbol/markup changes depend on data-provider/order-engine refresh — **cannot fully confirm** propagation delay statically.

---

## 3.8 Symbol management

- Public endpoint: enabled only (`symbols.rs:55`) — **good**.
- **Leakage:** F12.
- **MMDPS sync:** `admin_symbols` + service — permission `symbols:create`; rate limit **not found**.
- **Disabled symbol trading:** F10.

---

## 3.9 Position read endpoints

- IDOR: F4.
- Status filter: server-side `redis_status_matches_filter` — **no issue** bypass found.
- Pagination: `closed_limit` max 500 (`deposits.rs:3219`).
- Returns full Redis hash as JSON — includes margin, entry, SL/TP (expected for terminal).

---

## 3.10 Order list endpoints

- User list: scoped to self — **OK**.
- Admin list: scoped — **OK**.
- No user trick to list all orders without admin role found.

---

## 3.11 Numeric precision

- User orders: **Decimal** in DB and margin path — **good**.
- User SLTP ZSET: **f64** — F9.
- Admin API responses: **f64** conversions — Low severity for display.

---

## 3.12 Error handling

- Place: distinct `INSUFFICIENT_FREE_MARGIN`, `TRADING_DISABLED`, `LEVERAGE_CONFIGURATION`, `MIN_REQUIRED_MARGIN` — **good**.
- Cancel: generic StatusCode only — **weak**.
- Some admin paths return `e.to_string()` on 500 — may leak internals.

---

## 3.13 Audit trail

- User place/cancel/close/sltp: **mostly logs only** (F14).
- Admin update-params: `info!` only (`admin_positions.rs:1329`).
- Admin close: `admin.position.closed` NATS side channel (`admin_positions.rs:823`).

---

## 3.14 Resource limits

| Limit | Value |
|-------|--------|
| list_orders | `limit` default 100, max 1000 |
| closed positions | max 500 |
| sync_pending | 500 global |
| terminal prices | max 500 symbols |
| Per-user order rate | **None** |

---

## 3.15 Trading access

See F11 — partial enforcement documented above.

---

## 3.16 SQL safety

Grep `format!` + SQL in scoped route files: **no dynamic SQL concatenation found** in `orders.rs`, `admin_trading.rs`, `admin_positions.rs` for queries (admin list uses `format!("%{}%", search)` as **bound parameter** — OK).

---

## 3.17 Cross-check with engine audit

| Engine finding | API layer |
|--------------|-----------|
| F2/F3 margin not reserved | API pre-check only; **does not fix**; admin demo balance **worsens** (F6) |
| F4 TIF not implemented | API accepts and forwards TIF — **sets user expectation** |
| F9 engine trusts user_id | **Only auth-service** publishes `cmd.order.place` in repo grep — **good** |
| F1 idempotency split | API uses `order:idempotency:{key}` — **same class of bug** (F7) |
| F10 symbol fail-open | API does not check `trading_enabled` (F10) |

---

# 4. Strengths

- **User order list and cancel (DB)** bind `user_id` to `claims.sub` / atomic pending check.
- **`compute_order_margin_details`** mirrors place logic with structured errors for leverage config gaps.
- **`trading_access != full`** blocks new orders with explicit 403 body.
- **Admin order/position list** uses `resolve_allowed_user_ids_for_trading` — correct pattern to replicate elsewhere.
- **User SLTP** updates Redis directly with position ownership check on `user_id` field.
- **Decimal** for order size/price in user place and margin estimation.
- **JetStream + fallback** for place with comment avoiding double publish on success path.

---

# 5. Trust Score Breakdown

| Dimension | Score | Justification |
|-----------|------:|---------------|
| Authorization (route gates) | 4 | Mixed; admin bypass + many unscoped mutations |
| IDOR resistance | 3 | Position read + admin mutations |
| Input validation | 5 | User place solid; gaps on symbol flags, SLTP |
| Idempotency | 4 | Global key, races |
| Numeric precision (API→engine) | 5 | Decimal orders; f64 SLTP/admin DTO |
| Admin action safety | 3 | update-params, demo balance |
| Configuration change safety | 6 | Permissions + tag lists on config |
| Audit trail completeness | 3 | Sparse user_events for trading |
| Information disclosure | 5 | Public symbols verbose |
| Error/panic safety | 5 | Generally mapped errors |

**Harmonic mean ≈ 4.1 → Overall 4/10**

---

# 6. Production Go-Live Verdict

## 🔴 **Not ready**

User cancel likely does not reach the order engine with a valid command. Admin paths allow cross-tenant position manipulation unless staff are fully trusted. Combined with engine margin and auth audit findings, the HTTP trading layer is not safe for live margin trading without targeted fixes (F1–F3 minimum).

---

# 7. Prioritized Fix List

| # | Finding | Effort | Risk | Sprint |
|---|---------|--------|------|--------|
| 1 | F1 + F5 — Fix `cmd.order.cancel` payload; admin cancel scoped + engine | M | Stuck/false cancels | 1 |
| 2 | F2 — Scope all admin position mutations; tighten update-params | M | PnL integrity | 1 |
| 3 | F3 — Admin modify-sltp must update Redis or engine | S | Broken SLTP | 1 |
| 4 | F4 — Scope position reads by allowed users | S | Data leak | 2 |
| 5 | F6 — Admin place: scope, real margin, no fake 100k balance | M | Unauthorized trading | 2 |
| 6 | F7 — Idempotency NX + user-scoped keys + after margin | M | Double orders | 2 |
| 7 | F10 — Enforce trading_enabled at API | S | Disabled symbols | 2 |
| 8 | F9 — Decimal-safe SLTP indexes | S | Precision | 3 |
| 9 | F14 — user_events for trading actions | S | Forensics | 3 |

---

# 8. Cross-Module Notes

| Topic | Note |
|-------|------|
| **ws-gateway** | Publishes Redis `orders:updates` / position updates — ensure cancel/fill events consistent with DB |
| **Finance** | `get_admin_account_summaries_batch` (auth audit) same IDOR class as trading admin reads |
| **AI chat** | May include user context from trading — out of scope |
| **Order engine** | Must deploy F1 fix before cancel is trustworthy |

---

*End of audit. Static analysis only.*
