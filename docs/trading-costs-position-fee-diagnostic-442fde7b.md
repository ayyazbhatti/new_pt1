# Trading Costs — position fee diagnostic (read-only)

**Purpose:** Verify whether a **placement fee** was charged for a position’s opening order, given the user’s group fee configuration (`fees_enabled`, `fee_rules`, `fee_charge_log`, wallet `fee` transactions).

**Position ID under test:** `442fde7b-2e63-4ea1-83e6-4b91732fa9ae`

**Database (dev):**

- Host: `127.0.0.1`
- Port: `5434`
- Database: `newpt`
- User: `postgres`

**Rules:** Read-only; no schema or data changes. Quote raw `psql` output where results exist.

---

## Step 1 — Position details

```sql
SELECT
  p.id AS position_id,
  p.user_id,
  u.email,
  u.group_id,
  g.name AS group_name,
  g.fees_enabled,
  g.swap_enabled,
  s.code AS symbol,
  s.market AS symbol_market,
  s.quote_currency,
  p.side,
  p.size,
  p.entry_price,
  p.mark_price,
  p.status,
  p.opened_at,
  p.closed_at,
  p.accumulated_fees_usd,
  p.accumulated_swap_usd
FROM positions p
JOIN users u ON u.id = p.user_id
LEFT JOIN user_groups g ON g.id = u.group_id
JOIN symbols s ON s.id = p.symbol_id
WHERE p.id = '442fde7b-2e63-4ea1-83e6-4b91732fa9ae';
```

### Raw output (as run)

```
 position_id | user_id | email | group_id | group_name | fees_enabled | swap_enabled | symbol | symbol_market | quote_currency | side | size | entry_price | mark_price | status | opened_at | closed_at | accumulated_fees_usd | accumulated_swap_usd 
-------------+---------+-------+----------+------------+--------------+--------------+--------+---------------+----------------+------+------+-------------+------------+--------+-----------+-----------+----------------------+----------------------
(0 rows)
```

**Result:** **Position not found** — no row in `public.positions` for this UUID on the specified dev database.

Steps 2–6 below were **not executed** in this run (they require `user_id`, `group_id`, `symbol_id`, and timestamps from Step 1). They are retained as the **standard procedure** for when Step 1 returns a row.

---

## Step 2 — Fee rules for this user’s group

*(Substitute `group_id` from Step 1.)*

```sql
SELECT
  id,
  group_id,
  symbol,
  market,
  fee_percent,
  min_fee,
  max_fee,
  status,
  notes,
  created_at
FROM fee_rules
WHERE group_id = '<group_id_from_step_1>'
ORDER BY
  (symbol IS NOT NULL)::int DESC,
  (market IS NOT NULL)::int DESC;
```

**Interpretation:** Resolution order for matching is **exact symbol** → **matching market** → **group-wide default** (`symbol` IS NULL AND `market` IS NULL). If this query returns no rows → **no fee rules configured for this group.**

---

## Step 3 — Orders that built this position

*(Substitute `user_id` and `symbol_id` from Step 1; position id in subqueries is fixed.)*

```sql
SELECT
  o.id AS order_id,
  o.user_id,
  o.symbol_id,
  o.side,
  o.type,
  o.size,
  o.price,
  o.average_price,
  o.status,
  o.created_at,
  o.filled_at
FROM orders o
WHERE o.user_id = '<user_id_from_step_1>'
  AND o.symbol_id = '<symbol_id_from_step_1>'
  AND o.status = 'filled'
  AND o.created_at <= COALESCE(
      (SELECT closed_at FROM positions WHERE id = '442fde7b-2e63-4ea1-83e6-4b91732fa9ae'),
      NOW()
    )
  AND o.created_at >= (SELECT opened_at FROM positions WHERE id = '442fde7b-2e63-4ea1-83e6-4b91732fa9ae') - INTERVAL '5 seconds'
ORDER BY o.created_at;
```

The **first** filled order at or after `opened_at` (within the window) is the primary **opening** fill for fee linkage.

---

## Step 4 — Fee charge log for those orders

*(Substitute order id list from Step 3.)*

```sql
SELECT
  fcl.id,
  fcl.order_id,
  fcl.position_id,
  fcl.fee_rule_id,
  fcl.transaction_id,
  fcl.charged_at,
  fcl.notional_usd,
  fcl.fee_percent_applied,
  fcl.fee_amount_usd,
  fcl.refunded,
  fcl.refunded_at
FROM fee_charge_log fcl
WHERE fcl.order_id IN (<order_id_list_from_step_3>)
ORDER BY fcl.charged_at;
```

If empty → **no fee charge log entries for this position’s orders.**

---

## Step 5 — Related fee transactions

*(Substitute `user_id` and order ids; keep position id in `LIKE` for JSON references.)*

```sql
SELECT
  t.id,
  t.user_id,
  t.type,
  t.amount,
  t.net_amount,
  t.currency,
  t.status,
  t.reference,
  t.method_details,
  t.created_at
FROM transactions t
WHERE t.user_id = '<user_id_from_step_1>'
  AND t.type = 'fee'
  AND (
    t.id IN (SELECT transaction_id FROM fee_charge_log WHERE order_id IN (<order_ids_from_step_3>))
    OR t.method_details::text LIKE '%442fde7b-2e63-4ea1-83e6-4b91732fa9ae%'
    OR t.method_details::text LIKE '%<any_order_id>%'
  )
ORDER BY t.created_at;
```

Note whether `amount` / `net_amount` indicate a **debit** (placement) vs **credit** (refund).

---

## Step 6 — Wallet state (context)

*(Substitute `user_id` from Step 1.)*

```sql
SELECT
  user_id,
  wallet_type,
  currency,
  available_balance,
  locked_balance,
  bonus_balance,
  bonus_locked,
  updated_at
FROM wallets
WHERE user_id = '<user_id_from_step_1>'
  AND wallet_type = 'spot'
  AND currency = 'USD';
```

This reflects **current** wallet snapshot, not a historical replay of the opening event alone.

---

## Step 7 — Verdict checklist

When Step 1 returns a row, answer explicitly:

1. **`fees_enabled` for this user’s group:** Yes / No  
2. **Fee rule matching this position’s symbol:** Yes (rule id, `fee_percent`) / No  
3. **How many opening order(s) in the Step 3 window:** number  
4. **Per opening order:** order id; `fee_charge_log` exists/missing; `fee_amount_usd`; fee `transactions` row exists/missing; `refunded` true/false  
5. **Math:** expected fee from notional × bps, clamped by min/max — compare to `fee_amount_usd`  
6. **`positions.accumulated_fees_usd` vs sum of unrefunded `fee_charge_log` for linked orders:** Yes / No  

**For this run (Step 1 = 0 rows):** items 1–6 are **N/A**. Re-run after confirming the position UUID and that the terminal/order flow persists `positions` into this Postgres (`newpt` on `5434`).

---

## Backend reference (why fees may be absent even with rules)

`resolve_fee_rule` returns **no** rule when `user_groups.fees_enabled` is false, before evaluating `fee_rules`:

- `backend/auth-service/src/services/fee_engine.rs` — `fees_enabled` gate  
- `docs/phase-2-fee-charging.md` — placement fee behavior and `fee_charge_log`  

---

## Re-run command

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5434 -U postgres -d newpt -v ON_ERROR_STOP=1 -f your_script.sql
```

Replace the position UUID in Step 1 (and Step 3 subqueries) if diagnosing a different position.
