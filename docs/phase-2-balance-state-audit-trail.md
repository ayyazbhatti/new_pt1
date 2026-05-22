# Phase 2 — Balance state audit trail completion

This phase closes the gaps documented in `docs/balance-writer-audit.md` **Step 7A**: wallet mutations now produce matching **`transactions`** rows where they were missing, and the admin UI can **hide margin-only audit rows** by default.

**Roadmap:** Phase 1 refreshed `user:{id}:balance` JSON. **This is Phase 2 of 4.** Phase 3 (`BalanceStateWriter` centralization) and Phase 4 (core-api alignment) are **not** implemented here.

---

## 1. New Postgres `transaction_type` values

Migration: `infra/migrations/068_transaction_audit_completeness.sql` (mirrored in `backend/auth-service/migrations/20260528120000_transaction_audit_completeness.sql`).

| Value | Purpose |
|-------|---------|
| `margin_lock` | Cash moved from `available_balance` → `locked_balance` at order placement |
| `margin_unlock` | Cash returned from locked → available (order cancel rollback or position-close release) |
| `affiliate_commission` | Referrer wallet credit (replaces `rebate` for this path in Rust) |

Existing types unchanged: `bonus_margin_lock`, `bonus_margin_release`, `pnl_credit`, `pnl_debit`, etc.

**Index:** `idx_transactions_audit_margin_types` on `(user_id, created_at DESC)` partial `WHERE type IN (margin_lock, margin_unlock, bonus_margin_lock, bonus_margin_release)`.

---

## 2. Backend — `create_ledger_entry` mirror + skip flag

**File:** `backend/auth-service/src/services/ledger_service.rs`

- New parameter: **`skip_mirror_transaction: bool`**.
- When **`false`**: after `INSERT INTO ledger_entries`, inserts **`transactions`** (`status = completed`, `reference = LEDGER-{ledger_id}`, `net_amount = delta`, `amount = |delta|`, `method_details` with ledger ref).
- When **`true`**: skips `transactions` insert (caller owns the canonical row).

**Callers:**

| File | `skip_mirror_transaction` | Reason |
|------|----------------------------|--------|
| `routes/finance.rs` | `true` | `approve_transaction` **UPDATE**s existing pending row |
| `routes/deposits.rs` `create_direct_deposit` | `true` | **INSERT**s deposit row first |
| `routes/deposits.rs` `approve_deposit` | `true` | Approves existing pending row |
| `services/affiliate_commission_service.rs` | `false` | New payout; ledger type **`affiliate_commission`** (was `rebate`) |

---

## 3. Backend — `bonus_service` cash legs

**File:** `backend/auth-service/src/services/bonus_service.rs`

| Function | Change |
|----------|--------|
| `lock_margin` | Signature adds **`order_id: Uuid`**. After wallet `UPDATE`, **`margin_lock`** row when `margin_from_cash > 0` (unique `reference` includes UUID). |
| `rollback_order_margin_lock` | **`margin_unlock`** row when `m_cash > 0` (after wallet update). |
| `release_and_apply_pnl` | **`margin_unlock`** row when `margin_from_cash > 0` after releasing locked cash (bonus release path unchanged). |

**Call site updates:** `routes/orders.rs`, `routes/admin_trading.rs` — pass **`order_id`** into `lock_margin`.

---

## 4. Backend — Finance list filter + overview SQL

**File:** `routes/finance.rs`

- **`ListTransactionsQuery.audit_filter`**: optional `money` | `all` | `audit` (query param `audit_filter`).
- **Default when omitted or `money`:** exclude `margin_lock`, `margin_unlock`, `bonus_margin_lock`, `bonus_margin_release` from listing.
- **`audit`:** only those four types.
- **`all`:** no extra type predicate.
- **`net_fees_today`** (scoped + global): treat **`affiliate_commission`** like **`rebate`** in the CASE / WHERE (commission credits reduce net fee display consistently).

---

## 5. Frontend — filter chips (admin)

**Note:** `TerminalHistoryView` / `BottomDock` list **orders and positions**, not Postgres `transactions`. Chips are implemented where **`fetchTransactions`** is used today.

| Location | Behavior |
|----------|----------|
| `FinanceTransactionsPanel.tsx` | Chips **Money events** (default) / **All** / **Audit only**; passes `auditFilter` to API; Clear resets to `money`. |
| `UserDetailsModal.tsx` (Funding History) | Same chip row + `fundingAuditFilter` in query key. |

**API:** `src/features/adminFinance/api/finance.api.ts` — `ListTransactionsParams.auditFilter`, query string `audit_filter`.

**Types:** `Transaction.type` widened to **`string`** (`types/finance.ts`, `finance.api.ts`) so new enum values do not break TS.

**Labels:** `src/shared/finance/transactionPresentation.ts` — `transactionPrimaryLabel` extended for margin / affiliate / PnL / bonus types.

---

## 6. Verification (automated)

| Command | Result |
|---------|--------|
| `cd backend/auth-service && cargo check` | OK |
| `cd backend/auth-service && cargo test --lib` | 24 passed |
| `npx tsc --noEmit` (repo root) | OK |

---

## 7. Smoke tests (manual — not run in CI)

1. **Mixed margin order:** place order with cash + bonus → DB shows **`margin_lock`** + **`bonus_margin_lock`**.
2. **Cancel pending order:** **`margin_unlock`** + **`bonus_margin_release`** as applicable.
3. **Direct deposit:** exactly **one** `deposit` row + ledger; no duplicate from `create_ledger_entry`.
4. **Finance approve:** still **one** logical row (UPDATE to completed).
5. **Chips:** default list hides margin rows; **All** shows them; **Audit only** shows only margin audit types.
6. **Affiliate commission:** referrer gets **`affiliate_commission`** row + ledger entry.

---

## 8. Remaining work (later phases)

- **Phase 3:** Single `BalanceStateWriter` wrapping wallet + `transactions` + Redis in shared DB transactions.
- **Phase 4:** Decide fate of **core-api** parallel balance keys/tables vs auth-service.
