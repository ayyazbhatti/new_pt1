# Cache and real-time architecture diagnostic (read-only)

**Scope:** Evidence from repository inspection only (no runtime DB/Redis inspection).  
**Date:** 2026-05-22.

---

## Step 1 — Inventory: what is cached, where

### Redis keys and channels (representative; not exhaustive)

| Data | Redis key / channel | Writers (service, evidence) | Readers (service, evidence) | TTL / invalidation |
|------|---------------------|------------------------------|------------------------------|---------------------|
| Latest price JSON per symbol+group | `prices:{SYMBOL}:{GROUP}` string (empty group: `prices:{SYMBOL}:`) | **order-engine** `TickHandler::process_tick` — `conn.set(&price_key, price_json)` (`apps/order-engine/src/engine/tick_handler.rs` ~154–165) | **auth-service** `get_price_from_redis` / account summary (`backend/auth-service/src/routes/deposits.rs` ~751–718); **order-engine** `position_handler` (~151–160) | Overwrite each tick; no TTL in code shown |
| Tick fan-out to browsers | **`price:ticks`** pub/sub channel | **data-provider** `apps/data-provider/src/main.rs` ~247–269 (`conn.publish("price:ticks", &json)`); **backend/data-provider** `publish_price_update("price:ticks", ...)` (`backend/data-provider/src/main.rs` ~555) | **ws-gateway** `broadcaster.rs` ~109–111; **gateway-ws** `main.rs` ~613–614; **auth-service** `PriceTickSummaryHandler` ~68–69 | Event stream; no TTL |
| Open position IDs per user | **`pos:{user_id}`** set (`Keys::positions_set`) | **order-engine** (Lua / fill paths — see grep `pos:` in `order_handler.rs`, `position_events.rs`) | **auth-service** `get_user_positions` SMEMBERS (`deposits.rs` ~3743–3747); **auth-service** `open_position_counts_from_redis` (`auth.rs` ~1674–1678) | No TTL; membership updated on open/close |
| Position hash | **`pos:by_id:{position_id}`** | **order-engine** on fill / events | **auth-service** `get_user_positions` HGETALL (`deposits.rs` ~3775–3780); **price_tick_summary_handler` HGET (`price_tick_summary_handler.rs` ~138–148) | No TTL; fields overwritten on updates |
| Open positions by symbol (ZSET) | **`pos:open:{symbol}`** | **order-engine** (Lua scripts referenced in `keys.rs` ~33–35) | **auth-service** `PriceTickSummaryHandler` ZRANGE (`price_tick_summary_handler.rs` ~117–119) | No TTL |
| Pending orders per symbol | **`orders:pending:{symbol}`** ZSET; **`order:{order_id}`** string | **order-engine** `order_handler.rs` ~322–332 (SET, ZADD) | **order-engine** `warm_cache.rs` KEYS/ZRANGE/GET (~21–45); **validation** GET `user:{}:balance` separate | `order:idempotency:*` SETEX 86400s (`orders.rs` ~896) |
| Account summary snapshot | **`pos:summary:{user_id}`** hash (alias `Keys::account_summary`) | **auth-service** `compute_and_cache_account_summary_with_prices` HSET multiple fields (`deposits.rs` ~1959–1974) | **auth-service** `get_account_summary` tries HGET first (`deposits.rs` ~2235–2305) | Overwritten each successful compute; no TTL |
| Account summary push | **`account:summary:updated`** pub/sub | **auth-service** `conn.publish("account:summary:updated", &json)` (`deposits.rs` ~1980–1981) | **gateway-ws** `forward_account_summary_from_redis` subscribes same channel (`apps/gateway-ws/src/main.rs` ~727–731); **ws-gateway** `broadcaster.rs` ~134–135 | Event |
| FX snapshot | **`fx:rates:usd`** string (JSON) | **auth-service** `fx_rates::write_snapshot` SET (`fx_rates.rs` ~196–197) | **auth-service** `get_cached_snapshot` GET (`fx_rates.rs` ~177–179); used in `compute_account_summary_inner` (`deposits.rs` ~2033–2037) | Refreshed when `fetch_and_cache` runs (not fully traced here) |
| Order book / user balance JSON for engine | **`user:{user_id}:balance`** string | **auth-service** `place_order` after commit (`orders.rs` ~972–982) | **order-engine** `validation.rs` GET (~82–86) | Overwritten on `place_order`; no TTL shown |
| Wallet push | **`wallet:balance:updated`** pub/sub | **auth-service** `publish_wallet_balance_updated` (`deposits.rs` ~2177–2179) | **ws-gateway** `broadcaster.rs` ~131–132 | Event |
| Order list updates | **`orders:updates`** pub/sub | **auth-service** `place_order` PUBLISH (`orders.rs` ~1031–1034) | **ws-gateway** `broadcaster.rs` ~113–114 | Event |
| Position list updates | **`positions:updates`** pub/sub | **order-engine** e.g. `publish_open_position_to_redis_ws_tick` (`tick_handler.rs` ~45–48) | **ws-gateway** `broadcaster.rs` ~116–117 | Event |
| Idempotency | **`order:idempotency:{key}`** | **auth-service** `place_order` SETEX 86400 (`orders.rs` ~896) | **auth-service** same handler GET (~707–711) | 24h |
| Leverage profiles cache (keys exist) | `levprof:*`, `psprof:*`, `group:{id}` | **Unclear without wider grep** — keys defined in `crates/redis-model/src/keys.rs` ~60–108 | Various services — **needs follow-up** for full write/read map | **Unclear** |

### In-memory (process-local)

| Data | Storage | Owner | Notes |
|------|---------|-------|-------|
| Pending orders + order objects + last ticks + enabled symbols | `OrderCache` (`DashMap`, `RwLock<DashMap>`) | **order-engine** `apps/order-engine/src/engine/cache.rs` ~24–35, 83–87 | Comment: “Redis is source of truth, this is for fast lookup” (~24–25); warmed from Redis on startup (`warm_cache.rs`) |
| Account summary compute serialization + publish throttle | `AccountSummaryCoordinator` (`DashMap`, `OnceLock`) | **auth-service** `deposits.rs` ~293–335, `PUBLISH_THROTTLE_MS = 250` (~298), `should_publish` (~322–327) | Coordinates compute; throttles **Redis publish** of `account:summary:updated` |
| Per-user tick summary throttle | `Mutex<HashMap<Uuid, Instant>>` | **auth-service** `price_tick_summary_handler.rs` ~20, 32–44, `THROTTLE_MS: u64 = 100` (~15) | Skips `compute_and_cache_account_summary_with_prices` if same user tick within 100ms |
| WS connection → sender map | `DashMap<Uuid, mpsc::Sender<ServerMessage>>` | **ws-gateway** `broadcaster.rs` ~52–53 | Necessary connection state |
| React Query `['accountSummary']` | Browser memory | **frontend** `useAccountSummary.ts` ~20–26, 91 | Updated by initial fetch and by WS handler `setQueryData` (~91) |

### Frontend (React Query)

| Data | Query key / pattern | Evidence |
|------|---------------------|----------|
| Account summary | `['accountSummary']`, `fetchAccountSummary`, **no `refetchInterval`** | `src/features/wallet/hooks/useAccountSummary.ts` ~20–26; WS branch ~28–95 |

**Note:** A prior note claiming `refetchInterval: 5000` for this hook is **not supported** by the current file contents (grep `refetchInterval` under `src/features/wallet` returned no matches).

---

## Step 2 — Source-of-truth matrix

### Balance / equity (server-side computation)

- **Wallet cash (authoritative for `balance` in summary):** Postgres `wallets.available_balance` + `locked_balance` for USD spot wallet.

```2077:2089:backend/auth-service/src/routes/deposits.rs
    let wallet_cash: Option<(Decimal, Decimal)> = sqlx::query_as(
        r#"
        SELECT COALESCE(available_balance, 0), COALESCE(locked_balance, 0)
        FROM wallets
        WHERE user_id = $1 AND wallet_type = 'spot'::wallet_type AND currency = 'USD'
        "#,
    )
    ...
    let (available_balance, locked_balance) = wallet_cash.unwrap_or((Decimal::ZERO, Decimal::ZERO));
    let balance = available_balance + locked_balance;
```

- **Position-derived margin / unrealized:** Prefer **Redis** aggregates (`fetch_position_aggregates_from_redis`); fallback **Postgres** if Redis path returns `None` (`deposits.rs` ~2039–2064).

- **Redis `pos:summary:{user}`:** **Derived cache** of the same computation, written after `compute_account_summary_inner` succeeds (`deposits.rs` ~1942–1974).

- **Redis `user:{user_id}:balance`:** JSON snapshot written in **`place_order`** for **order-engine** consumption (`orders.rs` ~972–982). This is **not** the same schema as `wallets` row; it encodes `free_margin` / `equity` / `margin_used` from **`pos:summary`** fields when present (`orders.rs` ~965–978). **Derived cache for a different consumer.**

### Positions (list in terminal)

- **GET `/v1/users/:id/positions`:** Reads **`pos:{user_id}`** + **`pos:by_id:{id}`** from Redis, then merges DB fields for accumulated costs (`merge_accumulated_costs_from_db`, `deposits.rs` ~3743–3789).

**Rule:** For “open positions” UI list, **Redis position hashes are primary**; Postgres augments cost fields. **Postgres `positions` table** is updated asynchronously via **`position_event_handler`** (`position_event_handler.rs` ~58–77) after NATS `evt.position.updated` — so **Redis can lead Postgres** briefly after an event.

### Orders (list)

- **`list_orders`:** Reads **`orders`** table in Postgres only (`orders.rs` ~1216–1237, 1263–1286).

**Rule:** **Postgres `orders`** is source of truth for listed orders; **Redis `order:{id}`** is engine/runtime state (warm cache / pending set).

### FX rates

- **Account summary** requires **`get_cached_snapshot`** from Redis key **`fx:rates:usd`** (`deposits.rs` ~2033–2037; `fx_rates.rs` ~15, 172–179).

**Rule:** **Redis `fx:rates:usd`** is the operational snapshot for summary; upstream APIs populate it (`fetch_and_cache` in `fx_rates.rs` ~202+).

### User / group / leverage

- **Account summary thresholds:** From group + Redis `group:{id}` or DB fallbacks inside `compute_and_cache_account_summary_with_prices` (~1928–1933) — partial trace only; **full matrix needs follow-up** if strict audit required.

---

## Step 3 — Redis as central cache; violations / drift risk

### Auth-service

- **`AccountSummaryCoordinator` + `PriceTickSummaryHandler` throttles** are **in-memory coordination**, not duplicate financial truth; they gate **how often** recomputation / publish runs (`deposits.rs` ~291–327; `price_tick_summary_handler.rs` ~15–44).

- **`price_tick_summary_handler` comment** explicitly states intent: subscribe to **`price:ticks`** and recompute summary “**No polling**” (`price_tick_summary_handler.rs` ~1–2).

### Order-engine

- **`OrderCache`:** Holds orders/ticks mirrored from Redis — **classified: Necessary** for hot path; comment states Redis is SOOT (`cache.rs` ~24–25).

### ws-gateway

- **`DashMap` connection senders:** **Necessary** (`broadcaster.rs` ~52–53).

### core-api

- **AppState** holds `PgPool` + `redis::Client` + NATS — no `OnceCell`/`Lazy` global caches found in `apps/core-api/src` via targeted grep.
- **Parallel `POST /v1/orders`** implementation exists (`apps/core-api/src/main.rs` ~70; `handlers.rs` ~52+) — **drift risk at product level** if both **auth-service** and **core-api** are exposed to clients with different business logic (auth path includes margin lock + `compute_and_cache_account_summary` etc.; core-api handler is slimmer — compare `handlers.rs` ~87–91 “TODO” symbol validation).

---

## Step 4 — Order placement → equity update (end-to-end)

### 1) Frontend POST

```161:165:src/features/terminal/api/orders.api.ts
export async function placeOrder(payload: PlaceOrderRequest): Promise<PlaceOrderResponse> {
  return http<PlaceOrderResponse>('/v1/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
```

### 2) Auth-service `place_order` (margin + transaction + response ordering)

- **Margin lock + order INSERT** occur inside **one SQL transaction** (`orders.rs` ~800–847), then **`tx.commit()`** (~882–885).

- **After commit:** `compute_and_cache_account_summary(&pool, redis, user_id).await` **before** HTTP success path continues to NATS publish (~887).

```882:887:backend/auth-service/src/routes/orders.rs
    tx.commit().await.map_err(|e| { ... })?;

    compute_and_cache_account_summary(&pool, orders_state.redis.as_ref(), user_id).await;
```

- **Redis `user:{user_id}:balance`** JSON is written **after** summary sync read from `pos:summary` hash (~963–984), then NATS `cmd.order.place` (~987–1005), then Redis **`orders:updates`** (~1008–1035).

**HTTP 200:** Returned after NATS + Redis publish logging (“place_order SUCCESS” ~1038–1045) — so client receives 200 **after** DB commit, **after** account summary recompute, and **after** balance JSON sync to Redis for the engine.

### 3) Account summary refresh to browser

- **Not via React Query polling:** `useAccountSummary` has **no** `refetchInterval`; it applies **`account.summary.updated`** over WS to `queryClient.setQueryData` (`useAccountSummary.ts` ~28–92).

- **Server path:** `compute_and_cache_account_summary_with_prices` publishes **`account:summary:updated`** (`deposits.rs` ~1980–1981). **gateway-ws** subscribes and forwards as JSON with `"type": "account.summary.updated"` (`apps/gateway-ws/src/main.rs` ~727–762).

- **Publish throttling:** If `AccountSummaryCoordinator` is initialized, **`should_publish`** may skip publish if last publish &lt; **250ms** (`deposits.rs` ~322–327, ~1975–1978).

### 4) User-visible timing (evidence-based)

- After **`place_order`**, summary is recomputed **synchronously** on the request thread (~887), so **Redis `pos:summary`** and (if not throttled) **`account:summary:updated`** fire before response.
- **Browser equity** updates when WS delivers `account.summary.updated` and `useAccountSummary` applies it — **not** on a 5s poll (current hook source).

**Gap vs ideal “sub-200ms always”:** **250ms publish throttle** and **`user:…:balance` JSON** possibly out of sync with latest tick until next engine-facing read — **acceptable latency / secondary cache** class.

---

## Step 5 — Position open → account update

### Order engine fill path (representative)

- **`tick_handler`** publishes **`positions:updates`** when opening position from tick path (`tick_handler.rs` ~22–48).
- NATS **`EVENT_POSITION_OPENED`** / **`EVENT_ORDER_UPDATED`** also published in fill flow (grep in `tick_handler.rs` ~362–436 region; `order_handler.rs` ~487–599).

### Auth-service consumers

- **`position_event_handler`:** `sync_position_to_database` then **`compute_and_cache_account_summary`** (`position_event_handler.rs` ~58–77).

- **`order_event_handler`:** On terminal order statuses, spawns **`compute_and_cache_account_summary`** (`order_event_handler.rs` ~82–84, ~97–98, etc.).

### WebSocket

- **ws-gateway** maps **`positions:updates`** → `broadcast_position_update` (`broadcaster.rs` ~116–117).

### Frontend

- Positions list typically refetched on events in terminal codepaths (not exhaustively verified in this doc); **equity** path is **WS-driven** for summary as above.

---

## Step 6 — Price propagation → PnL / equity

1. **data-provider** publishes **`price:ticks`** (see Step 1).
2. **ws-gateway** forwards ticks to subscribed sessions (`broadcaster.rs` ~109–111).
3. **Frontend** price cells use **`useSymbolPrice`** / price stream (separate from this doc’s file reads).
4. **Account summary equity:** **Server recomputes** on **`price:ticks`** via **`PriceTickSummaryHandler`** → `compute_and_cache_account_summary_with_prices` with per-symbol bid/ask overrides (`price_tick_summary_handler.rs` ~180–191). **Per-user throttle 100ms** (~15, ~181–183). **WS publish** may be further **throttled to 250ms** (`deposits.rs` ~1975–1978).

**Client-side equity from ticks alone:** **`useAccountSummary` does not** recompute equity from tick payloads; it **merges server payload** from `account.summary.updated` (`useAccountSummary.ts` ~33–91). So **live equity tracks server pushes**, not a local pricing model.

---

## Step 7 — Gaps

### Confirmed strengths (near “cTrader-class” behaviors)

- **Wallet balance in summary** tied to **Postgres** (`deposits.rs` ~2077–2089).
- **Position metrics** prefer **Redis** to match terminal (`deposits.rs` ~2039–2041).
- **Tick-driven summary recompute** without HTTP polling (`price_tick_summary_handler.rs` ~1–2, ~180–191).
- **Frontend summary** updated via **WS + React Query `setQueryData`**, not `refetchInterval` (`useAccountSummary.ts` ~28–92).

### Acceptable gaps

- **WS account summary publish throttled** to **250ms** per user (`deposits.rs` ~298, ~322–327) + **100ms** tick handler throttle (`price_tick_summary_handler.rs` ~15, ~181–183) — **intentional** to reduce flicker; not second-scale staleness.

### Drift risk

- **Redis `pos:*` vs Postgres `positions`:** async sync via `position_event_handler`; if sync fails, **UI list (Redis)** and **reporting (DB)** can diverge until repaired.
- **`user:{id}:balance` JSON** vs **`pos:summary`** vs **Postgres wallets:** three representations; writers must stay consistent (`orders.rs` ~963–984 vs `deposits.rs` ~1959–1974 vs wallet SQL ~2077–2089). **Symptom:** rare margin reject or engine validation mismatch if sync wrong. **Fix direction:** single writer module + tests. **Effort:** days.
- **auth-service vs core-api** duplicate HTTP surfaces (`core-api` `main.rs` ~69–74). **Symptom:** different validation / missing wallet lock if client hits wrong API. **Fix direction:** one public order API or strict gateway routing. **Effort:** days.

### Critical (user-visible under failure modes)

- **If `account:summary:updated` is not delivered** (no WS session — gateway logs warn `no WS session`, `gateway-ws` `main.rs` ~784–789), UI relies on **next manual refetch** or navigation — **not** polling. **Symptom:** stale summary until refocus/refetch. **Fix direction:** refetch on reconnect + on `placeOrder` success callback. **Effort:** hours.

---

## Step 8 — Verdict

**Classification: B — Mostly there**

**Evidence summary**

- **Single financial SOOT for computed summary:** Postgres wallets + (preferred) Redis position state + Redis FX snapshot, implemented in **`compute_account_summary_inner`** (`deposits.rs` ~2013–2149).
- **Redis is central** for prices, position hashes, summary cache **`pos:summary:{user}`**, and pub/sub fan-out.
- **Equity/margin refresh** is pushed over **WebSocket** (`account:summary:updated` → `useAccountSummary`), not 5s polling — **current `useAccountSummary.ts` has no `refetchInterval`**.
- **Not class A** because: explicit **throttles** (100ms / 250ms), **multiple denormalized Redis artifacts** (`user:…:balance`, `pos:summary`), **Postgres↔Redis** position sync path, and **parallel core-api** surface create residual drift and latency tail risks.

---

## Appendix — grep commands used (partial)

Executed in workspace:

- `grep` for `redis::cmd|\.publish|pos:by_id|prices:|account:summary|fx:rates` across `backend/`, `apps/`.
- `grep` for `refetchInterval` in `src/features/wallet` (no matches).
- `grep` for `Lazy<|OnceCell|RwLock<HashMap` in `apps/core-api/src` (no matches).

---

## Appendix — ws-gateway vs gateway-ws

Both subscribe to Redis channels such as **`price:ticks`** and **`account:summary:updated`**:

- `backend/ws-gateway/src/stream/broadcaster.rs` ~109–135  
- `apps/gateway-ws/src/main.rs` ~717–762, ~613–614  

**Deployment which process is live** is environment-specific — not determined from code alone.
