# Position Redis vs Postgres sync diagnostic

**Position UUID:** `442fde7b-2e63-4ea1-83e6-4b91732fa9ae`  
**Question:** Why does this position exist in Redis but **not** in Postgres `positions` on local dev, even though the user traded on that environment?

**Scope:** Read-only investigation (no DB or Redis mutations).  
**Environment:** Postgres `127.0.0.1:5434/newpt`, Redis `127.0.0.1:6379` (from `infra/docker-compose.yml`).

---

## Summary verdict

| Check | Result |
|--------|--------|
| Position in Redis `pos:by_id:{id}`? | **Yes** — full hash present |
| Position in Postgres `positions`? | **No** — `WHERE id = …` returns no row; last-24h `positions` query returned **0 rows** |
| UUID typo? | **Unlikely** — exact key exists in Redis and in `SCAN pos:by_id:*` |
| User index set | **`SISMEMBER pos:{user_id} {position_id}` = 1** (use `pos:{user_id}`, not `pos:by_user:{user_id}`) |
| Root cause (evidence-based) | **Postgres sync relies on `evt.position.updated` → auth `PositionEventHandler`**. Order-engine logs in the captured window show **many `evt.order.updated` publishes and zero `evt.position.updated`**; auth logs show subscriber **startup only**, no handled payloads. Tick **recovery** path for `order_not_pending` + `FILLED` republishes **`evt.order.updated` only**, not position sync. |

---

## Step 1 — Redis port and connectivity

**Compose:** `infra/docker-compose.yml` maps Redis **`6379:6379`**.

```bash
redis-cli -h 127.0.0.1 -p 6379 PING
```

**Raw output:**

```
PONG
```

---

## Step 2 — Exact position in Redis

```bash
redis-cli -h 127.0.0.1 -p 6379 HGETALL "pos:by_id:442fde7b-2e63-4ea1-83e6-4b91732fa9ae"
```

**Raw output (non-empty):**

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
0.141638
entry_price
77592.49
avg_price
77592.49
leverage
100
margin
109.9004509862
margin_from_cash
109.9004509862
margin_from_bonus
0
unrealized_pnl
0
realized_pnl
0
status
OPEN
opened_at
1779391125920
updated_at
1779391125920
sl
userdata: 0x0
tp
userdata: 0x0
```

**`opened_at`:** `1779391125920` ms epoch = **2026-05-21 19:18:45.920 UTC**.

---

## Step 3 — User position index (correct key name)

The codebase uses **`pos:{user_id}`** (Redis set of position UUIDs), not `pos:by_user:{user_id}`.

```bash
redis-cli -h 127.0.0.1 -p 6379 SISMEMBER "pos:4acfaa5c-de52-40c6-b5c0-edbdf65b8426" "442fde7b-2e63-4ea1-83e6-4b91732fa9ae"
```

**Raw output:**

```
1
```

---

## Step 4 — Postgres recent positions; Redis key count

**Postgres** — positions opened in last 24 hours:

```sql
SELECT
  p.id,
  u.email,
  s.code AS symbol,
  p.side,
  p.size,
  p.status,
  p.opened_at
FROM positions p
JOIN users u ON u.id = p.user_id
JOIN symbols s ON s.id = p.symbol_id
WHERE p.opened_at > NOW() - INTERVAL '24 hours'
ORDER BY p.opened_at DESC
LIMIT 20;
```

**Raw output:**

```
 id | email | symbol | side | size | status | opened_at 
----+-------+--------+------+------+--------+-----------
(0 rows)
```

**Redis** — `redis-cli --scan --pattern 'pos:by_id:*' | wc -l` → **84** keys. Scan contains `pos:by_id:442fde7b-2e63-4ea1-83e6-4b91732fa9ae`.

---

## Step 5 — Why Redis-only (evidence chain)

### NATS CLI

`nats` was **not** on PATH in the diagnostic environment; `nats stream ls` was **not** run.

### Auth-service: subscription wiring

```476:494:backend/auth-service/src/lib.rs
    // Start position event listener to sync positions to database
    let nats_for_positions = nats_client.clone();
    let pool_for_positions = pool_for_events.clone();
    let redis_for_positions = redis_pool.clone();
    tokio::spawn(async move {
        use services::position_event_handler::PositionEventHandler;
        let position_handler = PositionEventHandler::new(pool_for_positions, redis_for_positions);
        match nats_for_positions.subscribe("evt.position.updated".to_string()).await {
            Ok(subscriber) => {
                info!("✅ Subscribed to evt.position.updated for database sync");
                if let Err(e) = position_handler.start_listener(subscriber).await {
                    error!("Position event listener error: {}", e);
                }
            }
            Err(e) => {
                error!("Failed to subscribe to evt.position.updated: {}", e);
            }
        }
    });
```

### Auth log signal (`/tmp/Auth Service.log`)

- **`grep position_event_handler`:** only the **startup** line (`📡 Starting position event listener…`), **no** subsequent “received / created / updated position” lines.
- **No** lines containing the position UUID.
- **No** `Failed to handle position update` / `Symbol … not found` / `Failed to insert position` matches in that pass.

**Interpretation:** The **`evt.position.updated` consumer did not show any handled events** in the sampled log (either messages never arrived, or they never got past deserialize / early return without the sampled log lines).

### Order-engine: same order window

Related filled order in Redis: **`order:3f2ac1d9-a62a-49aa-8f53-8a5309e0c070`** — `status: FILLED`, same `user_id`, `symbol: BTCUSDT`, `filled_at` / `updated_at` aligned with position `opened_at` ms.

`/tmp/Order Engine.log` lines containing that `order_id` (abbreviated):

1. `Using order_id from command: 3f2ac1d9-…`
2. `Added pending order …`
3. `ORDER_ACCEPTED` …
4. `🚀 Executing market order … immediately at price 77592.49`
5. **`WARN` — `Failed to execute immediate fill … Failed to execute atomic_fill_order Lua script`**

Yet Redis order JSON shows **`FILLED`** — **Rust reported failure while Redis shows a completed fill** (race or error classification worth investigating in code, outside this doc).

On a **later tick** for group `2b5d78a7-…` (G1), logs included:

- `Atomic fill result: {"error":"order_not_pending","status":"FILLED"}`
- `Published to JetStream: evt.order.updated`
- `Published to NATS (basic pub/sub): evt.order.updated`

That matches **`apps/order-engine/src/engine/tick_handler.rs`**: on `execute_fill` **error** containing `order_not_pending` / `FILLED`, the handler **re-publishes `evt.order.updated` from Redis** and does **not** run the success path that ends in **`publish_position_updated`** → **`evt.position.updated`**.

Relevant pattern (conceptual): success path calls `position_events::publish_position_updated`; the **`order_not_pending`** branch only republishes order state.

### Publish histogram (`/tmp/Order Engine.log`)

Subjects seen on `Published to NATS` / `Published to JetStream` lines:

| Subject | Approx. count |
|---------|---------------:|
| `evt.order.updated` | 256 |
| `event.position.closed` | 1 |
| `event.order.accepted` | 1 |
| `event.balance.updated` | 1 |
| **`evt.position.updated`** | **0** |

🚨 **Flag:** For this log artifact, **no logged publish of `evt.position.updated`**, while **`evt.order.updated` is frequent**. That is consistent with **Postgres `positions` staying empty** even when Redis has open positions.

---

## Step 6 — Where Postgres `positions` rows come from (reference)

`backend/auth-service/src/services/position_event_handler.rs` — `sync_position_to_database` performs **UPDATE** then **INSERT** / upsert on **`evt.position.updated`**. Example **INSERT** fragment:

```205:232:backend/auth-service/src/services/position_event_handler.rs
        sqlx::query(
            r#"
            INSERT INTO positions (
                id, user_id, symbol_id, side, size, entry_price, mark_price,
                leverage, margin_used, liquidation_price, pnl, pnl_percent,
                status, opened_at, updated_at, closed_at, margin_from_cash, margin_from_bonus
            )
            VALUES (
                $1, $2, $3, $4::position_side, $5, $6, $7,
                $8, $9, $10, $11, $12,
                $13::position_status, $14, $15, $16, $17, $18
            )
            ON CONFLICT (id) DO UPDATE SET
                size = $5,
                entry_price = $6,
                mark_price = $7,
                leverage = $8,
                margin_used = $9,
                liquidation_price = $10,
                pnl = $11,
                pnl_percent = $12,
                status = $13::position_status,
                updated_at = $15,
                closed_at = $16,
                margin_from_cash = EXCLUDED.margin_from_cash,
                margin_from_bonus = EXCLUDED.margin_from_bonus
            "#
        )
```

Order-engine publishes DB sync events from `apps/order-engine/src/engine/position_events.rs` (`publish_position_updated` → subject `evt.position.updated` per `apps/order-engine/src/subjects.rs`).

---

## Recommended next actions (engineering)

1. **Reproduce with a live NATS tap** — e.g. `nats sub evt.position.updated` while placing one market order; confirm whether **any** message appears.
2. **Align tick recovery with DB sync** — when Redis shows `FILLED` and `order_not_pending`, consider also calling **`publish_position_updated`** (or inserting from Redis) so Postgres catches up.
3. **Investigate immediate-fill WARN vs Redis `FILLED`** — ensure Lua result and Rust error handling cannot leave **Redis filled** without emitting **`evt.position.updated`** on the success path.
4. **Docs / ops** — Admin SQL that assumes `positions` as source of truth should treat **Redis `pos:by_id:*` as canonical for open state** when sync is known to lag.

---

## Related docs

- `docs/trading-costs-position-fee-diagnostic-442fde7b.md` — fee audit SQL for the same UUID (Postgres `positions` not found there as well).
- `docs/phase-2-fee-charging.md` — placement fees and `fee_charge_log` (still depend on orders/transactions; position row optional for some checks).

---

*Document generated from read-only diagnostic notes; re-run `redis-cli` / `psql` after any code or infra changes to refresh evidence.*
