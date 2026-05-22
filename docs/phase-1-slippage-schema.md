# Phase 1 — Slippage protection (schema, resolution, snapshot, `/me`)

**Status:** Implemented. **No fill enforcement** — orders are never rejected for slippage in this phase (Phase 2).

**SL/TP-triggered fills** are documented as exempt from slippage checks; enforcement is Phase 2.

---

## Step 1 — Inspection summary (pre-implementation)

| Item | Finding |
|------|---------|
| `platform_general_settings` | Singleton row: `singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1)` — not a UUID or string id. Columns before Phase 1: `site_name`, `timezone`, `currency`, timestamps. |
| `user_groups` | Standard group columns; no slippage fields before Phase 1. |
| `orders` | Columns included `price`, `stop_price`, `average_price`, etc.; no `requested_bid` / `requested_ask` / `max_slippage_bps` before Phase 1. |
| `PlaceOrderRequest` | Had symbol, side, order type, size, limit, SL/TP, TIF, client id, idempotency — no slippage. |
| `PlaceOrderCommand` | Had margin split, leverage tiers, `account_type: Option<String>` — no slippage snapshot fields. |
| `GET /api/auth/me` | Returns `UserResponse` from `build_user_response` in `routes/auth.rs` (login/register/list paths reuse it). |
| `compute_order_margin_details` | Uses `get_price_from_redis` (`routes/deposits.rs`) with `symbol` + `group_id` string for bid/ask — same pattern reused for bid/ask snapshot at `place_order`. |

---

## Migrations

| Path | Purpose |
|------|---------|
| `infra/migrations/067_slippage_schema.sql` | Infra / compose apply |
| `backend/auth-service/migrations/20260527100000_slippage_schema.sql` | sqlx / auth-service mirror |

Changes:

- `platform_general_settings.default_slippage_bps` — `INTEGER NOT NULL DEFAULT 50`, `CHECK (>= 0)`
- `user_groups.default_slippage_bps` — nullable `INTEGER`, `CHECK (NULL OR >= 0)`
- `orders.requested_bid`, `orders.requested_ask`, `orders.max_slippage_bps`
- Partial index `idx_orders_max_slippage_bps` on `orders(max_slippage_bps) WHERE max_slippage_bps IS NOT NULL`

Platform per-order cap (**500 bps**) is **not** stored in DB; it lives as `PLATFORM_SLIPPAGE_CAP_BPS` in `backend/auth-service/src/services/slippage.rs`.

---

## Resolution chain

Implemented in `backend/auth-service/src/services/slippage.rs`:

1. **User override** — `PlaceOrderRequest.slippage_bps` (JSON `slippageBps` via struct `rename_all = "camelCase"`). Clamped to `[0, PLATFORM_SLIPPAGE_CAP_BPS]` (500). Source: `userOverride`.
2. **Group default** — `user_groups.default_slippage_bps` when **non-NULL**. Not capped by 500. Source: `groupDefault`.
3. **Platform default** — `platform_general_settings.default_slippage_bps` for `singleton_id = 1`. Source: `platformDefault`.
4. **Fallback** — `HARDCODED_FALLBACK_BPS` (50) + `tracing::warn!` if platform row missing. Source: `hardcodedFallback`.

Helper: `bps_to_fraction` for future Phase 2 math.

---

## `place_order` (`backend/auth-service/src/routes/orders.rs`)

- Request: optional `slippage_bps` / `slippageBps`.
- After free-margin check and before DB transaction: Redis **bid/ask snapshot** via `get_price_from_redis` (same keys as margin); on miss, logs warning and stores NULLs (limit orders still allowed if margin path had price earlier — snapshot is best-effort per spec).
- `resolve_slippage(&pool, effective_group_id, req.slippage_bps)`.
- `INSERT INTO orders` includes `requested_bid`, `requested_ask`, `max_slippage_bps`.
- `PlaceOrderCommand` populated with `requested_bid`, `requested_ask`, `max_slippage_bps: Some(resolved.bps)` for NATS.

**Admin place order** (`admin_trading.rs`): same snapshot + resolution (`requested_bps: None` for group/platform chain) and extended INSERT + command.

**Pending-order sync** republish: `PendingOrderRow` + SQL extended; `PlaceOrderCommand` includes DB snapshot fields when re-publishing.

---

## `PlaceOrderCommand` (`crates/contracts/src/commands.rs`)

New optional fields (serde `default` for backwards-compatible deserialization):

- `requested_bid: Option<Decimal>`
- `requested_ask: Option<Decimal>`
- `max_slippage_bps: Option<i32>`

`apps/core-api` publishes `None` for all three until it owns full placement logic.

---

## `GET /me` — `UserResponse`

New fields (camelCase JSON):

- `effectiveSlippageBps: number`
- `effectiveSlippageSource: "userOverride" | "groupDefault" | "platformDefault" | "hardcodedFallback"`

Populated via `resolve_slippage(pool, user.group_id, None)` inside `build_user_response` (so login + `/me` + list users stay consistent).

---

## Smoke tests (local DB after migration)

```text
SELECT default_slippage_bps FROM platform_general_settings;
-- 50

SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='orders'
  AND column_name IN ('requested_bid','requested_ask','max_slippage_bps');
-- 3 rows
```

**Not run in CI here:** authenticated HTTP place-order and `/me` calls (require JWT + Redis prices). Manual verification:

1. Market order without `slippageBps` → row gets Redis bid/ask when available; `max_slippage_bps` from group → platform → 50.
2. With `slippageBps: 100` → stored `100`.
3. With `slippageBps: 9999` → stored `500` (cap).
4. Set group `default_slippage_bps = 200`, omit request override → `200` on row; `/me` shows `effectiveSlippageBps: 200`, `effectiveSlippageSource: "groupDefault"`.

---

## Explicit: NO ENFORCEMENT (Phase 1)

- Order-engine and Lua are **unchanged**.
- No rejection path for slippage.
- Wallet / fill behaviour identical to pre-Phase-1 aside from new persisted metadata and NATS payload fields.
