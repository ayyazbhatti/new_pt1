# User-related data in Redis

This document lists **what user-scoped (or user-identifying) information** can appear in Redis for this platform. It reflects the current codebase; keys may be absent for a given user until that path has written them.

**Scope:** Trading/runtime cache, not the full user profile from Postgres (email, password hash, legal name, etc. are **not** stored in Redis as part of the patterns below).

Canonical key builders live in `crates/redis-model/src/keys.rs` (`Keys`).

---

## 1. User identifier

| Detail | Where |
|--------|--------|
| **User id** (`Uuid` as string) | Embedded in many key names: `bal:…`, `pos:…`, `ord:…`, `pos:summary:…`, `user:…:balance`, `idempo:…`, etc. |

**Note:** `Keys::user(user_id)` → `user:{user_id}` exists in `redis-model` but is **not referenced elsewhere in the repo** for writes/reads today. In practice, **`user:{user_id}:balance`** (JSON string) is used for order-engine–aligned balance snapshots.

---

## 2. Wallet / margin / equity (hot state)

### `bal:{user_id}:{currency}` (e.g. `bal:{uuid}:USD`)

| Type | Typical fields (hash) |
|------|------------------------|
| **Hash** | `available`, `locked`, `equity`, `margin_used`, `free_margin`, `updated_at` |

**Used by:** `apps/order-engine` (place order / margin), `apps/core-api` (wallet read with Redis-first fallback to DB). Built with `Keys::balance(user_id, currency)`.

### `user:{user_id}:balance`

| Type | Content |
|------|---------|
| **String** (JSON) | `currency`, `available`, `locked`, `equity`, `margin_used`, `free_margin`, `updated_at` (epoch ms) |

**Used by:** Written from auth-service when account summary is recomputed so order-engine validation can `GET` a single JSON blob in sync with `pos:summary` (see `backend/auth-service/src/routes/deposits.rs`).

---

## 3. Account summary (per-user aggregate)

### `pos:summary:{user_id}` (same as `Keys::account_summary`)

| Type | Fields (hash) |
|------|----------------|
| **Hash** | `balance`, `equity`, `margin_used`, `free_margin`, `margin_level`, `margin_call_level_threshold`, `stop_out_level_threshold`, `liquidation_level`, `realized_pnl`, `unrealized_pnl`, `bonus`, `total_swap_paid_usd`, `total_fees_paid_usd`, `updated_at` |

**Used by:** Account summary cache + UI/API hydration; updated when positions, orders, or ticks drive recomputation (`deposits.rs`, coordinators).

**HTTP read path:** `GET /api/account/summary` (and admin account-summary) first loads this hash, then **overlays** unrealized PnL from `pos:agg:unrealized_usd_e6:{user_id}` when that key exists (tick-maintained by order-engine). It recomputes **equity**, **free_margin**, and **margin_level** from `balance` + `bonus` + live unrealized and cached `margin_used`, so the JSON tracks live Redis ticks even if the hash’s `unrealized_pnl` field is slightly stale. **WebSocket** `account:summary:updated` still reflects the last published summary until the next publish.

### `pos:agg:unrealized_usd_e6:{user_id}` (see `redis_model::key_user_unrealized_agg_e6`)

| Type | Content |
|------|---------|
| **String** (integer) | **Net** unrealized PnL for the user in **micro-USD** (1 USD = 1_000_000 units). Equals sum of open positions’ `unrealized_pnl_usd_e6` fields minus open accumulated swap (same net rule as account summary). |

**How it is produced:** A **Lua script** (`crates/redis-model/lua/aggregate_user_unrealized_usd_e6.lua`) runs in Redis after auth-service refreshes per-position `unrealized_pnl_usd_e6` on each `pos:by_id:{id}` hash (see §4). **Order-engine** also refreshes those fields on each price tick (`apps/order-engine/src/engine/position_tick_unrealized.rs`) so values stay live between auth passes. **Read:** `GET pos:agg:unrealized_usd_e6:{uuid}` then divide by `1_000_000` for USD.

### `pos:cache:swap_open_usd_e6:{user_id}` (see `redis_model::key_swap_open_usd_e6_cache`)

| Type | Content |
|------|---------|
| **String** (integer) | Open accumulated swap for the user in **micro-USD**, written by auth-service when position aggregates run. Order-engine reads this when recomputing `pos:agg:unrealized_usd_e6` on ticks so the aggregate stays **net of swap** without querying Postgres. If missing, tick-side aggregate uses swap `0` until the next auth summary. |

---

## 4. Positions

### `pos:{user_id}`

| Type | Content |
|------|---------|
| **Set** | Members: **position id** strings (`Uuid`) for positions indexed to this user |

### `pos:by_id:{position_id}`

| Type | Typical hash fields (include user linkage) |
|------|-----------------------------------------------|
| **Hash** | `user_id`, `group_id`, `symbol`, `side`, `size`, `entry_price`, `avg_price`, `leverage`, `margin`, `margin_from_cash`, `margin_from_bonus`, `unrealized_pnl`, `realized_pnl`, `status`, `sl`, `tp`, `opened_at`, `updated_at`, `closed_at`, `exit_price`, `original_size`, … |

| Field | Meaning |
|-------|---------|
| **`unrealized_pnl_usd_e6`** | Optional: open position’s unrealized PnL **in micro-USD** (truncated), written by auth-service when aggregating so Redis Lua can sum user totals. Constant: `redis_model::FIELD_UNREALIZED_PNL_USD_E6`. |

**Used by:** Order-engine Lua and handlers (source of truth for open position state in Redis); auth reads for positions / account summary.

### `pos:open:{symbol}`

| Type | Role |
|------|------|
| **Sorted set** | **Not** keyed by `user_id`; members are **position ids** for that symbol, used for tick-driven processing. Each position hash still contains `user_id`. |

---

## 5. Orders

### `ord:{user_id}:open`

| Type | Content |
|------|---------|
| **Sorted set** | Members: order ids; score often creation time |

### `ord:by_id:{order_id}`

| Type | Content |
|------|---------|
| **Hash** | Order model fields including **`user_id`**, symbol, side, type, size, status, prices, ids, timestamps, etc. |

### `order:{order_id}`

| Type | Content |
|------|---------|
| **String** (JSON) or related | Used in **auth-service** order flows (`backend/auth-service/src/routes/orders.rs`) alongside engine keys |

---

## 6. Idempotency and AI (user-scoped)

| Key pattern | Type | Purpose |
|-------------|------|---------|
| `idempo:{user_id}:{key}` | per usage | Command idempotency (`Keys::idempotency`) |
| `ai:idempo:{user_id}:{idempotency_key}` | string / TTL | AI chat response cache |
| `ai:report:idempo:{user_id}:{key}` | string / TTL | AI report idempotency cache |

---

## 7. Pub/Sub (not keys; payloads mention user)

| Channel | User-related payload |
|---------|----------------------|
| `account:summary:updated` | Full account summary JSON (includes user context in payload / consumers filter by session) |
| `wallet:balance:updated` | Wallet balance event JSON for a user |
| `notifications:push` | May include `userId` in JSON for admin/trader notifications |

These are **messages**, not durable key-value “user records,” unless a consumer persists them elsewhere.

---

## 8. Group settings (not the user row, but affects the user)

| Key | Type | Note |
|-----|------|------|
| `group:{group_id}` | **Hash** | Cached group settings (e.g. margin call level). User’s **group** comes from JWT/DB; this key is **per group**, not per user. |

---

## 9. What is **not** in Redis (by design of these flows)

Typical **profile / auth directory** data stays in **Postgres** (or your primary DB), for example:

- Email, username, display name  
- Password hash, MFA secrets  
- KYC / address / phone  
- Raw JWTs (not listed as a standard Redis user key here)

If you need a **full user record**, use the **users** table / admin user API, not Redis alone.

---

## 10. Quick reference: key prefixes touching users

| Prefix | Scoping |
|--------|---------|
| `bal:` | Per user + currency |
| `user:` | `user:{id}:balance` JSON (per user) |
| `pos:` | `pos:{user_id}` set; `pos:summary:{user_id}`; `pos:agg:unrealized_usd_e6:{user_id}`; `pos:cache:swap_open_usd_e6:{user_id}`; `pos:by_id:{id}` (hash contains `user_id`, optional `unrealized_pnl_usd_e6`) |
| `ord:` | `ord:{user_id}:open`; `ord:by_id:{id}` (hash contains `user_id`) |
| `order:` | Order id (auth paths); includes user in JSON |
| `idempo:` | Per user + client key |
| `ai:idempo:`, `ai:report:idempo:` | Per user + idempotency key |

---

## Related files

- `crates/redis-model/src/keys.rs` — key naming  
- `crates/redis-model/src/user_unrealized_agg.rs` — Lua aggregate + micro-USD helpers  
- `crates/redis-model/lua/aggregate_user_unrealized_usd_e6.lua` — per-user unrealized sum in Redis  
- `backend/auth-service/src/routes/deposits.rs` — `pos:summary`, `user:…:balance`, position aggregates + aggregate trigger  
- `apps/order-engine/src/engine/position_tick_unrealized.rs` — tick-time `unrealized_pnl` / `unrealized_pnl_usd_e6` + aggregate refresh  
- `backend/auth-service/src/services/open_positions_redis.rs` — reading `pos:{user}` + `pos:by_id:`  
- `apps/core-api/src/deposits.rs` — `bal:…` read path  

---

*Last updated from repository scan (inventory only; no runtime guarantee all keys exist for every user).*
