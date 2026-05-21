# Bonus system — implementation reference

This document describes the trading bonus pool: schema, algorithms, APIs, and operational notes. Migrations: `infra/migrations/061_bonus_system.sql`, `062_position_bonus_wallet_released.sql` (and mirrored under `backend/auth-service/migrations/`).

---

## Business rules

1. **Margin allocation:** Cash first (`available_balance`), then bonus (`bonus_balance - bonus_locked`).
2. **Realized PnL on profit:** Credited to **cash** only (`available_balance`); never increases `bonus_balance`.
3. **Realized PnL on loss:** Reduces **consumable bonus** first (`bonus_balance - bonus_locked`, capped by loss), then debits remaining loss from **cash** (`available_balance`). Audit: `bonus_loss_absorb`, `pnl_debit`.
4. **No expiry:** Bonus stays until spent via loss absorption, revocation, or remains as balance.
5. **Revoke:** Admin may revoke only the **unlocked** portion: `revokable = bonus_balance - bonus_locked`.
6. **Bonus is not withdrawable:** Withdrawal flows use `wallets.available_balance` only (spot USD); `bonus_balance` is never included.
7. **Bonus counts as capital:** Equity and free margin include bonus; margin level uses the same equity as other risk UI.

---

## Data model

### `wallets` (spot USD)

| Column | Meaning |
|--------|---------|
| `available_balance` | Cash available + not locked for margin (withdrawal source). |
| `locked_balance` | Cash margin locked for open positions. |
| `bonus_balance` | Non-withdrawable bonus pool. |
| `bonus_locked` | Portion of bonus reserved as margin for open positions. |

Constraints: `bonus_balance >= 0`, `bonus_locked >= 0`, `bonus_locked <= bonus_balance`.

### `orders`

| Column | Meaning |
|--------|---------|
| `margin_from_cash` | Snapshot of cash margin locked at placement (for cancel/reject rollback). |
| `margin_from_bonus` | Snapshot of bonus margin locked at placement. |

### `positions`

| Column | Meaning |
|--------|---------|
| `margin_from_cash` | Cash-funded margin for the position. |
| `margin_from_bonus` | Bonus-funded margin for the position. |
| `bonus_loss_absorbed` | Amount of realized loss absorbed from bonus on close (reporting / closed PnL). |
| `bonus_wallet_released` | Idempotency flag: wallet close path has run; prevents double release on NATS replay. |

Open positions created before the bonus system were backfilled with `margin_from_cash = margin_used`, `margin_from_bonus = 0`.

### `transactions.type` (enum extensions)

Relevant values: `bonus_grant`, `bonus_revoke`, `bonus_loss_absorb`, `bonus_margin_lock`, `bonus_margin_release`, `pnl_credit`, `pnl_debit`. Grant/revoke rows store `method_details` JSON with `note` and `adminUserId`.

---

## Margin allocation (order placement)

Implemented in `backend/auth-service/src/services/bonus_service.rs` → `lock_margin`:

1. `SELECT … FOR UPDATE` on the user’s spot USD wallet.
2. `available_cash = available_balance` (clamped ≥ 0), `available_bonus = bonus_balance - bonus_locked` (clamped ≥ 0).
3. `margin_from_cash = min(margin_required, available_cash)`, `margin_from_bonus = margin_required - margin_from_cash`.
4. If `margin_from_bonus > available_bonus` → `InsufficientMargin`.
5. `UPDATE wallets`: `available_balance -= margin_from_cash`, `locked_balance += margin_from_cash`, `bonus_locked += margin_from_bonus`.
6. If `margin_from_bonus > 0`, insert `bonus_margin_lock` transaction.

`place_order` (and admin order paths) run this inside a DB transaction before NATS publish; `PlaceOrderCommand` carries `margin_from_cash` / `margin_from_bonus` to the order-engine for Redis position hashes and DB sync.

**Cancel/reject:** `rollback_order_margin_lock` reverses the order snapshot (and writes `bonus_margin_release` when bonus was locked).

---

## PnL routing (position close)

Implemented in `release_and_apply_pnl` (same module), called from the `event.position.closed` handler in `lib.rs` **before** `compute_and_cache_account_summary`:

1. **Idempotency:** If `bonus_wallet_released` is already true, return (no-op).
2. **Release margin:** `locked_balance -= margin_from_cash`, `bonus_locked -= margin_from_bonus`, `available_balance += margin_from_cash` (cash margin returns to available). Insert `bonus_margin_release` if bonus margin was used.
3. **Profit** (`realized_pnl > 0`): `available_balance += realized_pnl`; insert `pnl_credit`.
4. **Loss** (`realized_pnl < 0`): `loss = abs(pnl)`; `bonus_absorb = min(loss, consumable_bonus)` where `consumable_bonus = max(bonus_balance - bonus_locked, 0)` after the release step; subtract from `bonus_balance`; insert `bonus_loss_absorb` if needed; `cash_loss = loss - bonus_absorb`; if `cash_loss > 0`, subtract from `available_balance` and insert `pnl_debit`.
5. **Mark position:** `bonus_loss_absorbed`, `bonus_wallet_released = true`.

**Note:** Loss absorption uses **consumable** bonus (not locked). After margin release, previously bonus-locked margin is unlocked and can absorb loss in the same transaction.

---

## Account summary

`compute_account_summary_inner` / Redis cache (`deposits.rs`): `equity = balance + bonus + unrealized_pnl` (field names may be camelCase in JSON). `free_margin` uses equity minus margin used; `bonus` is exposed to the terminal and user dashboard.

---

## Admin HTTP API

Base path: `/api/admin/bonus` (auth middleware + permissions).

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/user/:user_id` | `bonus:view` | `{ userId, balance, locked, revokable }` (string decimals). |
| POST | `/grant` | `bonus:edit` | Body: `{ userId, amount, note? }` → `{ success, newBonusBalance }`. |
| POST | `/revoke` | `bonus:edit` | Body: `{ userId, amount, note? }` → `{ success, newBonusBalance }`. 422: `{ message, revokable }`. |
| GET | `/transactions` | `bonus:view` | Query: `userId`, `adminId`, `from`, `to`, `type` (comma-separated), `limit`, `offset`. Paginated bonus-related rows. |
| GET | `/user/:user_id/history` | `bonus:view` | Same filters, scoped to user. |

After grant/revoke, the server recomputes account summary and publishes wallet/summary updates.

---

## Withdrawals (verification)

`backend/auth-service/src/routes/withdrawals.rs` loads **`available_balance`** from `wallets` (`wallet_type = 'spot'`, `currency = 'USD'`) and rejects `amount > available_balance`. **`bonus_balance` is not read** and cannot be withdrawn via this path.

---

## Frontend

- **Terminal:** `BottomDock` shows `accountSummary.bonus`; `useAccountSummary` hydrates from REST + `account.summary.updated` WebSocket (no polling).
- **Admin:** `BonusPage` — grant, revoke, transaction history (`src/features/bonus/pages/BonusPage.tsx`).
- **User portal:** Dashboard shows cash + bonus + equity; withdraw page includes cash-only notice.

---

## Manual test plan

1. **Grant bonus:** Admin grants $500; trader sees bonus in bottom dock / dashboard; equity increases.
2. **Open trade (cash only):** $1000 cash + $500 bonus; position margin $200 → `margin_from_cash = 200`, `margin_from_bonus = 0`.
3. **Open trade (spills to bonus):** Use positions that exhaust free cash first; new position margin from bonus → `margin_from_bonus > 0`, wallet `bonus_locked` increases.
4. **Close in profit:** Cash increases; bonus balance unchanged (aside from lock release).
5. **Close in loss:** Bonus pool decreases first (consumable), then cash for remainder.
6. **Revoke:** With locked bonus, revokable = balance − locked; revoke over revokable → 422 with `revokable` in body; partial revoke succeeds.
7. **Withdraw:** Full “balance” including bonus as a number should still only allow withdrawal up to **cash** `available_balance`.
8. **History:** Grant, revoke, lock, release, absorb, and PnL rows appear in admin bonus transaction list.

---

## Known limitations and edge cases

- **Replay safety:** Closed positions use `bonus_wallet_released`; historical closes were marked released in migration `062` so replays do not double-move cash.
- **Consumable bonus on loss:** Uses `bonus_balance - bonus_locked` at loss step (after margin release), not “gross” `bonus_balance` alone — aligns with locked bonus not being revocable and not being double-counted.
- **Admin history filter `type`:** Comma-separated list; server uses `type::text = ANY($1)`.
- **PnL in admin list:** `pnl_credit` / `pnl_debit` are included in the bonus admin transaction query for a full audit trail of close-related wallet movements.
