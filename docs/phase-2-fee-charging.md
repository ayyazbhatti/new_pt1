# Phase 2 — Trading costs (fee at order placement)

Phase 2 implements the **pre-pay placement fee**: when a user’s effective group has `fees_enabled = true` and a matching `fee_rules` row exists, the fee is computed from **order notional in USD**, deducted from the **spot USD wallet**, and recorded in **`transactions`** + **`fee_charge_log`** in the **same database transaction** as the order insert (after margin lock). If the order engine later marks the order **rejected**, the fee is **refunded** (idempotent).

Depends on **Phase 1** (`fee_rules`, `fees_enabled`, `fee_charge_log`). See `docs/phase-1-trading-costs-schema.md`.

## Design choices

| Topic | Decision |
|-------|----------|
| When to charge | After successful `lock_margin`, same `tx` as `INSERT orders`, before `commit`. |
| Insufficient balance | Compare **free margin** (Redis / fast DB path) to **required margin + estimated fee (USD)**; **403** with `INSUFFICIENT_FREE_MARGIN` and JSON fields `required_margin`, `estimated_fee_usd`, `total_required_usd`, `free_margin`. |
| Rejection signal | **`evt.order.updated`** with `OrderStatus::Rejected`** (no separate `evt.order.rejected` topic). |
| Cancelled orders | Placement fee is **not** refunded on cancel (only on **rejected** + reconciliation). |
| Reconciliation | Background **`tokio::spawn`** in `lib.rs`: every **300s**, `fee_placement::scan_and_refund_stale_rejected_fees` — rejected orders older than 5 minutes with unrefunded `fee_charge_log`. **Not** client polling. |
| Account summary | After successful `place_order` **commit**, `compute_and_cache_account_summary` runs so Redis reflects wallet + margin lock. |

## Backend modules

| Path | Role |
|------|------|
| `backend/auth-service/src/services/fee_engine.rs` | `resolve_fee_rule`, `compute_fee_amount`, symbol **market** lookup for rule matching. |
| `backend/auth-service/src/services/fee_placement.rs` | `charge_placement_fee_in_tx`, `refund_placement_fee_for_order`, `scan_and_refund_stale_rejected_fees`. |
| `backend/auth-service/src/routes/orders.rs` | `compute_order_margin_details` adds `estimated_fee_usd` + optional resolved rule; `place_order` enforces total, charges in tx; `estimate_order_margin` returns `estimatedFeeUsd` (camelCase JSON). |
| `backend/auth-service/src/services/order_event_handler.rs` | On **Rejected**: DB update, `rollback_order_margin_lock`, **`refund_placement_fee_for_order`**, Redis + summary refresh. |
| `backend/auth-service/src/lib.rs` | 5-minute reconciliation loop. |

## API

- **`POST /v1/orders/estimate`** — response includes **`estimatedFeeUsd`** (string decimal; `"0"` when no fee).
- **`POST /v1/orders`** — same fee math as estimate; wallet debit + `fee_charge_log` only when fee is positive.

## Frontend

- `src/features/terminal/api/orders.api.ts` — `EstimateOrderMarginResponse.estimatedFeeUsd`.
- `src/features/terminal/components/RightTradingPanel.tsx` — **Cost Breakdown → Fees** uses server estimate via `useFormatFromUsd`; shows **—** when fee is zero or absent; **Buy/Sell** disabled when required margin plus fee exceeds free margin.

## Smoke test (manual)

1. **Fees off** (default group): place order — margin lock only, **no** `fee_charge_log` row.
2. Enable **`fees_enabled`**, add rule **10 bps**, no min/max — place **$1000** notional order — wallet −**$1**, `transactions.type = fee`, negative amount, `fee_charge_log` row with `fee_amount_usd = 1`.
3. **Cost Breakdown** shows **Fees: $1.00** (or account currency formatting) before submit.
4. Reduce balance below **margin + fee** — **403** `INSUFFICIENT_FREE_MARGIN` with breakdown fields.
5. Publish **`evt.order.updated`** with status **rejected** for that order — wallet credited, `fee_charge_log.refunded = true`.
6. Restart auth-service — wait for reconciliation tick; no double-refunds; stale rejected rows get refunded after cutoff.

## Verification in repo

```bash
cd backend/auth-service && cargo check
cd /path/to/repo && npx tsc --noEmit
```
