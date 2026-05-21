# Phase 2 — Equity / margin dimensional fix (USD aggregation)

## Prerequisite (Phase 1)

Before relying on account summary, confirm the FX cache is populated, e.g. `GET /api/admin/fx-rates` returns on the order of **30+** quote currencies (plus USD/USDT injected server-side). Local smoke: not run in this change set if auth-service was not up; run the same check in your environment.

## Problem

`fetch_position_aggregates_from_redis` and `fetch_position_aggregates_from_db` summed **margin**, **unrealized PnL**, and (for DB) **closed realized PnL** across instruments **without** converting each row to a common currency. PnL and margin for e.g. GBPHUF are in **HUF**; BTCUSDT is in **USD** — adding them raw was dimensionally wrong.

## Inspect summary (Step 1)

| Source | What was summed | Quote currency |
|--------|-----------------|----------------|
| Redis `pos:by_id:{id}` | `margin`, computed/stored unrealized, `realized_pnl` | Implicit from instrument `symbol` string (e.g. `BTCUSDT` → USDT/USD); **not** stored on the hash |
| DB `positions` | `margin_used`, `pnl` (open + closed sums) | Via `symbols.quote_currency` (join on `symbol_id`) |

`compute_account_summary_inner` consumes aggregates as **USD-denominated** inputs to `balance`, `equity`, `free_margin`, and `margin_level`.

## Design (Steps 2–4)

1. **FX**: Load the Redis snapshot **once** per summary via `fx_rates::get_cached_snapshot`. If missing → `FxRatesUnavailable` → HTTP **503 Service Unavailable** for `/api/account/summary` and admin account-summary compute path (not silent wrong numbers).

2. **Conversions**: Use `fx_rates::convert_with_rates(amount, quote, "USD", &snapshot.rates)` per position (or per closed row). USDT is normalized to USD inside `fx_rates`.

3. **Redis symbol → quote**: Hashes store **`symbol`** (code string), not `symbol_id`. Quote currency is resolved with a **bulk** query `SELECT code, quote_currency FROM symbols`, keyed by **uppercased** `symbols.code`, cached in-process with a **5 minute TTL** (`OnceLock` + `tokio::sync::RwLock`).

4. **DB path**: Single query for open rows joining `symbols`; closed realized uses `sum_closed_realized_pnl_usd` with join + per-row conversion.

5. **`get_free_margin_from_db_fast`**: Needs the same FX snapshot; uses a static `POSITION_AGGREGATION_REDIS` registered from `create_*_router` functions that receive `DepositsState` (same `Arc<RedisPool>` as the app). If Redis or FX snapshot is unavailable, returns **`None`** (callers keep existing `unwrap_or(Decimal::ZERO)` behavior).

### Unsupported quote / bad row

If `convert_with_rates` fails for **UnsupportedCurrency** or **ZeroRate** after preflight (rare): **warn** and **skip** that row or Redis position (or group), matching the product rule for bad FX rows.

### `compute_account_summary_inner` contract

- **Balance**: `deposits - withdrawals + realized_pnl` where `realized_pnl` is **USD** from `sum_closed_realized_pnl_usd` (no longer the raw SQL `SUM(pnl)` in quote currency).
- **Equity**: `balance + bonus + unrealized_pnl` — both PnL terms USD.
- **Free margin / margin level**: `margin_used` and unrealized are USD — ratios unchanged.

Redis aggregate **realized** component from open hashes is no longer used for balance; **closed** realized is authoritative from DB (USD-converted).

## Files touched

- `backend/auth-service/src/routes/deposits.rs` only (per workstream scope).

## Tests

Module `position_aggregate_tests` in `deposits.rs`:

- `aggregate_converts_huf_pnl_to_usd` — dimensional sanity (3600 HUF @ 360 + 20 USD → 30 USD).
- `aggregate_handles_missing_currency_gracefully` — `quote_currency_supported` false for unknown code.
- `aggregate_empty_snapshot_rejects_non_usd_quotes` — empty rate map: USD→USD still supported (identity); HUF not.

Run: `cargo test -p auth-service --lib position_aggregate_tests`

## Smoke test checklist (manual)

1. `GET /api/admin/fx-rates` — populated.
2. Trader with **USD-only** open positions: bottom dock / account summary numbers match pre-phase-2 (within float formatting).
3. Logs: no unsupported-currency spam under normal USD trading.
4. Delete Redis key `fx:rates:usd`, hit `/api/account/summary` — expect **503** until cache repopulates.
5. Restore key / wait for startup fetch.

## Notes for Phases 3–6 (display)

- Phase 2 only fixes **aggregation math** in USD; UI still shows legacy formatting where applicable.
- Prefer reusing `fx_rates` snapshot + `symbols.quote_currency` when surfacing multi-currency display or per-instrument breakdowns.
