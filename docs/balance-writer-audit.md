# Balance state writer audit (read-only)

**Scope:** Enumerate code paths that **mutate** any of:

1. Postgres **`wallets`** (`available_balance`, `locked_balance`, and related `bonus_*` when part of same row)
2. Postgres **`positions`** (including `margin_used`, `accumulated_swap_usd`, `accumulated_fees_usd`, PnL fields, `status`, `size`, bonus flags)
3. Redis **`pos:summary:{user_id}`** (same key as `Keys::account_summary` → `pos:summary:{uuid}`)
4. Redis **`user:{user_id}:balance`** string JSON (order-engine validation / events)
5. Postgres **`transactions`** (audit rows)

**Non-goals:** `ledger_entries` table (separate audit stream), `swap_charge_log`, `fee_charge_log`, Redis `bal:{user}:{currency}` used by **core-api** legacy path, `balances` table in core-api.

**Method:** `grep` for `UPDATE wallets`, `INSERT INTO wallets`, `UPDATE positions`, `INSERT INTO positions`, `INSERT INTO transactions`, `UPDATE transactions`, `account_summary` / `pos:summary`, `user:.*balance`, plus targeted file reads.

---

## Step 1 — Postgres `wallets` writers

| File:line (anchor) | Function / context | Columns / action | Trigger | In DB transaction? |
|--------------------|-------------------|------------------|---------|-------------------|
| `backend/auth-service/src/services/ledger_service.rs:36–47` | `get_or_create_wallet` | `INSERT INTO wallets` … `available_balance, locked_balance` = 0 | First use of wallet for user/currency/type | Standalone `execute` |
| `backend/auth-service/src/services/ledger_service.rs:104–116` | `create_ledger_entry` | `UPDATE wallets SET available_balance = $1` (full replacement with `balance_after`) | Any caller passing `wallet_id` + `delta` | **No** — runs after `INSERT INTO ledger_entries` in same function, sequential statements on pool |
| `backend/auth-service/src/services/fee_placement.rs:58–71` | `charge_placement_fee_in_tx` | `available_balance = available_balance - $1` | `place_order` / admin order path when fee &gt; 0 | **Yes** — `tx: &mut Transaction` |
| `backend/auth-service/src/services/fee_placement.rs:136–147` | `refund_placement_fee_for_order` | `available_balance = available_balance + $1` | Order rejected after fee taken | **Yes** — `pool.begin()` |
| `backend/auth-service/src/services/bonus_service.rs:57–62` | `ensure_spot_usd_wallet` | `INSERT INTO wallets` … `ON CONFLICT DO NOTHING` | Any bonus/margin path needing USD spot wallet | Inside caller’s `tx` |
| `backend/auth-service/src/services/bonus_service.rs:153–163` | `grant_bonus` | `bonus_balance = bonus_balance + $1` | Admin bonus grant (`admin_bonus.rs`) | **Yes** `pool.begin()` |
| `bonus_service.rs:218–224` | `revoke_bonus` | `bonus_balance = bonus_balance - $1` | Admin bonus revoke | **Yes** |
| `bonus_service.rs:283–297` | `lock_margin` | `available_balance -= margin_from_cash`, `locked_balance += margin_from_cash`, `bonus_locked += margin_from_bonus` | `place_order` / admin trading order (`orders.rs`, `admin_trading.rs`) | **Yes** — caller’s `tx` |
| `bonus_service.rs:340–354` | `rollback_order_margin_lock` | reverses cash lock + `bonus_locked` | Cancel/reject order consumer | **Yes** |
| `bonus_service.rs:400–414` | `release_and_apply_pnl` step 1 | `locked_balance`, `bonus_locked`, `available_balance` (release margin) | `event.position.closed` handler in `lib.rs` | **Yes** — `tx` passed in |
| `bonus_service.rs:444–448` | `release_and_apply_pnl` | `bonus_balance -= bonus_absorb` | Same, when realized loss | **Yes** |
| `bonus_service.rs:465–469` | same | `available_balance -= cash_loss` | Same | **Yes** |
| `bonus_service.rs:487–491` | same | `available_balance += realized_pnl` | Same, profit | **Yes** |
| `backend/auth-service/src/services/position_cost_settlement.rs:93–106` | `settle_swap_on_closed_position` | `available_balance -= accumulated_swap_usd` (with guard) | After successful `release_and_apply_pnl` commit (`lib.rs` ~579–585) | **Yes** `pool.begin()` |

**Callers of `create_ledger_entry` (wallet mutation without going through bonus/fee helpers):**

- `backend/auth-service/src/routes/finance.rs:223–246` — `approve_transaction` (deposit/withdrawal approval delta).
- `backend/auth-service/src/routes/deposits.rs:2695–2710` — `create_direct_deposit`.
- `backend/auth-service/src/routes/deposits.rs:2890–2910` (approx.) — second `create_ledger_entry` in another deposit/approve path (`deposits.rs` ~2900).
- `backend/auth-service/src/services/affiliate_commission_service.rs:122` — referrer commission credit (`create_ledger_entry` call site).

**No `UPDATE wallets` found** under `apps/order-engine/` or `apps/core-api/` for the **`wallets`** table (core-api uses a different `balances` table — see Step 7E).

---

## Step 2 — Postgres `positions` writers

| File:line | Function | What changes | Trigger |
|-----------|----------|--------------|---------|
| `backend/auth-service/src/services/position_event_handler.rs:153–188` | `sync_position_to_database` | `UPDATE positions` — `size`, `entry_price`, `mark_price`, `leverage`, `margin_used`, `liquidation_price`, `pnl`, `pnl_percent`, `status`, `closed_at`, `margin_from_cash`, `margin_from_bonus` | NATS `evt.position.updated` consumer |
| `position_event_handler.rs:205–252` | same | `INSERT INTO positions` … `ON CONFLICT DO UPDATE` (upsert) | New position from event |
| `backend/auth-service/src/services/fee_placement.rs:251–260` | `link_placement_fee_to_position_on_fill` | `accumulated_fees_usd = accumulated_fees_usd + $1` | Order filled → fee log linked to position |
| `backend/auth-service/src/services/swap_engine.rs:242–252` | `charge_position_swap` (internal) | `accumulated_swap_usd = accumulated_swap_usd + $1` | Daily swap rollover job |
| `backend/auth-service/src/services/bonus_service.rs:506–513` | `release_and_apply_pnl` | `bonus_loss_absorbed`, `bonus_wallet_released = TRUE` | `event.position.closed` |
| `apps/core-api/src/persistence.rs:129` | (consumer) | `INSERT INTO positions` (minimal columns) | **core-api** NATS persistence path — parallel pipeline |

**Note:** Order-engine **Redis/Lua** is the primary runtime for open positions; Postgres rows are **synced** via `position_event_handler` (can lag Redis).

---

## Step 3 — Redis `pos:summary:{user_id}` writers

**Single write implementation:** `compute_and_cache_account_summary_with_prices` — `Keys::account_summary(user_id)` then **`hset_multiple`** (fields include `balance`, `equity`, `margin_used`, `free_margin`, `margin_level`, `realized_pnl`, `unrealized_pnl`, `bonus`, swap/fee totals, `updated_at`, thresholds):

```1942:1974:backend/auth-service/src/routes/deposits.rs
                let key = redis_model::keys::Keys::account_summary(user_id);
                let json = match serde_json::to_string(&summary_with_threshold) {
                    Ok(j) => j,
                    Err(e) => {
                        error!("Failed to serialize account summary: {}", e);
                        return;
                    }
                };
                if let Ok(mut conn) = redis.get().await {
                    let thresh_str = summary_with_threshold
                        .margin_call_level_threshold
                        .map(|v| v.to_string())
                        .unwrap_or_default();
                    let stop_out_str = summary_with_threshold
                        .stop_out_level_threshold
                        .map(|v| v.to_string())
                        .unwrap_or_default();
                    let _: Result<(), _> = conn.hset_multiple(&key, &[
                        ("balance", summary_with_threshold.balance.to_string()),
                        ("equity", summary_with_threshold.equity.to_string()),
                        ("margin_used", summary_with_threshold.margin_used.to_string()),
                        ("free_margin", summary_with_threshold.free_margin.to_string()),
                        ("margin_level", summary_with_threshold.margin_level.clone()),
                        ("margin_call_level_threshold", thresh_str),
                        ("stop_out_level_threshold", stop_out_str),
                        ("liquidation_level", "0".to_string()),
                        ("realized_pnl", summary_with_threshold.realized_pnl.to_string()),
                        ("unrealized_pnl", summary_with_threshold.unrealized_pnl.to_string()),
                        ("bonus", summary_with_threshold.bonus.to_string()),
                        ("total_swap_paid_usd", summary_with_threshold.total_swap_paid_usd.to_string()),
                        ("total_fees_paid_usd", summary_with_threshold.total_fees_paid_usd.to_string()),
                        ("updated_at", summary_with_threshold.updated_at.clone()),
                    ]).await;
```

**Callers of `compute_and_cache_account_summary` or `_with_prices` (exhaustive from repo grep):**

| File:line | Context |
|-----------|---------|
| `deposits.rs:2319` | `get_account_summary` refresh path |
| `deposits.rs:2422` | `get_account_summary_for_user` refresh path |
| `deposits.rs:2730` | referrer after direct deposit |
| `deposits.rs:2796` | `create_direct_deposit` tail |
| `deposits.rs:2930` | referrer in second deposit path |
| `deposits.rs:3083` | another deposit approval tail |
| `orders.rs:746` | background task in `place_order` branch |
| `orders.rs:887` | `place_order` after commit |
| `admin_trading.rs:773` | admin place-order path |
| `finance.rs:332` | `approve_transaction` |
| `finance.rs:339` | affiliate referrer on approve |
| `admin_bonus.rs:152` | grant |
| `admin_bonus.rs:218` | revoke |
| `lib.rs:595–599` | `event.position.closed` subscriber |
| `position_event_handler.rs:60`, `:77` | position NATS sync |
| `order_event_handler.rs:83`, `:98`, `:118`, `:158`, `:173`, `:193` | order event branches |
| `swap_engine.rs:295` | post-swap charge |
| `account_summary_cache_warmup.rs:38` | startup warm |
| `price_tick_summary_handler.rs:185` | tick-driven (`_with_prices`) |

**Coordination:** Always **after** DB state is committed in the same request/handler where applicable; tick path recomputes from DB+Redis read model without mutating `wallets` first.

---

## Step 4 — Redis `user:{user_id}:balance` JSON writers

| File:line | Function | JSON fields written | Trigger | Also updates `pos:summary`? |
|-----------|----------|----------------------|---------|------------------------------|
| `backend/auth-service/src/routes/orders.rs:972–982` | `place_order` (tail) | `currency`, `available` (= `free_margin` from summary), `locked` = `"0"`, `equity`, `margin_used`, `free_margin`, `timestamp` | After `compute_and_cache_account_summary` post-commit | **Yes** — just computed |
| `backend/auth-service/src/routes/admin_trading.rs:875–886` | admin create order path | same pattern | Before NATS `cmd.order.place` | Uses **existing** `pos:summary` HGET; admin path also calls `compute_and_cache_account_summary` earlier (~773) |

**Readers / non-writers in auth-service:** none else SET this key.

**order-engine:** `apps/order-engine/src/engine/validation.rs:82–86` — **GET** only.  
`apps/order-engine/src/engine/position_handler.rs:271–307` — **GET** then NATS `EVENT_BALANCE_UPDATED`; does **not** SET `user:…:balance` in shown snippet.

**Independence / gaps:** Many paths call `compute_and_cache_account_summary` **without** refreshing `user:{id}:balance` (see Step 7C).

**Alternate Redis scheme (not `user:…:balance`):** `apps/core-api/src/deposits.rs:458–514` writes **`bal:{user_id}:USD`** as a **Redis hash** via `HSET` — different key layout than auth-service string JSON.

---

## Step 5 — Postgres `transactions` writers (balance-related)

| File:line | Context | Type |
|-----------|---------|------|
| `fee_placement.rs:20–40` | `insert_fee_tx_row` | `INSERT INTO transactions` (fee / refund rows) |
| `bonus_service.rs:94–114` | `insert_bonus_transaction` | `INSERT` (bonus_grant, bonus_margin_lock, etc.) |
| `position_cost_settlement.rs:72–90` | `settle_swap_on_closed_position` | `INSERT` (swap settlement) |
| `deposits.rs:390`, `2648` | deposit / direct deposit | `INSERT` |
| `deposits.rs:2683`, `2873`, `3235` | status / metadata updates | `UPDATE transactions` |
| `withdrawals.rs:104–120` | `create_withdrawal_request` | `INSERT` pending withdrawal |
| `finance.rs:269–305` | `approve_transaction` | `UPDATE transactions` → `completed` |

**`ledger_service::create_ledger_entry`:** inserts **`ledger_entries`** only — **does not** insert into **`transactions`** (`ledger_service.rs` ~86–102, ~104–116).

---

## Step 6 — Trace by user-facing action

### A. Deposit funds (admin direct deposit)

1. `create_direct_deposit` — `INSERT transactions` (`deposits.rs` ~2646–2665) → `get_or_create_wallet` + `create_ledger_entry` (`~2695–2710`) → affiliate optional → `publish_wallet_balance_updated` + `compute_and_cache_account_summary` (`~2795–2796`).  
2. **`user:…:balance` JSON:** **not** refreshed here.

### B. Deposit / withdrawal approval (Finance UI)

1. `approve_transaction` — validates pending row → `create_ledger_entry` wallet delta (`finance.rs` ~230–246) → `UPDATE transactions` status (`~267–305`) → affiliate on deposit → `publish_wallet_balance_updated` + `compute_and_cache_account_summary` + NATS (`~330–334`).  
2. **`user:…:balance`:** **not** refreshed.

### C. User withdrawal request

1. `create_withdrawal_request` — **only** `INSERT transactions` pending + checks available (`withdrawals.rs` ~70–120). **No `wallets` UPDATE** until approval (path B).

### D. Place market / limit order (margin lock)

1. `place_order` — `lock_margin` in **DB tx** (`orders.rs` ~800–847) + order INSERT + optional `charge_placement_fee_in_tx` (fee + `transactions` INSERT inside **same** `tx`).  
2. `tx.commit()` → `compute_and_cache_account_summary` → Redis `user:…:balance` SET (`~887`, `~963–984`) → NATS / Redis `orders:updates`.

### E. Order fills → position opens (DB sync)

1. Order-engine + Redis authoritative; **`position_event_handler`** upserts **`positions`** Postgres (`position_event_handler.rs` ~153–252) → `compute_and_cache_account_summary` (`~60`, `~77`).  
2. **`wallets`:** not changed on fill (margin already locked). **`user:…:balance`:** **not** updated in this handler.

### F. Position close (manual / SL/TP / engine)

1. **`event.position.closed`** in `lib.rs` (~543–606): `release_and_apply_pnl` in **tx** (wallet + `positions` bonus flags) → `settle_swap_on_closed_position` (wallet + `transactions` for swap) → `compute_and_cache_account_summary` + `publish_wallet_balance_updated`.  
2. **`user:…:balance`:** **not** updated in auth after close.

### G. Stop-out / liquidation

Same subscriber block as F for wallet/summary; additional branches for liquidation notifications (`lib.rs` ~617+ not fully expanded here). **`user:…:balance`:** not shown as updated.

### H. Swap accrual (overnight)

1. `swap_engine` — `UPDATE positions.accumulated_swap_usd` (`swap_engine.rs` ~242–252) + `swap_charge_log` INSERT; **no `wallets`**.  
2. Spawns `compute_and_cache_account_summary` (`~294–296`). **`user:…:balance`:** not updated.

### I. Fees

- **Placement:** `charge_placement_fee_in_tx` — `wallets` + `transactions` + `fee_charge_log` in **order tx** (`fee_placement.rs` ~45–115).  
- **Attribute to position:** `link_placement_fee_to_position_on_fill` — `positions.accumulated_fees_usd` only (`~251–260`).

### J. Bonus grant / revoke

1. `grant_bonus` / `revoke_bonus` — `wallets` + `transactions` via `insert_bonus_transaction` (`bonus_service.rs`).  
2. `admin_bonus.rs` — `compute_and_cache_account_summary` + `publish_wallet_balance_updated` (`~152–153`, revoke similar). **No `user:…:balance` SET.**

### K. FX rate updates

- **No direct** `wallets` / `positions` / `transactions` / `user:…:balance` writes. Affects **`compute_account_summary_inner`** via Redis `fx:rates:usd` read (`deposits.rs` ~2033–2037).

---

## Step 7 — Consistency analysis

### 7A. `wallets` UPDATE vs `transactions` INSERT

- **Paired in same SQL transaction where designed:** `charge_placement_fee_in_tx`, `refund_placement_fee_for_order`, `lock_margin` (bonus-only leg gets `transactions` row), `release_and_apply_pnl` (per sub-step `insert_bonus_transaction`), `settle_swap_on_closed_position`, `grant_bonus` / `revoke_bonus`.
- **`create_ledger_entry`:** updates **`wallets`** + **`ledger_entries`** only — **no new `transactions` row** in that function. Finance approval **updates an existing** `transactions` row instead of inserting a mirror row for the ledger delta.
- **Order margin lock (cash):** **`lock_margin`** does **not** insert a `transactions` row for the **cash** moved to `locked_balance` (only optional **`bonus_margin_lock`** row when bonus used) — **audit gap** for cash lock if strict “every wallet mutation = transactions row” is required.

### 7B. `wallets` update followed by `pos:summary` recompute

- **Often yes:** finance approve, direct deposit, place_order, admin bonus, `event.position.closed`, order/position NATS handlers (spawn or await), swap rollover spawn.  
- **Not guaranteed immediately after every micro-step inside a single multi-statement service** — callers are responsible.

### 7C. `pos:summary` vs `user:…:balance` updated independently

- **`user:…:balance` is only SET** in **`orders.rs`** and **`admin_trading.rs`** (grep results).  
- **All other `compute_and_cache_account_summary` callers** refresh **`pos:summary`** (and pub/sub) **without** refreshing **`user:…:balance`**.  
- **Drift:** After bonus grant, deposit approval, position close, swap accrual, etc., **order-engine `validation.rs` may still read stale `user:…:balance` JSON** until the next **`place_order`**-class sync.

### 7D. Redis summary without prior wallet SQL in same call chain

- **`price_tick_summary_handler`** — recomputes summary from ticks; **does not** write `wallets`. **By design** (mark-to-market).

### 7E. `core-api` vs `auth-service`

| Concern | auth-service | core-api |
|---------|--------------|----------|
| `wallets` table | Yes (paths above) | **No** (uses `balances` + `INSERT … ON CONFLICT` in `deposits.rs` ~517–526) |
| Redis hot balance | `user:{uuid}:balance` **string JSON** (order sync) | `bal:{uuid}:USD` **hash** (`deposits.rs` ~458–514) |
| `pos:summary` | Via shared `compute_and_cache_*` if called | **Not** in shown `core-api` deposit snippet |

**Conclusion:** **Two parallel conventions** if both services run against the same users.

---

## Step 8 — Verdict

**Class 2 — Multi-writer scattered** (leaning **Class 3** on Redis snapshots)

**Evidence:** Wallet SQL spread across **`ledger_service`**, **`fee_placement`**, **`bonus_service`**, **`position_cost_settlement`**, plus orchestration in **`routes/orders.rs`**, **`routes/finance.rs`**, **`routes/deposits.rs`**, **`lib.rs`**, **`admin_trading.rs`**, **`admin_bonus.rs`**. Redis **`pos:summary`** centralized in one function but invoked from **many** triggers. **`user:…:balance`** has **only two** writers while **`pos:summary`** has **many** — **subset inconsistency (Class 3)**.

---

## Step 9 — Design input: proposed `BalanceStateWriter` API (from real usage)

| Proposed method | Inputs | Five-location writes (target behavior) | Current code to replace / call |
|-----------------|--------|------------------------------------------|--------------------------------|
| `ensure_wallet` | `user_id`, currency, type | `INSERT wallets` if missing | `ledger_service::get_or_create_wallet`, `bonus_service::ensure_spot_usd_wallet` |
| `apply_ledger_delta` | `wallet_id`, `delta`, `ref`, `tx_type`, `description`, optional `transactions_id` | `ledger_entries` + `UPDATE wallets.available_balance` + optional `transactions` link policy | `ledger_service::create_ledger_entry`, callers in `finance.rs`, `deposits.rs`, `affiliate_commission_service.rs` |
| `charge_placement_fee` | `user_id`, `order_id`, fee, notional, rule | `UPDATE wallets` + `INSERT transactions` + `fee_charge_log` | `fee_placement::charge_placement_fee_in_tx` |
| `refund_placement_fee` | `user_id`, `order_id` | wallet + `transactions` | `fee_placement::refund_placement_fee_for_order` |
| `lock_order_margin` | `tx`, `user_id`, required_margin | `UPDATE wallets` (avail/lock/bonus_lock) + optional `transactions` for bonus leg | `bonus_service::lock_margin` |
| `rollback_order_margin_lock` | `user_id`, `order_id` | wallet + optional `transactions` | `bonus_service::rollback_order_margin_lock` |
| `release_position_close` | `tx`, `user_id`, `position_id`, margins, `realized_pnl` | wallet + `UPDATE positions` bonus flags + `transactions` for PnL splits | `bonus_service::release_and_apply_pnl` |
| `settle_accumulated_swap` | `user_id`, `position_id` | wallet + `INSERT transactions` | `position_cost_settlement::settle_swap_on_closed_position` |
| `grant_bonus` / `revoke_bonus` | admin + user + amount | wallet + `INSERT transactions` | `bonus_service::grant_bonus` / `revoke_bonus` |
| `accrue_swap_to_position` | position, charge | `UPDATE positions.accumulated_swap_usd` + log | `swap_engine` inner |
| `attribute_fee_to_position` | position, fee | `UPDATE positions.accumulated_fees_usd` | `fee_placement::link_placement_fee_to_position_on_fill` |
| `upsert_position_from_event` | `PositionUpdatedEvent` | `INSERT`/`UPDATE positions` | `position_event_handler::sync_position_to_database` |
| `recompute_derived_state` | `user_id`, optional price overrides | **`pos:summary` HSET** + pub/sub + optional NATS | `compute_and_cache_account_summary(_with_prices)` |
| `sync_order_engine_balance_snapshot` | `user_id` | **`SET user:{id}:balance` JSON** from canonical summary + wallet | `orders.rs` / `admin_trading.rs` tails — **should run whenever `recompute_derived_state` runs for trading users** |

---

## Appendix — grep commands used

```bash
grep -rn "UPDATE wallets|INSERT INTO wallets|DELETE FROM wallets" …/backend …/apps --include="*.rs"
grep -rn "UPDATE positions|INSERT INTO positions|DELETE FROM positions" …
grep -rn "INSERT INTO transactions|UPDATE transactions" …/backend/auth-service …/apps
grep -rn "account_summary|pos:summary|Keys::account_summary" …
grep -rn "user:.*:balance" …
```

**Counts (distinct SQL anchors on `wallets` / `positions`, plus Redis / audit):**

- **`wallets`:** **12** SQL statement blocks across **5** Rust files (`ledger_service`, `fee_placement`, `bonus_service`, `position_cost_settlement` — all under `backend/auth-service/src/services/`).
- **`positions`:** **6** SQL blocks across **5** files (`position_event_handler`, `fee_placement`, `swap_engine`, `bonus_service`, `apps/core-api/src/persistence.rs`).
- **`pos:summary`:** **1** write implementation (`compute_and_cache_account_summary_with_prices`); **~25** distinct invocation sites (table above).
- **`user:{uuid}:balance` string:** **2** `SET` sites (`orders.rs` ~981–982, `admin_trading.rs` ~884).
- **`transactions`:** direct SQL in **6** files (see Step 5).

### Appendix B — Representative code (writers)

`place_order` tail: Redis `user:{id}:balance` JSON sync after summary recompute:

```963:984:backend/auth-service/src/routes/orders.rs
    // Sync balance to Redis so order-engine validation sees the same balance we validated
    if let Ok(mut conn_bal) = orders_state.redis.get().await {
        let summary_key = Keys::account_summary(user_id);
        let equity_val: Option<String> = conn_bal.hget(&summary_key, "equity").await.ok().flatten();
        let margin_used_val: Option<String> = conn_bal.hget(&summary_key, "margin_used").await.ok().flatten();
        let free_margin_synced: String = conn_bal.hget(&summary_key, "free_margin").await.ok().flatten()
            .unwrap_or_else(|| free_margin.to_string());
        let equity = equity_val.as_deref().unwrap_or(&free_margin_synced);
        let margin_used = margin_used_val.as_deref().unwrap_or("0");
        let balance_json = serde_json::json!({
            "currency": "USD",
            "available": free_margin_synced,
            "locked": "0",
            "equity": equity,
            "margin_used": margin_used,
            "free_margin": free_margin_synced,
            "updated_at": now.timestamp_millis()
        });
        let balance_key = format!("user:{}:balance", user_id);
        if let Err(e) = conn_bal.set::<_, _, ()>(&balance_key, balance_json.to_string()).await {
            warn!(order_id = %order_id, user_id = %user_id, error = %e, "Failed to sync balance to Redis for order-engine");
        }
    }
```

`event.position.closed`: wallet + swap settlement + summary + pub — **no** `user:…:balance` `SET`:

```595:606:backend/auth-service/src/lib.rs
                            compute_and_cache_account_summary(
                                &pool_for_closed,
                                redis_for_closed.as_ref(),
                                uid,
                            )
                            .await;
                            publish_wallet_balance_updated(
                                &pool_for_closed,
                                redis_for_closed.as_ref(),
                                uid,
                            )
                            .await;
```

`create_ledger_entry`: `ledger_entries` + `wallets.available_balance` — **no** `transactions` row:

```86:116:backend/auth-service/src/services/ledger_service.rs
    sqlx::query(
        r#"
        INSERT INTO ledger_entries (id, wallet_id, type, delta, balance_after, ref, description, created_at)
        VALUES ($1, $2, $3::transaction_type, $4, $5, $6, $7, NOW())
        "#,
    )
    // ... binds ...
    .execute(pool)
    .await
    .context("Failed to create ledger entry")?;

    // Update wallet balance
    sqlx::query(
        r#"
        UPDATE wallets 
        SET available_balance = $1, updated_at = NOW()
        WHERE id = $2
        "#,
    )
    .bind(balance_after)
    .bind(wallet_id)
    .execute(pool)
    .await
    .context("Failed to update wallet balance")?;
```

Redis key for `pos:summary` (`Keys::account_summary` delegates to `position_summary`):

```41:43:crates/redis-model/src/keys.rs
    pub fn position_summary(user_id: Uuid) -> String {
        format!("pos:summary:{}", user_id)
    }
```

```95:99:crates/redis-model/src/keys.rs
    /// Account summary cache key. Alias for position_summary so all position-related
    /// data (positions + summary) lives under pos:* (centralized position cache).
    pub fn account_summary(user_id: Uuid) -> String {
        Self::position_summary(user_id)
    }
```

---
