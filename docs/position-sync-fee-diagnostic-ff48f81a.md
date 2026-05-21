# Position sync + fee diagnostic — `ff48f81a-e124-41a4-ad6e-ddc7a20e11bd`

**Read-only diagnostic** (dev Postgres `127.0.0.1:5434/newpt`, dev Redis `127.0.0.1:6379`).

**Goals:**

1. Confirm **position sync fix** — row exists in **Postgres** `positions` (not Redis-only).
2. Confirm **fee charging** vs **group** `fees_enabled` and **`fee_rules`**.

**Position ID:** `ff48f81a-e124-41a4-ad6e-ddc7a20e11bd`

---

## Verdict (summary)

| Check | Result |
|--------|--------|
| Position in Postgres | **Yes** — 1 row |
| Position in Redis | **Yes** — `HGETALL pos:by_id:…` non-empty |
| Group `fees_enabled` | **No** (`f`) |
| `fee_charge_log` for opening order | **0 rows** — expected when fees disabled |
| `positions.accumulated_fees_usd` | **0** — consistent with no fee charge |

**Conclusion:** Sync fix is **working** for this position. Fees are **correctly not charged** because **G1** has **`fees_enabled = false`** (an active group-wide rule exists but is not applied until the toggle is on).

Related docs: `docs/fix-position-sync-evt-publish.md`, `docs/phase-2-fee-charging.md`, `docs/position-redis-postgres-sync-diagnostic-442fde7b.md`.

---

## Step 1 — Position in Postgres

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
  p.accumulated_fees_usd,
  p.accumulated_swap_usd
FROM positions p
JOIN users u ON u.id = p.user_id
LEFT JOIN user_groups g ON g.id = u.group_id
JOIN symbols s ON s.id = p.symbol_id
WHERE p.id = 'ff48f81a-e124-41a4-ad6e-ddc7a20e11bd';
```

**Raw output:**

```
             position_id              |               user_id                |         email          |               group_id               | group_name | fees_enabled | swap_enabled | symbol  | symbol_market | quote_currency | side |    size    |  entry_price   |   mark_price   | status |           opened_at           | accumulated_fees_usd | accumulated_swap_usd 
--------------------------------------+--------------------------------------+------------------------+--------------------------------------+------------+--------------+--------------+---------+---------------+----------------+------+------------+----------------+----------------+--------+-------------------------------+----------------------+----------------------
 ff48f81a-e124-41a4-ad6e-ddc7a20e11bd | 4acfaa5c-de52-40c6-b5c0-edbdf65b8426 | mabhattiltd5@gmail.com | 2b5d78a7-4b78-423a-b093-ee82def43121 | G1         | f            | f            | BTCUSDT | crypto        | USDT           | long | 0.14141700 | 77713.27000000 | 77713.27000000 | open   | 2026-05-21 19:56:06.689848+00 |           0.00000000 |           0.00000000
(1 row)
```

---

## Step 1b — Redis (optional cross-check)

```bash
redis-cli -h 127.0.0.1 -p 6379 HGETALL "pos:by_id:ff48f81a-e124-41a4-ad6e-ddc7a20e11bd"
```

**Raw output:**

```
user_id
4acfaa5c-de52-40c6-b5c0-edbdf65b8426
symbol
BTCUSDT
group_id
2b5d78a7-4b78-423a-b093-ee82def43121
side
LONG
size
0.141417
entry_price
77713.27
avg_price
77713.27
leverage
100
margin
109.8997750359
margin_from_cash
109.8997750359
margin_from_bonus
0
unrealized_pnl
0
realized_pnl
0
status
OPEN
opened_at
1779393365221
updated_at
1779393365221
sl
userdata: 0x0
tp
userdata: 0x0
```

---

## Step 2 — Fee rules for group `2b5d78a7-4b78-423a-b093-ee82def43121` (G1)

```sql
SELECT
  id, group_id, symbol, market, fee_percent, min_fee, max_fee, status, notes, created_at
FROM fee_rules
WHERE group_id = '2b5d78a7-4b78-423a-b093-ee82def43121'
ORDER BY (symbol IS NOT NULL)::int DESC, (market IS NOT NULL)::int DESC;
```

**Raw output:**

```
                  id                  |               group_id               | symbol | market | fee_percent |  min_fee   |   max_fee    | status | notes |          created_at           
--------------------------------------+--------------------------------------+--------+--------+-------------+------------+--------------+--------+-------+-------------------------------
 2fa06d18-149c-4586-b9ee-fbe262030f03 | 2b5d78a7-4b78-423a-b093-ee82def43121 |        |        |    0.000500 | 1.00000000 | 100.00000000 | active |       | 2026-05-21 19:18:24.524146+00
(1 row)
```

**Note:** With `fees_enabled = false`, `fee_engine::resolve_fee_rule` does not use this row. If fees were turned on, this **group-wide** rule (`symbol` / `market` NULL) would match BTCUSDT (resolution: exact symbol → market → default).

---

## Step 3 — Opening order (±5s around `opened_at`)

```sql
SELECT
  o.id AS order_id,
  o.user_id,
  o.symbol_id,
  o.side,
  o.type,
  o.size,
  o.average_price,
  o.status,
  o.created_at,
  o.filled_at
FROM orders o
WHERE o.user_id = '4acfaa5c-de52-40c6-b5c0-edbdf65b8426'
  AND o.symbol_id = (SELECT symbol_id FROM positions WHERE id = 'ff48f81a-e124-41a4-ad6e-ddc7a20e11bd')
  AND o.status = 'filled'
  AND o.created_at >= (SELECT opened_at FROM positions WHERE id = 'ff48f81a-e124-41a4-ad6e-ddc7a20e11bd') - INTERVAL '5 seconds'
  AND o.created_at <= (SELECT opened_at FROM positions WHERE id = 'ff48f81a-e124-41a4-ad6e-ddc7a20e11bd') + INTERVAL '5 seconds'
ORDER BY o.created_at;
```

**Raw output:**

```
               order_id               |               user_id                |              symbol_id               | side |  type  |    size    | average_price  | status |          created_at           |           filled_at           
--------------------------------------+--------------------------------------+--------------------------------------+------+--------+------------+----------------+--------+-------------------------------+-------------------------------
 03490968-acee-407a-baa7-85024e0a30c4 | 4acfaa5c-de52-40c6-b5c0-edbdf65b8426 | 344b6f89-e22f-4fb4-928d-15652cddbb9c | buy  | market | 0.14141700 | 77713.27000000 | filled | 2026-05-21 19:56:05.177026+00 | 2026-05-21 19:56:06.669207+00
(1 row)
```

---

## Step 4 — `fee_charge_log`

```sql
SELECT
  id, order_id, position_id, fee_rule_id, transaction_id,
  charged_at, notional_usd, fee_percent_applied, fee_amount_usd,
  refunded, refunded_at
FROM fee_charge_log
WHERE order_id IN ('03490968-acee-407a-baa7-85024e0a30c4');
```

**Raw output:**

```
 id | order_id | position_id | fee_rule_id | transaction_id | charged_at | notional_usd | fee_percent_applied | fee_amount_usd | refunded | refunded_at 
----+----------+-------------+-------------+----------------+------------+--------------+---------------------+----------------+----------+-------------
(0 rows)
```

---

## Step 5 — Fee `transactions`

```sql
SELECT
  id, user_id, type, amount, net_amount, currency, status, reference, method_details, created_at
FROM transactions
WHERE id IN (SELECT transaction_id FROM fee_charge_log WHERE order_id IN ('03490968-acee-407a-baa7-85024e0a30c4'))
   OR (
     user_id = '4acfaa5c-de52-40c6-b5c0-edbdf65b8426'
     AND type = 'fee'
     AND created_at >= (SELECT opened_at FROM positions WHERE id = 'ff48f81a-e124-41a4-ad6e-ddc7a20e11bd') - INTERVAL '5 seconds'
     AND created_at <= (SELECT opened_at FROM positions WHERE id = 'ff48f81a-e124-41a4-ad6e-ddc7a20e11bd') + INTERVAL '5 seconds'
   )
ORDER BY created_at;
```

**Raw output:**

```
 id | user_id | type | amount | net_amount | currency | status | reference | method_details | created_at 
----+---------+------+--------+------------+----------+--------+-----------+----------------+------------
(0 rows)
```

---

## Step 6 — `accumulated_fees_usd` vs log

From Step 1: **`accumulated_fees_usd = 0.00000000`**. There is **no** `fee_charge_log` row, so **no `fee_amount_usd`** to compare; values are **consistent** (no fee accumulated).

There is **no** `fee_charge_log.position_id` row to validate back-fill linkage for this order.

---

## Chat-style verdict block

```
## Sync fix verification

- Position in Postgres: ✅
- Position in Redis: yes
- Symbol: BTCUSDT
- Status: open

## Fee verification

- Group fees_enabled: no
- Matching fee rule: 2fa06d18-149c-4586-b9ee-fbe262030f03, fee_percent 0.000500 (not applied while fees_enabled is false)
- Opening order: 03490968-acee-407a-baa7-85024e0a30c4
- fee_charge_log row: missing
- fee_amount_usd: N/A
- transaction row: missing
- positions.accumulated_fees_usd: 0.00000000 (matches log? yes)

## Verdict

✅ Sync fix working AND fees correctly NOT charged (group has fees disabled OR no matching rule)
```

*(Here: fees disabled; a matching rule exists but is inactive until `fees_enabled` is true.)*

---

## Re-run

Use the same SQL with a new `position_id` / `order_id` after placing another trade. To test **fee charging**, set **`fees_enabled = true`** for group G1 in admin and repeat.
