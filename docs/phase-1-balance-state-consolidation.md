# Phase 1 — Balance state consolidation (`user:{user_id}:balance` freshness)

## Goal

Eliminate stale Redis JSON at `user:{user_id}:balance` by writing it **every time** `compute_and_cache_account_summary_with_prices` refreshes `pos:summary:{user_id}`, instead of only from `place_order` / admin order paths.

This is **Phase 1 of 4** on the balance-state workstream:

| Phase | Scope |
|-------|--------|
| **1 (this doc)** | Centralize `user:…:balance` JSON refresh inside `compute_and_cache_account_summary_with_prices` |
| **2** | Audit trail completion (`wallets` vs `transactions` / ledger pairing per `docs/balance-writer-audit.md` 7A) |
| **3** | Centralized `BalanceStateWriter` module (Postgres + Redis + callers) |
| **4** | `core-api` vs `auth-service` balance key / table alignment decision |

## Canonical JSON schema

After comparing the two previous writers, they were **identical** in shape and semantics:

- `currency`: `"USD"` (string)
- `available`: string decimal, same value as post-summary **`free_margin`** (legacy writers re-read Redis HGET; Phase 1 uses `AccountSummary.free_margin` directly so it always matches the hash we just wrote)
- `locked`: `"0"` (string; wallet `locked_balance` is not represented in `AccountSummary`; unchanged from prior behavior)
- `equity`, `margin_used`, `free_margin`: string decimals from the same `AccountSummary` used for `pos:summary`
- `updated_at`: **integer** Unix millis (`chrono::Utc::now().timestamp_millis()`)

**Difference vs pre–Phase-1 `place_order` only:** `updated_at` previously used the handler’s `now` timestamp; it now uses the time at summary write (typically sub-second later). No order-engine impact.

**Omitted:** `bonus` was not in the old JSON; order-engine `validation.rs` does not read it, so it was not added.

## Order-engine consumer

`apps/order-engine/src/engine/validation.rs` reads:

- `free_margin` as **string** → `Decimal::from_str_exact`, with fallback to `available` as string
- `available` as **string** → `Decimal::from_str_exact`

The canonical schema keeps both **`available`** and **`free_margin`** equal to `summary.free_margin.to_string()`, matching prior behavior.

## Single writer function

**`compute_and_cache_account_summary_with_prices`** in `backend/auth-service/src/routes/deposits.rs`:

1. Computes `AccountSummary` (existing).
2. **`HSET`** all fields on `Keys::account_summary(user_id)` → `pos:summary:{uuid}` (existing).
3. **`SET`** `user:{uuid}:balance` JSON string (new), **immediately after** `hset_multiple`, **before** `should_publish` / `account:summary:updated` pub/sub.

### Throttle / coordinator

- **`AccountSummaryCoordinator`** (`deposits.rs` ~291–333): serializes compute per user; **`should_publish`** only gates the **Redis PUBLISH** of `account:summary:updated` (~250 ms throttle). **`hset_multiple` and the new `SET` are not throttled** — they run on every successful compute, including when publish is skipped.

## Duplicate writers removed

| File | Approx. lines removed | Precondition |
|------|------------------------|--------------|
| `backend/auth-service/src/routes/orders.rs` | Redis `user:…:balance` block after NATS log line (~963–984) | `compute_and_cache_account_summary` already called at ~887 after `tx.commit()` |
| `backend/auth-service/src/routes/admin_trading.rs` | Same pattern (~862–891) | `compute_and_cache_account_summary` at ~773 after commit |

Replaced with a short comment pointing to this doc.

## Verification

### Build / tests

- `cd backend/auth-service && cargo check` — **pass**
- `cargo check --workspace` from repo root — **pass**
- `cd backend/auth-service && cargo test --lib` — **24 passed** (note: crate is its own `[workspace]`; use `-p auth-service` only from a manifest that lists it as a member)

### Smoke tests (manual / staging)

The following were **not** executed in this development environment (no live Redis + full trading stack here). Run on staging before production:

1. **Place order** — `HGETALL pos:summary:{user}` vs `GET user:{user}:balance` consistent after order.
2. **Deposit approve** — refresh `user:…:balance` **without** placing an order.
3. **Position close** — same.
4. **Bonus grant** — `bonus` in `pos:summary` updates; JSON `available`/`free_margin` reflect new summary.
5. **Order-engine** — marginal order after deposit/close succeeds if margin allows.
6. **Regression** — normal market order still flows to NATS as before.

## References

- Prior audit: `docs/balance-writer-audit.md` (Step 7C — `user:balance` staleness)
