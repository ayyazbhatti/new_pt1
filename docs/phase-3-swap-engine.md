# Phase 3 — Trading costs (swap rollover engine)

Phase 3 runs a **daily swap rollover** job: at each active rule’s **`rollover_time_utc`** (UTC, `HH:MM`), open positions in **`swap_enabled`** groups are matched to **`swap_rules`** (`status = active`, `calc_mode = daily`), charged in USD, and logged. **Phase 1** schema (`swap_charge_log`, `positions.accumulated_swap_usd`, `transaction_type = swap`) and **Phase 2** patterns (wallet + `transactions` in one DB transaction) apply.

## Behaviour

| Topic | Decision |
|-------|------------|
| Schedule | `tokio::time::interval(60s)` in `lib.rs`; each tick calls `swap_engine::run_rollover_tick` with `bypass_rollover_clock = false` so only rules whose `rollover_time_utc` **equals** the current UTC `HH:MM` run. |
| Admin test | `POST /api/admin/swap/run-now` with `swap:edit` — same charge logic but **ignores** rollover clock; still **one charge per position per UTC day** (idempotency). |
| Idempotency | `NOT EXISTS` on `swap_charge_log` for today’s UTC date + unique index `(position_id, (charged_at AT TIME ZONE 'UTC')::date)`; duplicate insert rolls back the whole charge. |
| Triple day | When `triple_day` matches the current weekday (`mon`…`sun`), **`days_count` = 3** and the rate multiplier is **3×** for `percent` and `fixed` units. |
| FX | Position value = `size * mark_price` in **quote**; converted to USD via `fx_rates::get_cached_snapshot` + `convert_with_rates`. Empty/missing FX cache → **skip tick** (warn), no partial charges. |
| Wallet | Spot **USD** `available_balance` debited (or credited if charge is negative); insufficient USD for a **debit** → skip position with warn, transaction rolled back. |
| After charge | `publish_wallet_balance_updated` + `compute_and_cache_account_summary` spawned for the user. |
| First swap notification | If no prior `notifications` row for that user with `kind = 'swap_first_charge'`, insert one and publish `notifications:push` on Redis. |
| v1 calc modes | **`daily` only** in the query. `funding_8h` / `hourly` reserved for later phases. |
| Account summary | `sum(accumulated_swap_usd)` on **open** positions (already USD) is **subtracted** from aggregated **unrealized PnL** in `fetch_position_aggregates_from_redis` and `fetch_position_aggregates_from_db` so the dock reflects financing drag (Phase 4 may refine further). |

## Rule ↔ position match

- `swap_rules.group_id = users.group_id`
- `swap_rules.symbol = symbols.code`
- `LOWER(TRIM(swap_rules.market)) = LOWER(TRIM(symbols.market::text))`

## Files

| Path | Role |
|------|------|
| `backend/auth-service/src/services/swap_engine.rs` | `run_rollover_tick`, charge transaction, wallet, `positions.accumulated_swap_usd`, `swap_charge_log`, first-notification helper. |
| `backend/auth-service/src/lib.rs` | Minute background task; passes `Arc<RedisPool>` as `&RedisPool` into the engine. |
| `backend/auth-service/src/routes/admin_swap.rs` | `POST /run-now`, `Extension(Arc<RedisPool>)` for FX + notification publish. |
| `backend/auth-service/src/routes/deposits.rs` | `sum_open_accumulated_swap_usd` + subtract from unrealized in Redis/DB aggregate paths. |

## API

- **`POST /api/admin/swap/run-now`** — requires `swap:edit`. Response: `{ "charged": <number> }` (positions successfully committed this invocation).

## Smoke test (manual)

1. Enable **`swap_enabled`** on a group; create **`swap_rules`** row: `calc_mode = daily`, `unit = percent`, `rollover_time_utc` = current UTC minute, rates set, `symbol`/`market` aligned with an open position’s symbol.
2. Call **`POST /api/admin/swap/run-now`**.
3. Expect: `transactions.type = swap`, wallet USD down (for positive charge), `positions.accumulated_swap_usd` increased, `swap_charge_log` row with `days_count` 1 or 3.
4. Call **run-now** again same UTC day → **`charged: 0`** (or no new rows).
5. Next UTC day (or delete today’s log in dev only) → charge again.
6. Set **`triple_day`** to today’s weekday, clear today’s charge for a test position, run-now → amount **3×** single-day.
7. Non-USD quote: confirm FX path (rates present).
8. Empty FX Redis key → run-now logs skip, **no** `swap_charge_log` rows.

## Verification

```bash
cd backend/auth-service && cargo check
```

Frontend unchanged for this phase; optional UI for swap history can follow later.
