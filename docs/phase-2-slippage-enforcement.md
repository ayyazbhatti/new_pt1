# Phase 2 — Slippage enforcement (order-engine)

## Summary

Market orders are checked **before** `atomic_fill_order.lua` runs. If `requested_bid`, `requested_ask`, and `max_slippage_bps` are all present and the computed slippage (ceiling bps) exceeds `max_slippage_bps`, the fill is rejected with reason `SLIPPAGE_EXCEEDED`. Missing snapshot fields → **no enforcement** (legacy / core-api gap).

## Where `check_slippage` lives

- **`crates/risk/src/slippage.rs`** — `check_slippage`, `SlippageCheckInput`, `SlippageCheckOutcome`, `SlippageCheckResult`.
- Re-exported from **`crates/risk/src/lib.rs`** (`pub mod slippage`).

Bps rounding uses `rust_decimal::RoundingStrategy::ToPositiveInfinity` at 0 decimal places (conservative ceiling) because workspace `rust_decimal` does not expose `MathematicalOps::ceil` on `Decimal`.

## Integration points

1. **`apps/order-engine/src/engine/tick_handler.rs`** — `execute_fill`: after effective leverage is known and **before** `atomic_fill_order`, for `OrderType::Market` only, run `check_slippage`; on `Exceeded`, call `reject_market_order_slippage_exceeded` and return `Ok(())` (no Lua).

2. **`apps/order-engine/src/engine/order_handler.rs`** — immediate market fill path: same check **before** `atomic_fill_order`. The `Order` built for the pending order now copies `requested_bid`, `requested_ask`, `max_slippage_bps` from `PlaceOrderCommand`.

## Shared rejection path

- **`apps/order-engine/src/engine/slippage_reject.rs`** — `reject_market_order_slippage_exceeded`:
  - Publishes **`event.order.rejected`** with `details` JSON: `slippageBps`, `maxBps`, `referencePrice`, `fillPrice`, `side`.
  - Publishes **`evt.order.updated`** (`OrderUpdatedEvent`) with `status: Rejected`, `reason: Some("SLIPPAGE_EXCEEDED")` — **same pattern as validation rejections** so downstream (auth-service fee refund on rejected orders) can run.
  - Updates Redis order JSON to `Rejected`, updates in-memory cache, removes pending order + `ZREM` from pending zset.

## `OrderRejectedEvent` extension

- **`apps/order-engine/src/models.rs`** — `OrderRejectedEvent` includes optional `details: Option<serde_json::Value>` (`#[serde(default, skip_serializing_if = "Option::is_none")]`). Validation reject path sets `details: None`.

## SL/TP exemption (Step 5 case)

**Case: separate fill path** — SL/TP closure does **not** go through `tick_handler::execute_fill` on a user `Order` nor the immediate market fill branch in `order_handler` for normal place-order flow. Stops are handled in **`sltp_handler`** / position close logic (position events), not the same code path that runs `check_slippage` for pending market orders. **No `bypass_slippage` flag** was required.

## Fee refund path confirmation

Slippage rejection publishes **`evt.order.updated`** with **`OrderStatus::Rejected`** and reason `SLIPPAGE_EXCEEDED`, matching the expectation that Trading Costs Phase 2 refunds on rejected orders when the auth-service consumes **`OrderStatus::Rejected`** (same as other engine rejections that publish `OrderUpdatedEvent`). Only `event.order.rejected` would **not** be sufficient if the refund handler keys off `order.updated`.

## Smoke tests

| Test | Result | Notes |
|------|--------|--------|
| Within tolerance | **Not run** | Requires live stack + controlled prices. |
| Outside tolerance (e.g. `slippageBps: 1`) | **Not run** | Same. |
| Limit unaffected | **Not run** | Code path: slippage check gated on `OrderType::Market`. |
| SL/TP exempt | **Code review** | Separate handler path; no slippage check on SL/TP fills. |
| Legacy NULL snapshot | **Not run** | `check_slippage` returns `NotApplicable` when any of the three fields is missing. |

**Automated:** `cargo test -p risk` (slippage unit tests) — run in CI / locally after pull.

## Build verification

- `cd apps/order-engine && cargo check`
- `cd crates/risk && cargo test`
- `cargo check --workspace` (optional full workspace)
