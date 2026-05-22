# Phase 2 — Market sessions enforcement

Phase 2 wires **server-side gates** on new order placement in **auth-service** only. **Pending limit orders are not cancelled** when a session closes; only **new** `place_order` requests are evaluated. **No frontend changes** (Phase 3). **Order-engine** does not gain Postgres session checks (see below).

## Step 1 — Inspection summary (pre-implementation)

1. **`place_order`** (`backend/auth-service/src/routes/orders.rs`): Validates input → user `trading_access` → `compute_order_margin_details` (yields **`symbol_id`**) → min margin → idempotency → free margin → DB tx / NATS. Session and symbol flags were inserted **immediately after** margin details are returned and **before** the minimum-margin check (so after symbol resolution, before downstream margin/idempotency work).
2. **Order-engine `validation.rs`**: `Validator` is Redis-only (`symbol:status`, balance hints). **No `PgPool` / `sqlx`** in the engine today.
3. **`symbols` columns**: `trading_enabled`, `close_only`, `allow_new_orders` exist (`database/schema.sql`) with defaults `true`, `false`, `true`.
4. **Opening vs closing**: Previously not modeled in `place_order`. Phase 2 adds `check_is_closing_intent` using **`positions`** (`status = 'open'`, `side::text` in `long`/`short`) vs order side (`BUY`/`SELL`).
5. **`PlaceOrderError` JSON**: Extended with **`OrderForbidden { code, message, details }`** → HTTP **403** and body `{ "error": { "code", "message", ...merged details } }` (aligned with existing nested `error.code` style used elsewhere in this enum).
6. **`compute_account_summary_inner`**: Not used for closing intent; a **direct positions query** is simpler and sufficient.

## Service

| File | Role |
|------|------|
| `backend/auth-service/src/services/market_sessions.rs` | Template resolution chain, `get_session_status`, symbol code lookup, `SessionStatus` DTO (serde `camelCase`). Open/closed uses **local wall time** in the template IANA zone via **`chrono::TimeZone`** + weekly windows from DB. `next_open_at` / `next_close_at` scan up to **14 days** of window starts / current window end. |

**Resolution order:** explicit `symbols.session_template_id` → `market_session_templates.is_default_for_market = symbols.market` → first **`is_24_7`** template ordered by **crypto default first**, then `created_at` — with **WARN** if the fallback path is used.

If **no** 24/7 template exists, logs **ERROR** and returns **`SessionError::NoTemplates`** (place_order → **500**).

## `place_order` validation (`orders.rs`)

After **`compute_order_margin_details`**:

1. Load `trading_enabled`, `close_only`, `allow_new_orders` for `symbol_id`.
2. **`TRADING_DISABLED`** if `!trading_enabled` (symbol-level; distinct from user `trading_access` which still uses existing `TradingRestricted` / nested `TRADING_DISABLED` earlier in the handler).
3. **`CLOSE_ONLY`** if `close_only && !is_closing_intent`.
4. **`NEW_ORDERS_DISABLED`** if `!allow_new_orders && !is_closing_intent`.
5. **`MARKET_CLOSED`** if `!session_status.is_open` — `details` includes `templateName`, `timezone`, `nextOpenAt`, `nextCloseAt` (camelCase via serde).

## Order-engine (defense in depth)

**Not implemented in Phase 2.** The engine has **no Postgres pool**; adding Option A would be a larger dependency and wiring change. **Auth-service remains the primary gate.** Documented here as a follow-up if belt-and-suspenders DB checks in the engine are required later.

## Public API

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/sessions/status?symbol=CODE` | JWT (`auth_middleware`), no extra permission |
| GET | `/api/sessions/status/batch?symbols=A,B,C` | Same; unknown codes omitted from the map |

Router: `backend/auth-service/src/routes/sessions.rs`, mounted in **`lib.rs`** as `.nest("/api/sessions", create_sessions_router(...))`.

## Error codes (symbol / session gates)

| Code | When |
|------|------|
| `TRADING_DISABLED` | Symbol `trading_enabled = false` |
| `CLOSE_ONLY` | Symbol `close_only` and order is not a closing side vs open position |
| `NEW_ORDERS_DISABLED` | Symbol `allow_new_orders = false` and not closing |
| `MARKET_CLOSED` | Resolved template is not 24/7 and current local time is outside all windows for today |

## Builds

- `cd backend/auth-service && cargo check` — **pass**
- `npx tsc --noEmit` (repo root) — **pass** (no TS changes in Phase 2)

## Smoke tests

| # | Description | Result |
|---|----------------|--------|
| 1 | Toggle symbol trading off → user `place_order` → 403 `TRADING_DISABLED` | **Not run** (needs UI + authenticated client in this environment) |
| 2 | BTC 24/7 → order anytime succeeds | **Not run** |
| 3 | `GET /api/sessions/status?symbol=AAPL` outside RTH | **Not run** |
| 4 | `close_only` + long + BUY vs SELL | **Not run** (no admin UI for `close_only` confirmed; may use SQL) |
| 5 | Template fallback WARN | **Not run** |
| 6 | Pending limit survives close | **Not run** (by design no cancel path added) |

## Deviations / notes

- **`NEW_ORDERS_DISABLED`** code name used (from prompt) for `allow_new_orders = false`; acceptance text focused on `CLOSE_ONLY` / `MARKET_CLOSED` / symbol `TRADING_DISABLED` only.
- **User-level** `trading_access != "full"` still maps to existing **`TradingRestricted`** with nested code **`TRADING_DISABLED`** (pre-existing); symbol-level reuses string **`TRADING_DISABLED`** in **`OrderForbidden`** for consistency with the requested product wording.
