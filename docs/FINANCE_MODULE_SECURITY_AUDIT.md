# Finance Module Security & Correctness Audit

**Scope:** Deposit/withdrawal flows, wallet/ledger, account summary, stop-out publisher, admin finance UI API, affiliate commission on deposit.  
**Out of scope:** Position/order routes in `deposits.rs`, KYC, auth internals, order engine.  
**Method:** Static read-only review.  
**Date:** 2026-05-19

**Related:** [TRADING_API_SECURITY_AUDIT.md](./TRADING_API_SECURITY_AUDIT.md), [ORDER_ENGINE_SECURITY_AUDIT.md](./ORDER_ENGINE_SECURITY_AUDIT.md), [AUTH_SERVICE_SECURITY_AUDIT.md](./AUTH_SERVICE_SECURITY_AUDIT.md)

---

# 0. Executive Summary

Finance uses **`transactions`** as the workflow record (no `deposit_requests` in auth-service; table dropped in `database/migrations/0004_remove_deposit_requests_table.sql`) and **`wallets` + `ledger_entries`** for spot balance mutations via `ledger_service::create_ledger_entry`. Displayed balance for users (`calculate_wallet_balance`, `compute_account_summary_inner`) is recomputed from **transactions SUM + positions PnL**, not from `wallets.available_balance`. Withdrawal checks use **`wallets.available_balance` only**, with **no lock at request time** and **no open-position / free-margin gate** at approval. Money-changing paths are **not wrapped in DB transactions**, **lack row locks**, and **do not verify `rows_affected`** on status transitions—concurrent double-approve can **double-credit**. Admin approve/direct-deposit paths repeat the auth audit pattern: **`deposits:approve` without `ensure_user_in_allowed_groups`**, and `GET /api/admin/deposits` lists **all users’ deposits** for any `finance:view` holder.

**Trust score: 3/10**

**Go/no-go:** **No-go** for production money movement until ledger updates are atomic with transaction status, approval is scoped, and withdrawal uses a single balance model with reservation.

**Top 3 issues:**
1. **Concurrent approval → double ledger credit** (no `SELECT FOR UPDATE` / no single DB transaction; `approve_deposit` does not check update row count).
2. **Split brain: `wallets` vs transactions-formula balance** — withdrawals gate on wallet; trading margin uses transaction formula; affiliate rebates credit wallet only.
3. **Unscoped admin credit** — direct deposit + approve any `user_id` with `deposits:approve` only.

---

# 1. Module Inventory

| Path | Lines | Purpose |
|------|------:|---------|
| `routes/deposits.rs` (finance subset) | ~1,750 in ~3,706 file | Deposit request/direct/approve/reject, wallet balance, account summary, stop-out, publish helpers |
| `routes/finance.rs` | 1,039 | Admin overview, list transactions/wallets, approve/reject |
| `routes/withdrawals.rs` | 176 | User withdrawal request (separate router; in scope for withdrawal flow) |
| `services/ledger_service.rs` | 142 | `get_or_create_wallet`, `create_ledger_entry`, `get_wallet_balance` |
| `services/affiliate_commission_service.rs` | 207 | Commission on deposit approval |
| `routes/admin_bulk.rs` | 516 | **No bulk deposit/withdraw** — only `users:bulk_create` user provisioning |
| `database/schema.sql` | wallets, transactions, ledger_entries | Authoritative schema reference |
| `migrations/20260307330000_add_finance_manual_adjustment.sql` | permission seed | `finance:manual_adjustment` — **no route implements it** |

**Dead / duplicate:**
- Comments still reference `deposit_requests` (`deposits.rs:2095`) — table removed.
- Two approve paths: `POST /api/admin/deposits/:id/approve` and `POST /api/admin/finance/transactions/:id/approve` (status `approved` vs `completed`).
- `balances` table: **not present** in schema (only `wallets`).

---

# 2. Architecture & Data Flow

## Deposit request (user)

```
POST /api/deposits/request (JWT)
  → INSERT transactions (type=deposit, status=pending, method=manual)
  → NATS deposit.request.created + Redis deposits:requests
  → NOTIFY admins (users.role admin/super_admin)
```

## Admin approval

```
POST /api/admin/deposits/:id/approve  OR  POST /api/admin/finance/transactions/:id/approve
  → permission deposits:approve (NO group scope)
  → UPDATE transactions status (approved | completed)
  → ledger_service::create_ledger_entry (+delta)
  → affiliate_commission_service::accrue_commission_on_deposit (deposits only)
  → publish_wallet_balance_updated (transactions formula)
  → compute_and_cache_account_summary → Redis pos:summary / account summary hash
```

## Direct deposit

```
POST /api/admin/deposits/direct
  → INSERT transactions status=approved immediately
  → ledger credit (same as approve)
  → affiliate commission
```

## Withdrawal

```
POST /api/withdrawals/request
  → CHECK wallets.available_balance >= amount (no lock)
  → INSERT transactions withdrawal pending
  → (funds NOT debited)

POST /api/admin/finance/transactions/:id/approve
  → CHECK wallets.available_balance again
  → ledger debit (-net_amount)
  → status=completed
```

## Account summary

```
compute_account_summary_inner:
  balance = SUM(deposits approved|completed) - SUM(withdrawals completed) + SUM(closed positions pnl)
  margin_used, unrealized from Redis (preferred) or DB positions
  equity = balance + unrealized
  free_margin = max(0, equity - margin_used)
  → cache Redis Keys::account_summary(user_id)
  → try_publish_stop_out_close_all if margin_level < threshold
```

## Stop-out (finance side)

```
register_stop_out_nats (main)
compute_and_cache_account_summary_with_prices
  → if margin_level < stop_out_threshold:
       SET pos:stop_out:triggered:{user} NX EX 60
       NATS cmd.position.close_all { user_id, correlation_id, ts }
  → if margin_level < 0: same with liquidation reason
```

### Endpoint table

| Method | Path | Who | DB writes | Redis | NATS |
|--------|------|-----|-----------|-------|------|
| POST | `/api/deposits/request` | JWT user | `transactions` pending | pub `deposits:requests` | `deposit.request.created` |
| POST | `/api/admin/deposits/direct` | `deposits:approve` | `transactions`, `ledger_entries`, `wallets` | balance/summary | — |
| POST | `/api/admin/deposits/:id/approve` | `deposits:approve` | same + `notifications` | same | `deposit.request.approved` |
| POST | `/api/admin/deposits/:id/reject` | `deposits:reject` | `transactions` rejected | — | — |
| GET | `/api/admin/deposits` | `finance:view` | read all deposits | — | — |
| GET | `/api/wallet/balance` | JWT user | read | — | — |
| GET | `/api/account/summary` | JWT user | read/compute | read/write summary | — |
| GET | `/api/account/deposits` | JWT user | read own | — | — |
| POST | `/api/withdrawals/request` | JWT user | `transactions` pending | pub | `withdrawal.request.created` |
| GET | `/api/admin/finance/overview` | `finance:view` | read | — | — |
| GET | `/api/admin/finance/transactions` | `finance:view` | read **scoped** | — | — |
| POST | `/api/admin/finance/transactions/:id/approve` | `deposits:approve` | ledger + `transactions` | summary | `wallet.balance.updated` |
| POST | `/api/admin/finance/transactions/:id/reject` | `deposits:reject` | `transactions` | — | — |
| GET | `/api/admin/finance/wallets` | `finance:view` | read **scoped** | — | — |

### Money mutation locations

| Location | Operation | Actor |
|----------|-----------|-------|
| `ledger_service.rs:87-114` | INSERT `ledger_entries`; UPDATE `wallets.available_balance` | all approvals |
| `deposits.rs:250-268` | INSERT pending deposit | user |
| `deposits.rs:2237-2306` | INSERT approved + ledger credit | admin direct |
| `deposits.rs:2462-2503` | UPDATE approved + ledger | admin approve |
| `finance.rs:239-251` | ledger before status UPDATE | admin finance approve |
| `affiliate_commission_service.rs:122-134` | ledger rebate credit | system on deposit |

**Invariant broken:** `wallets.available_balance` ≠ `SUM(ledger_entries.delta)` enforced in app; display balance often ≠ wallet row.

---

# 3. Findings — DETAILED

---
### F1: Concurrent double-approval credits wallet twice
- **Severity:** 🔴 Critical
- **Category:** Race Condition | Double-Credit
- **Location:** `deposits.rs:2462-2503`, `finance.rs:187-251`, `ledger_service.rs:65-114`
- **Code:**

```2462:2474:backend/auth-service/src/routes/deposits.rs
    sqlx::query(
        r#"
        UPDATE transactions
        SET status = $1::transaction_status, created_by = $2, completed_at = $3, updated_at = $4
        WHERE id = $5 AND status = 'pending'::transaction_status
        "#,
    )
    ...
    .execute(&pool)
    ...
    // No check of rows_affected — continues to ledger even if 0 rows updated
    ledger_service::create_ledger_entry(...)
```

```65:114:backend/auth-service/src/services/ledger_service.rs
    let balance_row = sqlx::query("SELECT available_balance FROM wallets WHERE id = $1")
    ...
    let balance_after = current_balance + delta;
    INSERT INTO ledger_entries ...
    UPDATE wallets SET available_balance = $1 ...
```

- **What's wrong:** No `BEGIN`/`COMMIT`, no `FOR UPDATE`, no idempotency key on approval. Two admins (or double-click) can both pass `current_status == pending` and both run `create_ledger_entry`.
- **Attack scenario:** Two `POST .../approve` in parallel on pending $10,000 deposit → user wallet +$20,000; transaction row may show one approval.
- **Impact:** Direct platform loss.
- **Recommended fix:** Single transaction: `UPDATE ... WHERE id=$1 AND status='pending' RETURNING *`; abort if no row; then ledger; use `SELECT ... FOR UPDATE` on wallet; unique constraint on `ledger_entries.ref` = transaction reference.

---
### F2: `approve_deposit` marks approved before ledger — failed ledger leaves uncredited approved deposit
- **Severity:** 🔴 Critical
- **Category:** State Consistency
- **Location:** `deposits.rs:2461-2503`
- **What's wrong:** Status set to `approved` first; if `create_ledger_entry` fails, returns 500 but deposit is **approved without wallet credit**. Retry may hit F1 or “not pending”.
- **Impact:** User sees approved deposit, no balance; manual reconciliation required.
- **Recommended fix:** Ledger inside same transaction before commit; or status transition only after ledger success.

---
### F3: `finance::approve_transaction` credits ledger before status UPDATE — retry double-credits
- **Severity:** 🔴 Critical
- **Category:** Race Condition | Double-Credit
- **Location:** `finance.rs:237-306`
- **What's wrong:** Ledger at line 239; `UPDATE transactions SET status='completed' WHERE id=$4` **without** `AND status='pending'`. If UPDATE fails after ledger, status stays pending; second approve credits again.
- **Impact:** Double payout on transient DB errors.
- **Recommended fix:** Atomic transaction; `UPDATE ... WHERE status='pending' RETURNING`; ledger only if row returned.

---
### F4: Dual balance model — withdrawals vs trading vs display
- **Severity:** 🔴 Critical
- **Category:** State Consistency
- **Location:** `withdrawals.rs:70-95`, `deposits.rs:394-444`, `deposits.rs:1759-1766`, `orders.rs` via `get_free_margin_from_db_fast`
- **Code:**

```70:95:backend/auth-service/src/routes/withdrawals.rs
    SELECT available_balance FROM wallets WHERE user_id = $1 ...
    if amount > available_balance { return BAD_REQUEST; }
```

```1759:1766:backend/auth-service/src/routes/deposits.rs
    let balance = deposits - withdrawals + realized_pnl;
    let equity = balance + unrealized_pnl;
    let free_margin = if equity >= margin_used { equity - margin_used } else { Decimal::ZERO };
```

- **What's wrong:** Withdrawal uses **wallet row** (ledger). Trading margin uses **transactions + positions** (ignores wallet). Affiliate rebate increases wallet without a matching deposit transaction line for the user’s trading balance formula.
- **Attack scenario:** User receives $50k direct deposit (ledger + transaction). Trading UI free margin matches formula. User requests withdrawal of full `wallets.available_balance` while large open margin positions exist — approval only rechecks wallet, not equity/margin.
- **Impact:** Over-withdrawal vs risk; reconciliation impossible without dual books.
- **Recommended fix:** One authoritative balance; withdrawal holds use `locked_balance` or pending withdrawal reserves; approve against `free_margin` from same function as `place_order`.

---
### F5: Withdrawal request does not reserve funds — TOCTOU until approval
- **Severity:** 🟠 High
- **Category:** Race Condition
- **Location:** `withdrawals.rs:97-125`
- **What's wrong:** Pending withdrawal does not debit or lock wallet. User can submit multiple pending withdrawals each passing balance check, or trade/lose equity before approval.
- **Attack scenario:** Balance $1,000 → three pending $1,000 withdrawals → admin approves two → negative wallet or double pay if checks race.
- **Impact:** Overdraft / duplicate payout.
- **Recommended fix:** On request: `UPDATE wallets SET available_balance = available - amt, locked_balance = locked + amt` in transaction with pending tx insert.

---
### F6: Admin approve / direct deposit — no tag/group scoping (IDOR credit)
- **Severity:** 🟠 High
- **Category:** IDOR | Authorization
- **Location:** `deposits.rs:2212-2220`, `2408-2418`, `finance.rs:143-151`
- **What's wrong:** Only `deposits:approve`; no `ensure_user_in_allowed_groups` on target `user_id`. Repeats auth audit F3.
- **Attack scenario:** Scoped manager `POST /api/admin/deposits/direct` `{ "userId": "<victim>", "amount": 1000000 }` → immediate ledger credit.
- **Impact:** Unauthorized creation of money on arbitrary accounts.
- **Recommended fix:** Resolve allowed user IDs; reject if target not in set (unless super-admin).

---
### F7: `GET /api/admin/deposits` lists all tenants — no scope filter
- **Severity:** 🟠 High
- **Category:** IDOR | Information Disclosure
- **Location:** `deposits.rs:2076-2149`
- **What's wrong:** `finance:view` loads up to **1000** deposit transactions globally — unlike `finance.rs:list_transactions` which uses `resolve_allowed_user_ids_for_trading`.
- **Impact:** Cross-book PII and amounts leak.
- **Recommended fix:** Same scoping as `list_transactions`.

---
### F8: `finance::approve_transaction` — no scope on transaction owner
- **Severity:** 🟠 High
- **Category:** IDOR
- **Location:** `finance.rs:156-185`
- **What's wrong:** Fetches transaction by id only; approves withdrawal/deposit for any user.
- **Recommended fix:** After fetch, `ensure_user_in_allowed_groups(pool, &claims, user_id)`.

---
### F9: `locked_balance` column never updated in finance paths
- **Severity:** 🟡 Medium
- **Category:** State Consistency
- **Location:** `schema.sql:201-202`; grep shows only INSERT 0 and SELECT
- **What's wrong:** Pending withdrawals do not move funds to `locked_balance`; column is dead for enforcement.
- **Recommended fix:** Implement lock on withdrawal request or remove column from API contracts.

---
### F10: Request bodies use `f64` for amounts; `AccountSummary` stored/served as `f64`
- **Severity:** 🟡 Medium (🔴 if large crypto amounts — here USD 2dp)
- **Category:** Numeric Precision
- **Location:** `deposits.rs:209-210`, `withdrawals.rs:35-36`, `deposits.rs:508-511`, `1774-1787`
- **Code:**

```209:210:backend/auth-service/src/routes/deposits.rs
pub struct CreateDepositRequest {
    pub amount: f64,
```

```1774:1787:backend/auth-service/src/routes/deposits.rs
    let to_f64 = |d: Decimal| d.to_string().parse::<f64>().unwrap_or(0.0);
    Ok(AccountSummary { balance: to_f64(balance), ... })
```

- **What's wrong:** Conversion `Decimal::from_str(&req.amount.to_string())` inherits IEEE rounding for large values. Internal ledger uses `Decimal` — good. API layer leaks `f64` for money display and requests.
- **Recommended fix:** String decimal or `Decimal` in JSON; never `f64` for money fields.

---
### F11: `finance:manual_adjustment` permission exists — no API implementation
- **Severity:** 🟡 Medium
- **Category:** Audit Trail | Other
- **Location:** `migrations/20260307330000_add_finance_manual_adjustment.sql`; no handler in `finance.rs`
- **What's wrong:** Operators may assume adjustment exists; only deposit/withdrawal/ledger paths available.
- **Recommended fix:** Implement with strict audit, caps, dual control, or remove permission.

---
### F12: Affiliate commission on deposit — no reversal on reject/chargeback
- **Severity:** 🟡 Medium
- **Category:** Double-Credit | State Consistency
- **Location:** `affiliate_commission_service.rs:19-149`; called from approve paths only
- **What's wrong:** Commission paid immediately on approval; `reject_deposit` does not claw back referrer ledger.
- **Impact:** Referrer keeps commission if deposit later reversed manually.
- **Recommended fix:** Accrue on `completed` with hold period; reversal ledger entry linked to deposit id.

---
### F13: No idempotency on user deposit/withdrawal create
- **Severity:** 🟡 Medium
- **Category:** Idempotency
- **Location:** `deposits.rs:245`, `withdrawals.rs:97`
- **What's wrong:** Each POST creates new `transactions` row with new UUID; rapid duplicate submits create duplicate pending rows.
- **Recommended fix:** Client idempotency key + unique partial index on pending per user.

---
### F14: Sparse audit trail on money mutations
- **Severity:** 🟡 Medium
- **Category:** Audit Trail
- **Location:** `record_user_event_fail_open` only on `approve_deposit` / `reject_deposit` (`deposits.rs:2729+`); not on direct deposit, `finance::approve_transaction`, ledger writes
- **What's wrong:** No guaranteed `user_events` for direct credit, finance UI approve, affiliate rebate.
- **Recommended fix:** Mandatory event per ledger entry with before/after balance, actor, IP.

---
### F15: Stop-out publisher — no wallet adjustment; relies on engine close
- **Severity:** 🟡 Medium
- **Category:** State Consistency | Other
- **Location:** `deposits.rs:55-102`, `1666-1673`
- **What's wrong:** Publishes `cmd.position.close_all` with cooldown NX 60s; does not write audit row; negative equity handling is downstream. Race with new `place_order` possible (engine/auth issues).
- **Impact:** Duplicate close_all suppressed 60s; gap if first publish fails after SET.
- **Recommended fix:** Persist stop-out event; engine-level mutex per user.

---
### F16: No rate limits on deposit/withdrawal endpoints
- **Severity:** 🔵 Low
- **Category:** Resource Limit
- **Location:** all finance POST handlers
- **Confirmed:** Same as auth audit — no rate limiting.

---
### F17: `admin_bulk.rs` — no bulk deposit/withdraw in scope
- **Severity:** N/A (documented)
- **Category:** Other
- **Note:** User spec asked for bulk deposit audit; **only bulk user creation exists**. No batch credit path found.

---

## 3.1 Deposit request flow — confirmations

| Check | Result |
|-------|--------|
| `deposit_requests` table | **Dropped**; `transactions` only (`deposits.rs:249`) |
| Amount validation | $10–$1M, max 2 decimal places (`deposits.rs:233-242`) |
| Currency | Hardcoded **USD** |
| Method | `manual` enum in SQL |
| Reference | Server-generated `DEP-{uuid}` |
| Idempotency | **None** (F13) |
| Rate limit | **None** (F16) |
| Note field | JSON `method_details` — no length cap found |

---

## 3.2 Admin approval — confirmations

| Check | Result |
|-------|--------|
| Permission | `deposits:approve` |
| Scoping | **Missing** (F6, F8) |
| Atomicity | **No** (F1, F2, F3) |
| Double-approve | **Vulnerable** (F1) |
| Reject then approve | Rejected stays rejected (`status != pending`) — OK |
| Audit | Partial — approve/reject deposit path only |
| Notification | Yes — `notifications` + NATS push on approve |

---

## 3.3 Direct deposit — confirmations

| Check | Result |
|-------|--------|
| Permission | `deposits:approve` |
| Scoping | **None** (F6) |
| Amount | `> 0`, `<= 1_000_000` |
| Negative credit | Rejected by `amount <= 0` |
| Audit | **Logs only** — no `user_events` (F14) |
| Dual control / caps | **None** beyond max amount |
| Wallet lock | **None** (F1) |

---

## 3.4–3.5 Withdrawal — confirmations

See F4, F5, F8. **No open-position check** at request or approval. **No demo $100k** in finance paths (unlike trading admin order). `get_free_margin_from_db_fast` returns **zero** if queries fail, not 100k.

---

## 3.6 Manual adjustments

**Not implemented** despite permission (F11).

---

## 3.7 Wallet model

| Source | Role |
|--------|------|
| `wallets` + `ledger_entries` | Spot ledger mutations on approve |
| `transactions` | Workflow + **display balance formula** |
| `positions` | Realized/unrealized PnL in summary |
| Redis `account_summary` / `pos:summary` | Cached metrics for UI + stop-out |
| `balances` table | **Does not exist** |

One wallet per `(user_id, wallet_type, currency)` — default `spot` / USD.

---

## 3.8 Account summary — walkthrough

Core computation (`deposits.rs:1688-1788`):

```1759:1766:backend/auth-service/src/routes/deposits.rs
    let balance = deposits - withdrawals + realized_pnl;
    let equity = balance + unrealized_pnl;
    let free_margin = if equity >= margin_used { equity - margin_used } else { Decimal::ZERO };
```

- **Invalidation:** Recomputed on deposit/withdraw approve, position/order events, price ticks (`price_tick_summary_handler`).
- **Coordinator:** Per-user mutex + 250ms publish throttle (`AccountSummaryCoordinator`).
- **Race:** Position close mid-compute possible; coordinator reduces but does not snapshot DB+Redis transactionally.
- **Used by:** `place_order` via `get_free_margin_from_db_fast` / `compute_and_cache_account_summary` — **same formula**, not wallet row.

---

## 3.9 Stop-out — walkthrough

See diagram in §2. Threshold from group `stop_out_level` (Redis cache + DB). Cooldown **60s** NX. Publishes plain JSON to `cmd.position.close_all` (engine trusts `user_id` — engine audit F9). **No wallet zeroing** in finance layer.

---

## 3.10 Race conditions summary

| Scenario | Mitigation today |
|----------|------------------|
| Concurrent approve same deposit | **None** — F1 |
| Withdraw approve + position loss | **None** — F4, F5 |
| Direct deposit + manual (N/A) | — |
| place_order + withdraw approve | Different balance sources — F4 |
| Stop-out + new order | Cooldown only — weak |
| Two admins same wallet | Last-write-wins on ledger — F1 |

---

## 3.11 Numeric precision

- **Ledger/DB:** `Decimal` / `NUMERIC(20,8)` — good.
- **API requests/responses:** `f64` in several DTOs — F10.
- **Events:** `amount.to_string().parse::<f64>()` in publish paths — precision loss in WS payloads.

---

## 3.12 Affiliate commissions

- **Trigger:** Deposit approve / direct deposit / finance approve (`affiliate_commission_service.rs:14-18`).
- **Self-referral:** Only blocked if `referred_by_user_id` null; no explicit same-user check in snippet — verify DB constraint separately.
- **Cap:** Percent from `affiliate_commission_layers` level 1; amount `round_dp(2)`; no per-period cap in service.
- **Timing:** Immediate ledger `rebate` + status `completed`.
- **Reversal:** **None** on reject (F12).

---

## 3.13 Information disclosure

| Endpoint | Scoped? |
|----------|---------|
| `finance/transactions` | Yes |
| `finance/wallets` | Yes |
| `finance/overview` | Yes |
| `admin/deposits` list | **No** — F7 |
| User wallet/summary | Own `claims.sub` only — OK |

Error on deposit history returns `e.to_string()` (`deposits.rs:3372`) — possible leak.

---

## 3.14 Audit trail

| Operation | user_events | ledger_entries |
|-----------|-------------|----------------|
| User deposit request | No | No |
| Approve deposit (deposits route) | Yes `finance.deposit_approved` | Yes |
| Reject deposit | Yes | No |
| Direct deposit | No | Yes |
| Finance approve | No | Yes |
| Affiliate rebate | No | Yes |

**Invariant:** `wallet balance = sum(ledger deltas)` — **not enforced**; display balance ignores ledger.

---

## 3.15 Bulk deposits

**Not present** in `admin_bulk.rs` (user creation only).

---

## 3.16 Wallet UPDATE locations

Only `ledger_service.rs:107-114` updates `wallets.available_balance`. No other finance path updates wallet directly.

---

## 3.17 Cross-checks with prior audits

| Prior finding | Finance module |
|---------------|----------------|
| Engine balance not decremented on fill | Finance summary uses DB/Redis positions; **orthogonal** but worsens F4 split |
| Engine default $10k if missing | **Not repeated** in finance; fast margin returns 0 on failure |
| Trading API admin $100k injection | **Not in finance** |
| Auth admin unscoped | **Repeated** F6, F7, F8 |
| Trading idempotency | Deposit/withdraw **no keys** F13 |

---

## 3.18 SQL safety

`finance.rs:list_transactions` builds `WHERE` via `format!` but binds filter values — **acceptable** if `type`/`status` filters are validated (passed as bound strings). `list_deposits` uses static SQL — OK. No user-controlled column names found.

---

## 3.19 Error handling

- `unwrap_or(false)` on admin_exists checks — not panic on request path.
- `serde_json::to_string(&event).unwrap_or_default()` on Redis publish — silent empty payload possible.
- No `.unwrap()` on user amount parsing in hot paths.

---

## 3.20 Test coverage

**No unit/integration tests** found for `ledger_service`, `calculate_wallet_balance`, stop-out, or deposit lifecycle in auth-service.

---

# 4. Strengths

- **Decimal** in SQL and ledger math (not `f64` in DB writes).
- **Pending-only** guard on `approve_deposit` SQL `WHERE status='pending'`.
- **Withdrawal/deposit amount bounds** ($10 min, $1M max, 2 decimal places).
- **Finance list/overview** uses `resolve_allowed_user_ids_for_trading` consistently.
- **Stop-out cooldown** (`SET NX EX 60`) limits close_all storms.
- **Account summary coordinator** reduces concurrent recompute flicker.
- **Affiliate** uses ledger + commission row linkage to deposit `transaction_id`.

---

# 5. Trust Score Breakdown

| Dimension | Score |
|-----------|------:|
| Authorization | 3 |
| IDOR resistance | 3 |
| Atomicity of money operations | 2 |
| Numeric precision | 4 |
| Idempotency | 2 |
| Audit trail | 4 |
| Race condition safety | 2 |
| Information disclosure | 3 |
| Test coverage | 1 |
| Error/panic safety | 6 |

**Harmonic mean ≈ 2.8 → Overall 3/10**

---

# 6. Production Go-Live Verdict

## 🔴 **Not ready**

Real-money deposit, direct credit, and withdrawal approval must not go live until F1–F6 are addressed. The dual balance model alone can cause withdrawable funds that do not match risk exposure.

---

# 7. Prioritized Fix List

| # | Finding | Effort | Risk | Sprint |
|---|---------|--------|------|--------|
| 1 | F1–F3 — Atomic approve + `FOR UPDATE` wallet + row counts | L | Double credit | 1 |
| 2 | F4–F5 — Single balance source + withdrawal reservation | L | Overdraft | 1 |
| 3 | F6–F8 — Scope all approve/direct/list deposits | M | IDOR credit/leak | 1 |
| 4 | F2 — Fix approve ordering / compensating transactions | M | Stuck approved | 2 |
| 5 | F14 — Mandatory audit on every ledger entry | S | Forensics | 2 |
| 6 | F12 — Commission reversal on reject | M | Affiliate loss | 3 |
| 7 | F10 — Remove f64 from money API | S | Precision | 3 |
| 8 | F13 — Idempotency keys on user requests | S | Duplicate pending | 3 |

---

# 8. Cross-Module Notes

| Module | Implication |
|--------|-------------|
| **Order engine** | Uses Redis `user:{id}:balance` JSON; may disagree with `wallets` and transaction formula — align on one feed |
| **Trading API** | `place_order` free margin from `get_free_margin_from_db_fast` — must match withdrawal gate after F4 fix |
| **ws-gateway** | Publishes `wallet.balance.updated` / `account:summary:updated` — consumers must know which balance semantics |
| **AI reports** | `data_gatherer` reads group stop-out — consistent with finance thresholds |

---

*End of audit. Static analysis only.*
