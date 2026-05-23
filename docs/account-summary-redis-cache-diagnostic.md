# Account summary: Redis cache timing vs browser (read-only diagnostic)

**Question:** When an order is placed, when does Redis hold the updated account summary, and when does it reach the browser?

**Last production probe:** 2026-05-23 **07:42–07:44 UTC** (Redis, `auth` publish logs, `ws-gateway` subscription log, `docker compose ps`).

**Rules:** Read-only (no code/DB/Redis writes). Production access: `ssh root@ptf.interwarepvt.com` → `/opt/newpt` → `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec …`.

**Target user:** `cokykod@mailinator.com`, `user_id` = `3bc1c0fd-8862-4239-a892-ecb16c4f4de0`.

**Important (shell on remote host):** Bash reserves `UID` as read-only. Use `TID=` (or another name) for the UUID in one-liners, not `UID=`.

---

## Step 1 — Account summary data flow (from code)

### 1.1 Where it is calculated — `compute_account_summary_inner`

**Signature and role:** Computes one `AccountSummary` for a user from Postgres + Redis (FX snapshot, position aggregates, wallet, transactions).

```2038:2043:backend/auth-service/src/routes/deposits.rs
pub(crate) async fn compute_account_summary_inner(
    pool: &PgPool,
    redis: Option<&crate::redis_pool::RedisPool>,
    user_id: Uuid,
    price_overrides: Option<&PriceOverrides>,
) -> anyhow::Result<AccountSummary> {
```

**Inputs (representative):**

- **Postgres:** `margin_calculation_type` from `users`; `bonus_balance` and wallet `available`/`locked` from `wallets` (spot USD); `SUM` of completed `swap` / `fee` rows in `transactions`; closed PnL via `sum_closed_realized_pnl_usd`.
- **Redis (required):** USD FX snapshot via `fx_rates::get_cached_snapshot(redis_pool)` — returns `Err` if missing (`FxRatesUnavailable`).
- **Redis + optional DB fallback:** `fetch_position_aggregates_from_redis` (and DB fallback) for `margin_used`, `unrealized_pnl` using `price_overrides` when provided (tick path).

**Key SQL excerpts (wallet / bonus / fees / swaps):**

```2094:2142:backend/auth-service/src/routes/deposits.rs
    let bonus_balance: Decimal = sqlx::query_scalar(
        r#"SELECT COALESCE(bonus_balance, 0) FROM wallets WHERE user_id = $1 AND wallet_type = 'spot'::wallet_type AND currency = 'USD'"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or(Decimal::ZERO);

    let wallet_cash: Option<(Decimal, Decimal)> = sqlx::query_as(
        r#"
        SELECT COALESCE(available_balance, 0), COALESCE(locked_balance, 0)
        FROM wallets
        WHERE user_id = $1 AND wallet_type = 'spot'::wallet_type AND currency = 'USD'
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    // ...
    let total_swap_paid_usd: Decimal = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(-amount), 0)
        FROM transactions
        WHERE user_id = $1
          AND type = 'swap'::transaction_type
          AND status = 'completed'::transaction_status
          AND currency = 'USD'
        "#,
    )
    // ...
    let total_fees_paid_usd: Decimal = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(-amount), 0)
        FROM transactions
        WHERE user_id = $1
          AND type = 'fee'::transaction_type
          AND status = 'completed'::transaction_status
          AND currency = 'USD'
        "#,
    )
```

**Return:** `AccountSummary` struct (serialized with `#[serde(rename_all = "camelCase")]`), including `updated_at: Utc::now().to_rfc3339()`:

```2157:2174:backend/auth-service/src/routes/deposits.rs
    Ok(AccountSummary {
        user_id: user_id.to_string(),
        balance: to_f64(balance),
        equity: to_f64(equity),
        margin_used: to_f64(margin_used),
        free_margin: to_f64(free_margin),
        margin_level,
        margin_call_level_threshold: None,
        stop_out_level_threshold: None,
        realized_pnl: to_f64(realized_pnl),
        unrealized_pnl: to_f64(unrealized_pnl),
        bonus: to_f64(bonus_balance),
        total_swap_paid_usd: to_f64(total_swap_paid_usd),
        total_fees_paid_usd: to_f64(total_fees_paid_usd),
        updated_at: Utc::now().to_rfc3339(),
    })
```

*(Threshold fields are filled later in `compute_and_cache_account_summary_with_prices` from group settings.)*

### 1.2 Where the result is cached — Redis hash key and fields

**Key:** `Keys::account_summary(user_id)` → `pos:summary:{user_id}` (`crates/redis-model/src/keys.rs` lines 41–42, 95–98).

**Write:** `hset_multiple` on that hash inside `compute_and_cache_account_summary_with_prices`:

```1959:1974:backend/auth-service/src/routes/deposits.rs
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

**Fields written (12 + meta):** `balance`, `equity`, `margin_used`, `free_margin`, `margin_level`, `margin_call_level_threshold`, `stop_out_level_threshold`, `liquidation_level`, `realized_pnl`, `unrealized_pnl`, `bonus`, `total_swap_paid_usd`, `total_fees_paid_usd`, `updated_at`.

**Also (same connection, not gated by publish throttle):** `SET user:{user_id}:balance` JSON for order-engine (`deposits.rs` ~1976–1998).

### 1.3 Where the result is published — Redis pub/sub + throttle

```2000:2013:backend/auth-service/src/routes/deposits.rs
                    let should_pub = COORDINATOR
                        .get()
                        .map(|c| c.should_publish(user_id))
                        .unwrap_or(true);
                    if should_pub {
                        if let Ok(count) = conn.publish::<_, _, i32>("account:summary:updated", &json).await {
                            info!("✅ Published account summary to Redis ({} subscribers) for user_id={}", count, user_id);
                            if let Some(c) = COORDINATOR.get() {
                                c.record_publish(user_id);
                            }
                        } else {
                            error!("❌ Failed to publish account summary to Redis for user_id={}", user_id);
                        }
                    }
```

Throttle: `PUBLISH_THROTTLE_MS: u64 = 250` (`deposits.rs` ~298, `should_publish` ~322–327). If `should_pub` is false, **hash and `user:balance` are still updated**; only the **pub/sub message** is skipped until the next allowed publish.

### 1.4 Where the browser receives it — gateway path

| Stage | Component | Evidence |
|--------|-----------|----------|
| Publish | `auth-service` | `PUBLISH account:summary:updated` with full summary JSON (see 1.3). |
| Subscribe | **`ws-gateway` only in production** | `deploy/docker-compose.prod.yml` defines `ws-gateway` (no `gateway-ws`). `docker compose … ps` on 2026-05-23 showed **`deploy-ws-gateway-1`** Up; **`gateway-ws` → “no such service”**. |
| Redis → process | `ws-gateway` | `backend/ws-gateway/src/main.rs` includes `"account:summary:updated"` in the Redis subscriber channel list (~line 98). `broadcaster.rs` matches channel and calls `broadcast_account_summary`. |
| Process → WS | `ws-gateway` | `try_dispatch_conn` sends `ServerMessage::AccountSummaryUpdated { payload }` — JSON uses serde variant rename `account.summary.updated` (`protocol.rs` ~121–123). |
| Browser | Frontend | `wsClient` opens WebSocket to configured gateway URL; `onmessage` parses JSON and dispatches to subscribers (`src/shared/ws/wsClient.ts` ~50–55). |

**`apps/gateway-ws`:** Still present in repo and subscribes to `account:summary:updated` (`apps/gateway-ws/src/main.rs` ~717+), but **is not part of this production compose** — no mismatch with a second gateway **unless** another stack runs it elsewhere.

### 1.5 Where the browser applies it — React Query

```32:92:src/features/wallet/hooks/useAccountSummary.ts
    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      if (event.type === 'account.summary.updated') {
        const raw = (event as { type: 'account.summary.updated'; payload: Record<string, unknown> }).payload
        // ... map fields ...
        queryClient.setQueryData<AccountSummaryResponse>(QUERY_KEY, payload)
      }
    })
```

### 1.6 Single-paragraph end-to-end flow + hidden async

User submits order → **HTTP** `POST` (e.g. trading API placing order) → `place_order` in `backend/auth-service/src/routes/orders.rs` runs DB transaction (margin lock, order row, optional fee) → **`tx.commit().await`** → **`compute_and_cache_account_summary(...).await`** (synchronous on the success path) → `compute_and_cache_account_summary_with_prices` runs under optional per-user `AccountSummaryCoordinator::run_exclusive` → **`hset_multiple`** on **`pos:summary:{user_id}`** and **`SET user:{id}:balance`** → conditional **`PUBLISH account:summary:updated`** (250ms throttle) → **`ws-gateway`** Redis subscriber receives message → **`broadcast_account_summary`** → WebSocket **`type: "account.summary.updated"`** → **`useAccountSummary`** **`setQueryData`** → UI reads shared query cache.

**Hidden async (does not replace post-commit await on happy path):** On **free-margin cache miss** only, `orders.rs` **`tokio::spawn`** warms summary in background (~745–747). **`price_tick_summary_handler`** also calls `compute_and_cache_account_summary_with_prices` on `price:ticks` (separate path). **`AccountSummaryCoordinator::run_exclusive`** can queue work per user but does not remove the **`await`** on `place_order`’s post-commit recompute.

---

## Step 2 — Redis **before** an order (production snapshot)

**Measurement session:** 2026-05-23 **07:43–07:44 UTC** (`ssh root@ptf.interwarepvt.com`, `/opt/newpt`, compose file + env as in Appendix). *This is a point-in-time baseline, not yet tied to a deliberate “before click” from Step 3.*

### `HGETALL pos:summary:3bc1c0fd-8862-4239-a892-ecb16c4f4de0` (queried **2026-05-23T07:43:32Z**)

```text
balance
9775.8536456
equity
9525.8109456
margin_used
3851.714815
free_margin
5674.0961306
margin_level
247.31
margin_call_level_threshold
95
stop_out_level_threshold
1
liquidation_level
0
realized_pnl
0
unrealized_pnl
-250.0427
bonus
0
total_swap_paid_usd
0
total_fees_paid_usd
0
updated_at
2026-05-23T07:43:30.231932989+00:00
```

### `GET user:3bc1c0fd-8862-4239-a892-ecb16c4f4de0:balance` (same session)

```text
{"available":"5674.0961306","currency":"USD","equity":"9525.8109456","free_margin":"5674.0961306","locked":"0","margin_used":"3851.714815","updated_at":1779522210232}
```

### `SMEMBERS pos:3bc1c0fd-8862-4239-a892-ecb16c4f4de0`

```text
83091632-18de-4932-ae47-77c67931b953
5b65c9a3-2992-476b-8bfb-14733c55bf02
e1684bc8-5552-4d24-bea4-e8e1bf154deb
0bff07da-950f-4ed5-8556-cb8bceacd390
e911ff0a-4c42-4498-86e2-826b97fe6cc7
bc26da19-ad12-449f-b589-c3c86d35cb66
43dfd7d0-11bb-4b3d-88de-9956cad6a07c
2a6867b4-1acc-4f40-acdf-c7ddb60681be
59ad008b-2d05-43ee-bf0b-891c79226cba
7a2f6861-a2a5-4144-bd36-b2f700270f23
```

*(10 open position IDs.)*

### `PUBSUB NUMSUB account:summary:updated`

```text
account:summary:updated
1
```

**Interpretation:** Hash and `user:…:balance` agree on equity / free margin / margin_used. **`updated_at` on the hash is `2026-05-23T07:43:30.231932989+00:00`**, i.e. **within ~2s** of the `HGETALL` wall time — cache is live. **Exactly one** subscriber on `account:summary:updated` (expected: `ws-gateway`).

### Second snapshot (no order — shows tick-driven refresh cadence)

`HGETALL` again at **2026-05-23T07:44:02Z**:

```text
balance
9775.8536456
equity
9534.8379456
margin_used
3851.714815
free_margin
5683.1231306
margin_level
247.54
margin_call_level_threshold
95
stop_out_level_threshold
1
liquidation_level
0
realized_pnl
0
unrealized_pnl
-241.0157
bonus
0
total_swap_paid_usd
0
total_fees_paid_usd
0
updated_at
2026-05-23T07:43:58.591068143+00:00
```

**Note:** `updated_at` advanced **~28s** after the first snapshot’s embedded time — under live ticks, **Redis is not frozen for multi-second gaps** for this user; this does **not** replace an **order-correlated** Step 3–5 run.

### Auxiliary: auth-service log ↔ Redis `updated_at` (tick path, **not** an order)

From `docker compose … logs auth --since 30m | grep Published` (excerpt), **target user**:

```text
auth-1  | 2026-05-23T07:43:30.232408Z  INFO auth_service::routes::deposits: ✅ Published account summary to Redis (1 subscribers) for user_id=3bc1c0fd-8862-4239-a892-ecb16c4f4de0
```

Compare to hash **`updated_at`** in the **07:43:32Z** `HGETALL`: **`2026-05-23T07:43:30.231932989+00:00`**. The log timestamp and hash `updated_at` are **the same millisecond bucket** (~**0.0005s** skew), consistent with “**publish and `hset_multiple` complete together**” for that refresh. **This still does not prove order-path timing** (use Step 3 `SUBSCRIBE` + T0–T1 for that).

---

## Step 3 — `SUBSCRIBE` during an order (operator — **not run with a live order in this session**)

**Procedure (repeat ≥2 orders):**

1. SSH host; `cd /opt/newpt`.
2. Terminal A:

   ```bash
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec -T redis \
     redis-cli SUBSCRIBE account:summary:updated
   ```

3. Operator records **T0** (click Buy / submit), **T1** (POST completes in browser Network), **T3** (equity/margin visibly changes).
4. Terminal A shows each **`message`** line — first after order = **T2** (Redis received publish); copy **payload** (redact if needed).

**Captured in this doc:** _[Pending: paste subscriber lines with wall-clock or log timestamps for run 1 and run 2]_

**How to read:** If **T2 − T0** is sub-second, backend publish is fast; if **T3 − T2** is large, suspect gateway/browser. If **T2 − T0** is multi-second, suspect `compute_and_cache` / DB / lock / skipped publish + slow follow-up.

---

## Step 4 — Redis **within ~1s of POST complete** (operator)

Same `HGETALL` as Step 2. Compare `updated_at`, `margin_used`, `free_margin`, `equity` to Step 2 / Step 3 payload.

**Captured:** _[Pending]_

**If hash is already new but UI is old:** lag is **Redis → browser** (or React), not compute.

**If hash is still old:** lag is **compute/cache path** (or order path not calling compute yet).

---

## Step 5 — Redis **~5s after** the order (operator)

Same `HGETALL` again at **T0 + 5s**.

**Captured:** _[Pending]_

**Cross-check:** If Step 4 already matched new economics and Step 5 unchanged, but UI only moved at ~5s, reinforces **downstream** lag.

---

## Step 6 — Gateway logs

**`gateway-ws`:** `docker compose … logs gateway-ws` → **`no such service: gateway-ws`** (compose has **`ws-gateway` only**).

**`ws-gateway`:** Grep `account.summary|broadcast_account_summary` in `--tail 200` still yields **no per-forward INFO lines** in this build. Broader grep (`--since 45m`, case-insensitive `account|summary`) **does** show Redis subscription at startup:

```text
ws-gateway-1  | 2026-05-23T07:42:13.028022Z  INFO ws_gateway::stream::redis_subscriber: Subscribed to Redis channel: account:summary:updated
```

So **`ws-gateway` is subscribed** to the same channel auth publishes to. **Per-message forward logs** are not present in default INFO output here — use browser WS frames (Step 3 companion) or raise log level in ops to correlate **T2 → gateway → browser**.

**Operator follow-up (around a known order):**

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production logs ws-gateway --since 2m 2>&1 | grep -iE "account|summary|broadcast"
```

---

## Step 7 — Multiple publishes (operator + **cluster-wide** sample from auth logs)

**Order-specific (required):** While `SUBSCRIBE` is running, count messages **for one user** per single order; note spacing (ms vs seconds). _[Pending — paste subscriber transcript]_

**Cluster-wide sample (auth `docker compose … logs auth --since 30m`, excerpt `2026-05-23T07:43:29–07:43:30Z`):** Many lines of form `✅ Published account summary to Redis (1 subscribers) for user_id=…` appear **milliseconds apart** for **different** `user_id`s (price-tick batch). Example lines include repeats for the same user within **~400–500ms** (e.g. `280840e3-…` at `07:43:29.123347Z` and `07:43:29.646621Z`), consistent with **250ms throttle** allowing another publish on the next tick pass — **not** a forced 5s spacing at the publisher.

**Throttle note:** Skipped publish does **not** advance `record_publish`; the **next** successful publish may be the next tick-driven or order-driven compute. Diagnose “only one message at +5s” vs “burst at +200ms” using **Step 3** on a real order.

---

## Step 8 — `gateway-ws` vs `ws-gateway` (production)

**`docker compose … ps` (2026-05-23 ~07:44Z UTC, raw):**

```text
NAME                     SERVICE         STATUS
deploy-auth-1            auth            Up 9 hours
deploy-core-api-1        core-api        Up 9 hours
deploy-data-provider-1   data-provider   Up About a minute
deploy-frontend-1        frontend        Up 9 hours
deploy-nats-1            nats            Up 2 days
deploy-order-engine-1    order-engine    Up 9 hours
deploy-postgres-1        postgres        Up 2 days (healthy)
deploy-redis-1           redis           Up 2 days (healthy)
deploy-ws-gateway-1      ws-gateway      Up About a minute (healthy)
```

**No `gateway-ws` container.** Active WebSocket path for account summary is **`backend/ws-gateway`** (`/app/ws-gateway`), with **`broadcast_account_summary`** in `broadcaster.rs` as quoted in Step 1.

**Verdict D (two gateways):** **Not supported** for this compose snapshot.

---

## Step 9 — Verdict (A–E)

| Verdict | Meaning |
|---------|---------|
| **A** | Backend publish fast; UI slow |
| **B** | Redis publish / compute slow |
| **C** | Gateway delivers late |
| **D** | Two gateways conflict |
| **E** | Throttle hides first publish; later one wins |

### Verdict with **order-correlated** timestamps

**Not yet determined.** Steps **3–5** require a **live order** with **T0 / T1 / T2 (from `SUBSCRIBE`) / T3** and two **`HGETALL`** windows tied to **T1** — those values are still **`[Pending]`** in this document.

### What **is** proven without an order (supporting context only)

1. **Step 8 + Step 6:** Only **`ws-gateway`** runs; it **subscribes** to `account:summary:updated` at startup (`2026-05-23T07:42:13.028022Z` log line). **`gateway-ws` is not deployed** here → **not D**.
2. **Step 2 + auxiliary log:** For user **`3bc1c0fd-8862-4239-a892-ecb16c4f4de0`**, an auth **`✅ Published account summary…`** at **`2026-05-23T07:43:30.232408Z`** aligns with Redis hash **`updated_at` = `2026-05-23T07:43:30.231932989+00:00`** — i.e. when a publish runs for this user, **Redis reflects it immediately** on this path (**tick-driven** refresh, not an order). That **does not** prove **`place_order`** latency; **B vs A** for the **4–5s order** bug still needs **Step 3**.
3. **Step 7 sample:** Publishes for the fleet arrive in **rapid succession** (ms–sub‑second), inconsistent with a **global 5s publisher timer**; **E** (throttle hiding the *first* publish on order) remains **possible only** if Step 3 shows a **late first message** for that order.

**After operator fills Steps 3–5:**

- **T2 − T0 < 1s** and **T3 − T2 ~ 4–5s** → **A** (or rare **C** if gateway queues — correlate with logs).
- **T2 − T0 ~ 4–5s** → **B** (profile `compute_account_summary_inner` / DB / Redis FX / `run_exclusive` wait).
- **T2 early, log shows forward late** → **C**.
- **Two gateway containers** → **D** (not seen here).
- **One publish only at +5s after burst of computes** → consider **E** + product decision (force publish on order path).

---

## Recommended fix direction (after measurement)

1. **If A:** Trace `wsClient` delivery and `setQueryData`; confirm `event.type === 'account.summary.updated'` and `userId` match auth user string.
2. **If B:** Profile `place_order` + `compute_and_cache_account_summary` on production trace; check FX snapshot and DB slow queries.
3. **If C:** `ws-gateway` channel backpressure, connection registry, or missing user connection.
4. **If E:** Consider publishing on “critical” paths regardless of throttle, or debounced flush.

---

## Appendix — Commands used (copy-paste)

```bash
ssh root@ptf.interwarepvt.com
cd /opt/newpt
TID=3bc1c0fd-8862-4239-a892-ecb16c4f4de0

docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec -T redis \
  redis-cli HGETALL "pos:summary:${TID}"

docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec -T redis \
  redis-cli GET "user:${TID}:balance"

docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec -T redis \
  redis-cli SMEMBERS "pos:${TID}"

docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec -T redis \
  redis-cli PUBSUB NUMSUB account:summary:updated
```

Redis key definition:

```38:43:crates/redis-model/src/keys.rs
    /// Account summary for a user (Balance, Equity, Margin, PnL, etc.).
    /// Stored under position namespace so position cache is centralized: pos:* holds
    /// position list, per-position hashes, and this summary (derived from positions + DB).
    pub fn position_summary(user_id: Uuid) -> String {
        format!("pos:summary:{}", user_id)
    }
```
