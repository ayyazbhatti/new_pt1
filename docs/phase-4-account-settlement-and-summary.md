# Phase 4 — Account settlement and summary (trading costs)

This phase wires **swap settlement on position close**, **per-position fee accumulation**, **wallet-consistent balance** in account summary, **lifetime cost totals** for the API/UI, and **position payload enrichment**.

## 1. Position close path (recap)

- **Lua / engine:** `atomic_close_position.lua` computes **market PnL only** (entry vs exit); it does not fold in placement fees or accrued swap.
- **`event.position.closed` (NATS):** `backend/auth-service/src/lib.rs` runs `bonus_service::release_and_apply_pnl` in a DB transaction, then commits.
- **Phase 4 addition:** After a **successful** bonus commit, `services::position_cost_settlement::settle_swap_on_closed_position` runs on the shared pool.
- **Closed PnL aggregation:** `sum_closed_realized_pnl_usd` in `routes/deposits.rs` still sums **closed position `pnl` (+ FX / bonus fields as before)** — it does **not** include `accumulated_swap_usd` / `accumulated_fees_usd` as separate addends; swap cash impact is via **wallet** + **`transactions`**, and fees were already debited at placement.

## 2. Swap rollover vs close settlement (Phase 3.5 + 4)

- **Rollover** (`services/swap_engine.rs`): Updates `positions.accumulated_swap_usd`, inserts **`swap_charge_log` with `transaction_id = NULL`**. **No** `transactions` row and **no** wallet debit at rollover.
- **Close settlement** (`services/position_cost_settlement.rs`): One completed **`swap`** transaction per closed position, **`reference = SWAP-SETTLE-{position_id}`** (idempotent), **`amount = -accumulated_swap_usd`**, wallet **`available_balance -= accumulated_swap_usd`**. **`accumulated_swap_usd` on the row is not zeroed** (historical).

## 3. `accumulated_fees_usd` (Phase 2 back-fill)

- On **`evt.order.updated`** with status **Filled**, after `update_order_in_database`, `fee_placement::link_placement_fee_to_position_on_fill` runs (`services/order_event_handler.rs`).
- It loads **`fee_charge_log`** for the `order_id` (unrefunded, `position_id` still null), resolves **symbol** from the order, picks **open** position for that user+symbol, else **latest closed/liquidated** for that symbol, then **`UPDATE positions SET accumulated_fees_usd += fee_amount_usd`** and links **`fee_charge_log.position_id`**.

## 4. Balance formula in `compute_account_summary_inner` — **Approach A**

**Chosen: Approach A — spot USD wallet as source of truth for “balance”.**

- **`balance`** = `available_balance + locked_balance` from `wallets` where `wallet_type = 'spot'` and `currency = 'USD'`.
- **`equity`** = `balance + bonus_balance + unrealized_pnl` (same structure as before, but cash leg matches the wallet).
- **`realized_pnl`** in the response is still computed from **closed positions** (for display / continuity); it is **not** the cash balance driver anymore.
- **`calculate_wallet_balance`** was aligned to read **actual wallet** `available_balance` / `locked_balance`, derive **equity** as `cash_total + bonus + unrealized` (open-position `pnl` sum from DB), and **`free_margin` = max(0, equity − margin_used)** so WebSocket **`wallet.balance.updated`** and account summary stay coherent with wallet maintenance (deposits, withdrawals, fees, swap settlement, margin locks).

## 5. Account summary — new fields

Rust `AccountSummary` (`routes/deposits.rs`):

- `total_swap_paid_usd` — `COALESCE(SUM(-amount), 0)` over completed **`swap`** transactions (USD).
- `total_fees_paid_usd` — same over completed **`fee`** transactions (USD).

Redis cache (`hset_multiple` + fast-path `hget`) includes **`total_swap_paid_usd`** and **`total_fees_paid_usd`**.

Frontend:

- `AccountSummaryResponse` in `src/features/wallet/api.ts`
- WebSocket merge in `useAccountSummary.ts` and `AccountSummaryUpdatedPayload` in `src/shared/ws/wsEvents.ts`

## 6. Position API enrichment

- **`GET .../positions`:** After Redis hashes are loaded, **`merge_accumulated_costs_from_db`** merges **`accumulatedSwapUsd`** and **`accumulatedFeesUsd`** (string decimals) from `positions`.
- **Admin `AdminPosition`:** `accumulated_swap_usd` / `accumulated_fees_usd` (camelCase in JSON) filled via **`attach_admin_position_trading_costs`**.
- Terminal type: `src/features/terminal/api/positions.api.ts` — optional **`accumulatedSwapUsd`**, **`accumulatedFeesUsd`**.

## 7. Unrealized PnL / no double-count (invariant)

- **While open:** Unrealized in `fetch_position_aggregates_*` continues to use **market PnL minus `accumulated_swap_usd`** (Phase 3).
- **After close:** The position leaves open aggregates; **swap** is taken once via **settlement** (wallet + `transactions`). **`pnl`** on the row remains **market-only**, so **no double-count** of swap in both unrealized and realized.

## 8. Smoke test (manual)

Not run in CI from this workspace. Recommended sequence (from Phase 4 spec):

1. User **$1000** spot wallet, fees **10 bps**, swap rule **0.0001** daily on BTCUSDT, **`run-now`** after open.
2. After fill: wallet **−fee**; **`accumulated_fees_usd`** on position matches fee; **`accumulated_swap_usd`** still 0 until rollover.
3. After **`POST /api/admin/swap/run-now`:** wallet **unchanged**; **`accumulated_swap_usd`** increases; **`swap_charge_log`** row with **`transaction_id` null**.
4. Close at **break-even market PnL:** wallet drops by **accrued swap**; one **`swap`** row with **`SWAP-SETTLE-{position_id}`** and `method_details.kind = swap_settlement`; **`accumulated_swap_usd`** on closed row **unchanged**.
5. **`/api/account/summary`:** **`totalSwapPaidUsd`** / **`totalFeesPaidUsd`** match lifetime debits; **balance** matches wallet **available + locked**.

**Invariant:** Net wallet change from open → hold (swap accrual) → close at zero market PnL equals **−(fees at entry + swap accrued)** with no duplicate swap charge in PnL aggregates.
