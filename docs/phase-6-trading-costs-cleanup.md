# Phase 6 — Trading costs cleanup (final)

Polish and documentation only: accurate admin copy for swap semantics, removal of a dangerous Lua balance stub, hardcoded `$` cleanup on touched trading UI, feature inventory updates, reconciliation SQL, and an ops checklist.

## 1. Admin swap page & modals (copy)

**Files:** `src/features/swap/pages/SwapRulesPage.tsx`, `src/features/swap/modals/CreateSwapRuleModal.tsx`, `src/features/swap/modals/EditSwapRuleModal.tsx`, `src/features/swap/modals/PreviewSwapModal.tsx`, `src/features/swap/utils/computeSwapPreview.ts`

**Semantics reflected:**

- Swap applies only when the user’s group has **`swap_enabled = true`** (stated on the page and in rollover helpers).
- Financing **accrues** on the position at the rule’s daily rollover time (UTC); the **wallet is not debited** each rollover.
- **Settlement** debits (or credits) the wallet when the position **closes**.
- **Triple-swap day** uses the configured weekday (3× accrual when applicable).
- **V1 engine:** only **`daily`** `calc_mode` is executed; hourly / 8H values may be stored but are not applied by the rollover job yet.

Language uses **accrue** / **settlement** instead of implying an immediate wallet “charge” at rollover.

## 2. Lua: removed simplified balance block

**File:** `apps/order-engine/lua/atomic_fill_order.lua`

**Removed:** A block that read `user:{user_id}:balance` from Redis, defaulted to a hard-coded **$10,000** wallet JSON when the key was missing, and wrote it back (updating only `updated_at`). That could persist bogus balances and conflicted with **auth-service** as the source of truth for wallet/account summary (including post-fill updates via `compute_and_cache_account_summary` and related paths).

**Added:** A short comment that balance keys are **owned by auth-service** and must not be written from this Lua script.

No remaining code path in this script depended on that write for fill correctness; downstream consumers use auth-service / events for wallet state.

## 3. Hardcoded `$` audit (trading-costs–related UI)

**Scope:** Grep on `src/features/fees/`, `src/features/swap/`, `RightTradingPanel.tsx`, `BottomDock.tsx`, `PositionPnLBreakdown.tsx`.

**Changes:**

- **`RightTradingPanel.tsx`:** Replaced module-level `$…` live bid/ask formatters with `useFormatAmount` + symbol **quote currency**. Pip hints and order-size preview strings use `formatAmount` instead of `` `$${…}` ``. SL/TP field labels use **quote currency** / “notional” instead of hardcoded `($)`. 24h volume line uses numeric `M` + quote currency code (no `$` prefix).
- **`BottomDock.tsx`:** Edit-position SL/TP labels use `resolveQuoteCurrency(editingPosition.symbol, …)` instead of `Price ($)` / `Amount ($)`.
- **`fees/` / `swap/` .tsx:** No stray monetary `$` literals beyond template strings / URLs (unchanged).
- **`PositionPnLBreakdown.tsx`:** No `$` usage.

Tailwind `` `left: ${pct}%` ``, toast strings, and non-currency `$` patterns were left as-is.

## 4. Feature inventory

**File:** `docs/feature-inventory.md`

- Inserted a **Trading Costs (swap + fees)** section (status, what ships, architecture, V1 limits, permissions) near the top after scanned locations.
- **Recent improvements** table: row for Phases 1–6 with pointers to phase-5 UI doc and this doc.
- **§ swap rules** inventory row expanded to mention engine + settlement.
- **Resolved technical debt:** row noting prior “swap rules without execution / wallet path” gap **RESOLVED Phases 3–6**.

## 5. Reconciliation query (drift detection)

Run periodically (e.g. weekly). A non-empty result means position accumulators disagree with audit log sums — investigate for missed or double-applied events; **no automatic fix**.

```sql
-- Trading Costs drift detection
-- Run periodically (e.g. weekly) to verify position accumulators match audit logs

SELECT
  p.id AS position_id,
  p.user_id,
  p.symbol_id,
  p.accumulated_swap_usd AS pos_swap,
  COALESCE(swap_sum.total, 0) AS log_swap,
  (p.accumulated_swap_usd - COALESCE(swap_sum.total, 0)) AS swap_drift,
  p.accumulated_fees_usd AS pos_fees,
  COALESCE(fee_sum.total, 0) AS log_fees,
  (p.accumulated_fees_usd - COALESCE(fee_sum.total, 0)) AS fees_drift
FROM positions p
LEFT JOIN (
  SELECT position_id, SUM(amount_usd) AS total
  FROM swap_charge_log
  GROUP BY position_id
) swap_sum ON swap_sum.position_id = p.id
LEFT JOIN (
  SELECT position_id, SUM(fee_amount_usd) AS total
  FROM fee_charge_log
  WHERE NOT refunded
    AND position_id IS NOT NULL
  GROUP BY position_id
) fee_sum ON fee_sum.position_id = p.id
WHERE
  (p.accumulated_swap_usd - COALESCE(swap_sum.total, 0)) != 0
  OR (p.accumulated_fees_usd - COALESCE(fee_sum.total, 0)) != 0;
```

## 6. End-to-end Trading Costs verification (ops checklist)

Do **not** automate in CI here; run manually against a staging stack.

**Setup:**

- Test user in test group, ~$1000 USD balance, no open positions
- Group has `fees_enabled=true` (e.g. 10 bps rule) and `swap_enabled=true` (e.g. BTCUSDT rule, small daily rate, rollover time = current minute for testing)

**Steps:**

1. **Place** a small BTCUSDT long order  
   - Fee deducted at placement (~notional × bps)  
   - Cost breakdown shows fees before submit  
   - Wallet decreased by fee  
   - Position shows `accumulated_fees_usd` ≈ fee; `accumulated_swap_usd` = 0  

2. **`POST /api/admin/swap/run-now`**  
   - Wallet **unchanged**  
   - Position `accumulated_swap_usd` increased  
   - `swap_charge_log` row with `transaction_id` NULL (accrual)  
   - First-swap notification if first accrual for user  

3. **Re-run** `run-now` same day  
   - `charged_positions = 0` (idempotency)  
   - No new `swap_charge_log` row  
   - Wallet still unchanged  

4. **Terminal UI**  
   - Bottom dock P&L column shows **net** (market minus accrued costs as implemented)  
   - Expand chevron → breakdown (Market, Swap, Fees, Net)  
   - Balance / Equity / Free margin tooltips match wallet math  

5. **Close** at break-even (or any)  
   - One **swap** settlement transaction (e.g. reference `SWAP-SETTLE-{position_id}`)  
   - Wallet decreased by accrued swap  
   - Position closed; accumulators retained for history  

6. **`GET /api/account/summary`**  
   - `totalSwapPaidUsd` / `totalFeesPaidUsd` consistent with lifetime activity  
   - Balance / equity consistent with engine + wallet rules  

7. **Reconciliation query** above returns **zero rows**

## 7. Build verification

From repo root:

- `npx tsc --noEmit`
- `cargo check --workspace`

Both should pass after this phase.
