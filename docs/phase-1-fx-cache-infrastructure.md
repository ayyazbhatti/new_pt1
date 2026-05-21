# Phase 1 — FX rate cache infrastructure

Read-only / infrastructure-only phase: **no** changes to account summary, position aggregation, order engine, or trader-facing UI outside **Admin → Settings → Exchange Rates**.

## Step 1 — Inspection summary (pre-implementation)

1. **HTTP client:** `reqwest` is already a dependency in `backend/auth-service/Cargo.toml` (`reqwest = { version = "0.11", features = ["json", "stream"] }`). Other code uses `reqwest::Client` (e.g. `services/ai/anthropic.rs`, `routes/admin_voiso.rs`).
2. **Background tasks:** `lib.rs` uses `tokio::spawn` after Redis/NATS setup — e.g. price:groups 60s sync (~lines 146–159), NATS listeners, `PriceTickSummaryHandler`, `account_summary_cache_warmup::warm_all_users` (~600–606). FX worker follows the same pattern (spawn after pool ready, before `axum::serve`).
3. **Redis:** `RedisPool` in `redis_pool.rs` — `get()` returns `Result<ConnectionManager, StatusCode>` (503 when circuit open). Services use `redis.get().await` then `AsyncCommands` (`deposits.rs`, etc.). FX module takes `&RedisPool` (deref from `Arc<RedisPool>` in callers).
4. **Admin permissions:** `utils/permission_check::check_permission` with keys like `settings:view` / `settings:edit` (same pattern as other admin routers). `admin_settings.rs` uses a local `check_settings_permission` duplicate; FX routes use the shared `permission_check` module for consistency with `admin_bonus`, `admin_swap`, etc.

---

## FX service module (`services/fx_rates.rs`)

### Public API

| Item | Description |
|------|-------------|
| `FX_RATES_REDIS_KEY` | `"fx:rates:usd"` — **STRING** value, JSON payload (full snapshot). |
| `FxRatesSnapshot` | `rates: HashMap<String, Decimal>` (1 USD = N units), `fetched_at`, `source` (`frankfurter` \| `open_er_api` \| `stale_cache`), `is_stale`. |
| `FxError` | `Redis`, `NoData`, `UnsupportedCurrency`, `ZeroRate`. |
| `get_cached_snapshot` | `GET` Redis key; `None` if missing. |
| `fetch_and_cache` | Frankfurter → open.er-api → stale cache (no write on stale-only return) → `NoData`. On success: `SET` JSON. Injects `USD`/`USDT` = 1. |
| `convert` / `to_usd` | Load snapshot from Redis; `convert_with_rates` implements `amount * rate_to / rate_from` with USDT→USD normalization. |
| `convert_with_rates` | Public for unit tests and future in-process callers. |

### Upstream URLs

- Primary: `https://api.frankfurter.app/latest?from=USD` (5s timeout per request).
- Fallback: `https://open.er-api.com/v6/latest/USD` (5s timeout; requires `result == "success"`).

### Background worker (`lib.rs`)

- Shared `reqwest::Client` (10s builder timeout) for FX + router `Extension`.
- **On startup:** `fetch_and_cache` once (warn on failure).
- **Then:** `tokio::time::interval(3600s)`, `MissedTickBehavior::Skip`, first `tick()` consumes immediate fire, then hourly refresh. Logs success with `source` and `rates.len()`.

---

## Admin HTTP API

| Method | Path | Permission | Behavior |
|--------|------|------------|----------|
| `GET` | `/api/admin/fx-rates` | `settings:view` | Returns `{ rates, fetchedAt, source, isStale }` with **string** decimals (sorted keys). Empty cache → `rates: {}`, `fetchedAt: null`, `source: "none"`, `isStale: true`, **200**. |
| `POST` | `/api/admin/fx-rates/refresh` | `settings:edit` | Calls `fetch_and_cache`; **502** with `FX_REFRESH_FAILED` if both APIs fail and no cache. |

Router: `create_admin_fx_router(pool, redis_pool, fx_http)` — `Extension<FxRatesExtensions>` for redis/http so nested router stays `Router<PgPool>` compatible with the main app.

---

## Admin UI

- **Location:** `/admin/settings?tab=fx-rates` — new tab **Exchange Rates** in `SettingsPage.tsx`.
- **Component:** `src/features/settings/components/ExchangeRatesTab.tsx`.
- **API:** `src/features/settings/api/fxRates.api.ts` — React Query key `['admin', 'fx-rates']`, refresh mutation invalidates/sets cache.

---

## Unit tests

`cargo test -p auth-service --lib fx_rates::tests` — 5 tests for `convert_with_rates` (identity, USDT, HUF→USD, USD→PKR, EUR→GBP cross).

---

## Smoke test (manual)

| Step | Expected |
|------|----------|
| 1. Start Redis + auth-service | Log: initial FX fetch succeeds or warns. |
| 2. `GET /api/admin/fx-rates` (auth + `settings:view`) | Non-empty `rates` after ~1s if APIs reachable. |
| 3. Admin UI → Exchange Rates | Table of currencies; **Refresh now** updates `fetchedAt`. |
| 4. Break both URLs in `fx_rates.rs`, restart | Stale path or empty state; no panic. |
| 5. Restore URLs | Fetches succeed again. |

*Automated smoke against live Frankfurter was not run in CI from this workspace; run locally after deploy.*

---

## Phase 2 — Where to plug conversion

1. **`backend/auth-service/src/routes/deposits.rs`** — `fetch_position_aggregates_from_redis` / `compute_account_summary_inner`: when summing unrealized PnL across symbols, normalize each position’s PnL to **USD** using `services::fx_rates::to_usd` with the symbol’s `quote_currency` (requires symbol metadata in the hot path or a pre-built map).
2. **Alternative:** normalize once per tick in `PriceTickSummaryHandler` if all prices are available there — keep a single place of truth.
3. **Display currency (later phases):** after USD-normalized equity, `convert(redis, usd_amount, "USD", display_ccy)` for API DTOs or frontend (prefer one side to avoid double conversion).

Do **not** change tick payloads or order-engine math — only **aggregation / presentation** layers.

---

## Files touched (summary)

| Path | Role |
|------|------|
| `backend/auth-service/src/services/fx_rates.rs` | New — FX cache + conversion |
| `backend/auth-service/src/services/mod.rs` | `mod fx_rates` |
| `backend/auth-service/src/routes/admin_fx.rs` | New — admin GET/POST |
| `backend/auth-service/src/routes/mod.rs` | `mod admin_fx` |
| `backend/auth-service/src/lib.rs` | HTTP client, nest `/api/admin/fx-rates`, `tokio::spawn` worker |
| `src/features/settings/api/fxRates.api.ts` | New |
| `src/features/settings/components/ExchangeRatesTab.tsx` | New |
| `src/features/settings/pages/SettingsPage.tsx` | Tab + render |

---

*End of Phase 1 documentation.*
