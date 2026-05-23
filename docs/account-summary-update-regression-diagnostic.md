# Account summary update regression (~4–5s after order)

**Scope:** Read-only investigation (no code/DB/service changes).  
**Symptom:** Margin / free margin / equity feel like they update **4–5 seconds** after placing an order; target is **sub-second**.  
**Method:** Static code verification (Step 1–2, 3), operator-run browser steps (1C–1D, 4–5), verdict (6).

---

## Step 1 — Verify the ~5s pattern in code

### 1A — Frontend polling check (executed)

Commands (repo root):

```bash
grep -rn "refetchInterval" src/ --include="*.ts" --include="*.tsx"
grep -rn "setInterval.*5000\|setInterval(\s*[^,]*,\s*5000" src/ --include="*.ts" --include="*.tsx"
grep -rn "setInterval.*4000\|setInterval.*4500\|setInterval.*5500" src/ --include="*.ts" --include="*.tsx"
```

**Results (2026-05-23, workspace `/Users/mab/new_pt1`):**

| Pattern | Matches |
|--------|---------|
| `refetchInterval` | **One file:** `src/features/aiReports/components/ReportStreamingView.tsx:73` — the callback **always returns `false`** (no polling). |
| `setInterval(..., 5000)` | **One match:** `src/features/terminal/components/RightTradingPanel.tsx:999` — `setInterval(measurePing, 5000)` (WebSocket ping measurement), **not** account summary. |
| `setInterval` with 4000 / 4500 / 5500 | **No matches** for those literals in the second/third grep (exit code 1 for “no match” on the 4/4.5/5.5 grep). |

**Additional targeted search:** `refetchInterval` / `invalidateQueries` / `fetchAccountSummary` / `accountSummary` under `src/features/terminal` — **no** `refetchInterval` on account summary; **only** `LeftSidebar` invalidates `accountSummaryQueryKey` on `visibilitychange` (tab focus), not on a timer.

**Global React Query defaults** (`src/app/providers/QueryProvider.tsx`): `refetchOnWindowFocus: false`, `retry: 1` — **no** `refetchInterval`.

**Conclusion (code, Step 1A):** There is **no** `refetchInterval: 5000` (or any interval) on `['accountSummary']`. The classic “React Query polls every 5s” hypothesis is **not supported** by current `src/` for this query. **Browser Network still required** to prove absence of GET `/api/account/summary` after orders (Step 1C).

### 1B — `useAccountSummary` implementation (primary hook)

Full implementation (WebSocket-driven cache update; initial load via HTTP once per mount tree sharing the query):

```1:102:src/features/wallet/hooks/useAccountSummary.ts
import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/shared/store/auth.store'
import { wsClient } from '@/shared/ws/wsClient'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import { fetchAccountSummary, type AccountSummaryResponse } from '../api'

const QUERY_KEY = ['accountSummary'] as const

/**
 * Single shared source for account summary. Only one fetch runs for the whole app;
 * LeftSidebar, RightTradingPanel, and BottomDock all use this, so we don't fire
 * 3 concurrent requests on terminal load (which was slowing the frontend).
 */
export function useAccountSummary() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const lastEquityRef = useRef<number | null>(null)

  const { data: accountSummary, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchAccountSummary,
    enabled: !!user?.id,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

  // Update cache from WebSocket so UI stays real-time without refetch
  useEffect(() => {
    if (!user?.id) return
    const currentUserId = String(user.id).trim()
    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      if (event.type === 'account.summary.updated') {
        const raw = (event as { type: 'account.summary.updated'; payload: Record<string, unknown> }).payload
        if (!raw || typeof raw !== 'object') return
        // Accept both camelCase and snake_case from backend
        const userId = String((raw.userId ?? raw.user_id) ?? '').trim()
        if (userId !== currentUserId) return
        const balance = Number((raw.balance ?? 0))
        const equity = Number((raw.equity ?? 0))
        const marginUsed = Number((raw.marginUsed ?? raw.margin_used ?? 0))
        const freeMargin = Number((raw.freeMargin ?? raw.free_margin ?? 0))
        const marginLevel = String(raw.marginLevel ?? raw.margin_level ?? '')
        const realizedPnl = Number((raw.realizedPnl ?? raw.realized_pnl ?? 0))
        const unrealizedPnl = Number((raw.unrealizedPnl ?? raw.unrealized_pnl ?? 0))
        const bonus = Number((raw.bonus ?? 0))
        const totalSwapPaidUsd =
          raw.totalSwapPaidUsd != null
            ? Number(raw.totalSwapPaidUsd)
            : raw.total_swap_paid_usd != null
              ? Number(raw.total_swap_paid_usd)
              : undefined
        const totalFeesPaidUsd =
          raw.totalFeesPaidUsd != null
            ? Number(raw.totalFeesPaidUsd)
            : raw.total_fees_paid_usd != null
              ? Number(raw.total_fees_paid_usd)
              : undefined
        const updatedAt = String(raw.updatedAt ?? raw.updated_at ?? '')
        const isZeros = balance === 0 && equity === 0 && marginUsed === 0
        if (isZeros && lastEquityRef.current != null && lastEquityRef.current > 0) return
        lastEquityRef.current = equity
        const marginCallLevelThreshold =
          raw.marginCallLevelThreshold != null
            ? Number(raw.marginCallLevelThreshold)
            : raw.margin_call_level_threshold != null
              ? Number(raw.margin_call_level_threshold)
              : null
        const stopOutLevelThreshold =
          raw.stopOutLevelThreshold != null
            ? Number(raw.stopOutLevelThreshold)
            : raw.stop_out_level_threshold != null
              ? Number(raw.stop_out_level_threshold)
              : null
        const payload: AccountSummaryResponse = {
          userId,
          balance,
          equity,
          marginUsed,
          freeMargin,
          marginLevel,
          marginCallLevelThreshold,
          stopOutLevelThreshold,
          realizedPnl,
          unrealizedPnl,
          bonus,
          totalSwapPaidUsd,
          totalFeesPaidUsd,
          updatedAt,
        }
        queryClient.setQueryData<AccountSummaryResponse>(QUERY_KEY, payload)
      }
    })
    return unsubscribe
  }, [user?.id, queryClient])

  if (accountSummary) lastEquityRef.current = accountSummary.equity

  return { accountSummary: accountSummary ?? null, isLoading }
}

export { QUERY_KEY as accountSummaryQueryKey }
```

**HTTP endpoint used by `queryFn`:**

```49:51:src/features/wallet/api.ts
export async function fetchAccountSummary(): Promise<AccountSummaryResponse> {
  return http<AccountSummaryResponse>('/api/account/summary')
}
```

### 1C — Browser DevTools Network (operator measurement — not run from CI)

**Procedure:**

1. Open DevTools → **Network** → filter `summary` (or `account/summary`).
2. Place an order (same flow that reproduces the delay).
3. Record timing between **POST** order request and any **GET** `/api/account/summary`.

**Interpretation:**

- **If WS path is healthy and no polling:** expect **no automatic GET** tied to the order; equity/margin should jump from **`account.summary.updated`** (see 1D).
- **If polling:** expect GET `/api/account/summary` on a **fixed cadence** (often ~5s) and UI updating right after that request completes.

**Recorded here (required):** _[operator: paste HAR timestamps or description]_

### 1D — Browser DevTools WebSocket frames (operator measurement)

**Procedure:**

1. Network → **WS** → select the app WebSocket → **Messages**.
2. Place an order.
3. Look for an inbound JSON message with `"type":"account.summary.updated"` (or equivalent framing from your gateway).

**Interpretation:**

- Frame **arrives ~250ms** after order (plus RTT): consistent with backend throttle + forward path; if UI still lags → frontend/render (Hypothesis C).
- Frame **absent** for several seconds: backend publish or gateway forwarding (Hypothesis B / infra).

**Recorded here (required):** _[operator: paste first post-order frame timestamp / payload redacted]_

---

## Step 2 — Backend publish path

### 2A — `place_order` → `compute_and_cache_account_summary` (synchronous after commit)

`grep -n "compute_and_cache_account_summary" backend/auth-service/src/routes/orders.rs` → lines **21** (import), **746** (background warm on cache miss), **887** (post-commit), **964** (comment reference).

**Post-commit path (await — not `tokio::spawn`):**

```882:887:backend/auth-service/src/routes/orders.rs
    tx.commit().await.map_err(|e| {
        error!(order_id = %order_id, user_id = %user_id, error = %e, "place_order FAILED stage=db_tx_commit status=500");
        PlaceOrderError::Status(StatusCode::INTERNAL_SERVER_ERROR)
    })?;

    compute_and_cache_account_summary(&pool, orders_state.redis.as_ref(), user_id).await;
```

**Note:** Line **745–747** uses `tokio::spawn` only for **warming** summary after a **free-margin cache miss** (fire-and-forget). That is **not** the success-path post-commit recompute.

### 2B–2C — Redis cache, throttle, publish (`deposits.rs`)

**Throttle constant and `should_publish` (250ms, not 5000ms):**

```288:332:backend/auth-service/src/routes/deposits.rs
// ============================================================================
// ACCOUNT SUMMARY COORDINATOR (per-user serialization + publish throttle)
// ============================================================================
/// Ensures only one account summary computation runs per user at a time and
/// throttles WebSocket publishes to avoid UI flicker from rapid updates.
pub struct AccountSummaryCoordinator {
    user_locks: DashMap<Uuid, Arc<Mutex<()>>>,
    last_publish: DashMap<Uuid, Instant>,
}

const PUBLISH_THROTTLE_MS: u64 = 250;

impl AccountSummaryCoordinator {
    pub fn new() -> Self {
        Self {
            user_locks: DashMap::new(),
            last_publish: DashMap::new(),
        }
    }

    /// Run a future with exclusive compute right for this user (one at a time per user).
    pub async fn run_exclusive<Fut>(&self, user_id: Uuid, fut: Fut)
    where
        Fut: std::future::Future<Output = ()> + Send,
    {
        let mutex = self
            .user_locks
            .entry(user_id)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        let _guard = mutex.lock().await;
        fut.await
    }

    pub fn should_publish(&self, user_id: Uuid) -> bool {
        let now = Instant::now();
        match self.last_publish.get(&user_id) {
            Some(t) => now.duration_since(*t).as_millis() >= PUBLISH_THROTTLE_MS as u128,
            None => true,
        }
    }

    pub fn record_publish(&self, user_id: Uuid) {
        self.last_publish.insert(user_id, Instant::now());
    }
}
```

**`hset_multiple` on account summary hash, `user:{id}:balance` JSON (not gated by publish), conditional Redis pub/sub publish:**

```1950:2013:backend/auth-service/src/routes/deposits.rs
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

                    // Order-engine `validation.rs` reads `user:{id}:balance` (GET). Keep it in lockstep with
                    // `pos:summary` above — not gated by `should_publish` (WS throttle only).
                    let fm = summary_with_threshold.free_margin.to_string();
                    let balance_json = serde_json::json!({
                        "currency": "USD",
                        "available": fm.clone(),
                        "locked": "0",
                        "equity": summary_with_threshold.equity.to_string(),
                        "margin_used": summary_with_threshold.margin_used.to_string(),
                        "free_margin": fm,
                        "updated_at": Utc::now().timestamp_millis(),
                    });
                    let user_balance_key = format!("user:{}:balance", user_id);
                    if let Err(e) = conn
                        .set::<_, _, ()>(&user_balance_key, balance_json.to_string())
                        .await
                    {
                        warn!(
                            user_id = %user_id,
                            error = %e,
                            "Failed to SET user:balance JSON for order-engine (after pos:summary refresh)"
                        );
                    }

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
                }
```

**Evidence:** Publish is **conditional** on `should_publish` (250ms window). If coordinator is **not** initialized, `COORDINATOR.get()` is `None` and `should_pub` defaults to **`true`** (`unwrap_or(true)`). The throttle is **not** 5000ms in source.

**Related tick listener (different throttle; includes a 5s sleep on subscriber failure):**

```47:62:backend/auth-service/src/services/price_tick_summary_handler.rs
    pub async fn start_listener(&self, redis_url: &str) {
        info!("📡 Starting price:ticks subscriber for real-time account summary");

        loop {
            match redis::Client::open(redis_url) {
                Ok(client) => {
                    if let Err(e) = self.run_subscriber(&client).await {
                        error!("price:ticks subscriber error: {}", e);
                    }
                }
                Err(e) => {
                    error!("Failed to open Redis for price:ticks: {}", e);
                }
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }
```

This **5s** is **only** between reconnect attempts after the `price:ticks` subscriber loop exits — **not** a steady-state tick interval. It could still matter if the subscriber is **crash-looping** in production (measure with service logs / metrics).

### 2D — WebSocket gateway forwarding

**`apps/gateway-ws` (Redis → WS JSON envelope):** subscribes to `account:summary:updated`, wraps payload as `{ type: "account.summary.updated", payload: ... }`, sends to sessions whose `session.user_id` matches.

```717:792:apps/gateway-ws/src/main.rs
/// Subscribe to Redis account:summary:updated and forward to WebSocket sessions by user_id.
async fn forward_account_summary_from_redis(state: AppState, redis: Arc<redis::Client>) {
    use futures_util::StreamExt;
    let mut pubsub = match redis.get_async_connection().await {
        Ok(conn) => conn.into_pubsub(),
        Err(e) => {
            error!("Account summary forwarder: Redis connection failed: {}", e);
            return;
        }
    };
    if pubsub.subscribe("account:summary:updated").await.is_err() {
        error!("Account summary forwarder: failed to subscribe to account:summary:updated");
        return;
    }
    info!("Redis account summary forwarder subscribed to account:summary:updated");
    let mut stream = pubsub.on_message();
    while let Some(msg) = stream.next().await {
        let payload: String = msg.get_payload().unwrap_or_default();
        let mut payload_json: serde_json::Value = match serde_json::from_str(&payload) {
            Ok(v) => v,
            Err(e) => {
                error!("Account summary forwarder: failed to parse message: {}", e);
                continue;
            }
        };
        let event_user_id_str = payload_json
            .get("userId")
            .or_else(|| payload_json.get("user_id"))
            .and_then(|v| v.as_str());
        let event_user_id = match event_user_id_str.and_then(|s| Uuid::parse_str(s).ok()) {
            Some(u) => u,
            None => {
                error!("Account summary forwarder: message missing or invalid userId/user_id");
                continue;
            }
        };
        info!("Account summary forwarder: received from Redis for user {}", event_user_id);
        if let Some(obj) = payload_json.as_object_mut() {
            if !obj.contains_key("userId") {
                obj.insert("userId".to_string(), serde_json::Value::String(event_user_id.to_string()));
            }
        }
        let event_json = serde_json::json!({
            "type": "account.summary.updated",
            "payload": payload_json
        });
        let json = match serde_json::to_string(&event_json) {
            Ok(s) => s,
            Err(e) => {
                error!("Account summary forwarder: failed to serialize: {}", e);
                continue;
            }
        };
        let sessions = state.sessions.read().await;
        let senders = state.senders.read().await;
        let mut sent_count = 0u32;
        for (session_id, session) in sessions.iter() {
            if session.user_id != Some(event_user_id) {
                continue;
            }
            if let Some(tx) = senders.get(session_id) {
                if tx.send(axum::extract::ws::Message::Text(json.clone())).is_ok() {
                    sent_count += 1;
                    info!("Forwarded account.summary.updated to session {} (user {})", session_id, event_user_id);
                }
            }
        }
        if sent_count == 0 {
            warn!(
                "Account summary forwarder: no WS session for user {} (total sessions: {}, authenticated: {:?})",
                event_user_id,
                sessions.len(),
                sessions.iter().filter_map(|(_, s)| s.user_id).collect::<Vec<_>>()
            );
        }
    }
}
```

**`backend/ws-gateway`:** subscribes to Redis channel `account:summary:updated` (see `main.rs` channel list) and dispatches:

```134:136:backend/ws-gateway/src/stream/broadcaster.rs
            "account:summary:updated" => {
                Self::broadcast_account_summary(registry, connection_txs, payload).await?;
            }
```

```621:641:backend/ws-gateway/src/stream/broadcaster.rs
    async fn broadcast_account_summary(
        registry: &ConnectionRegistry,
        connection_txs: &DashMap<Uuid, mpsc::Sender<ServerMessage>>,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        let user_id = payload
            .get("userId")
            .or_else(|| payload.get("user_id"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing userId in account summary"))?;

        let message = ServerMessage::AccountSummaryUpdated {
            payload: payload.clone(),
        };

        let connections = registry.get_user_connections(user_id);
        for conn_id in connections {
            try_dispatch_conn(registry, connection_txs, conn_id, message.clone());
        }

        Ok(())
    }
```

**`backend/ws-gateway` Redis reconnect default:** `REDIS_RECONNECT_INTERVAL_SECS` defaults to **`5`** (`backend/ws-gateway/src/config.rs` lines 77–79). This affects **reconnect after subscriber errors**, not per-order timing in healthy operation.

---

## Step 3 — Recent commits touching these paths

Per-file `git log --since="7 days ago" --oneline -- <file>` (executed 2026-05-23):

| File | Recent commits |
|------|----------------|
| `src/features/wallet/hooks/useAccountSummary.ts` | `2103d90` — *feat: trading costs, FX, … terminal hardening* |
| `backend/auth-service/src/routes/deposits.rs` | `c92d08c`, `2103d90`, `06011b8`, `864821a`, `daf1fa8`, … |
| `backend/auth-service/src/routes/orders.rs` | `c92d08c`, `ae3ca36`, `2103d90`, `d331944`, … |
| `backend/auth-service/src/services/price_tick_summary_handler.rs` | *(none in 7d window)* |
| `apps/gateway-ws/src/main.rs` | *(none in 7d window)* |
| `backend/ws-gateway/src/stream/broadcaster.rs` | `2103d90`, `1bd84d0` |

**Notable diff (deploy “order confirmation dialog”):** `c92d08c` **removed** a redundant `user:{id}:balance` Redis sync block from `orders.rs` (after `compute_and_cache_account_summary` already runs) and **moved** consolidated `user:balance` JSON refresh into `compute_and_cache_account_summary_with_prices` in `deposits.rs`. That aligns with Phase 1 balance consolidation docs; it does **not** remove the post-commit `compute_and_cache_account_summary(...).await` call.

---

## Step 4 — Live React Query / console (operator; optional)

**Suggested checks:**

1. `JSON.stringify(window.__REACT_QUERY_DEVTOOLS__?.queryClient?.getQueryData(['accountSummary']))` at T+1s and T+5s after order (may be unavailable if devtools not injected).
2. Or temporarily add a `console.log` at the `setQueryData` line in `useAccountSummary.ts` (requires a dev build — **out of scope** for this read-only doc).

**Recorded:** _[operator]_

---

## Step 5 — End-to-end timestamps T0–T3 (operator)

| Mark | Meaning |
|------|--------|
| T0 | POST `/v1/orders` (or your trading API) **start** |
| T1 | POST **response** received |
| T2 | First WS inbound `account.summary.updated` **after** order |
| T3 | UI equity / free margin **visibly** changes |

**Recorded:** _[operator: fill deltas]_

---

## Step 6 — Verdict (hypotheses A–E)

Evidence is **split**: static frontend/backend review **does not** show a 5s poll on `['accountSummary']` or a 5000ms publish throttle; **`place_order` still awaits** `compute_and_cache_account_summary` immediately after commit. **Without** Network + WS message timestamps (Steps 1C, 1D, 5), the root cause is **not** uniquely provable from the repo alone.

| Hypothesis | Supported by current evidence? | Files / lines | Fix direction (when confirmed) | Effort |
|------------|-------------------------------|---------------|--------------------------------|--------|
| **A — Polling re-introduced** | **Weak / not for this query:** no `refetchInterval` on `useAccountSummary`; global QueryClient has no default interval; greps show only unrelated `setInterval(…, 5000)`. | `useAccountSummary.ts`, `QueryProvider.tsx`, Step 1A grep | If Network **shows** periodic GET `/api/account/summary`, find caller (extension, proxy, or other bundle) and remove interval. | Low–med |
| **B — WS push broken at source** | **Possible** if no Redis publish or no WS frame; throttle skips publish for ≤250ms, not 5s, unless combined with missing downstream delivery. | `deposits.rs` ~2000–2013; `price_tick_summary_handler.rs` reconnect loop | Verify Redis `PUBLISH` subscribers count logs; ensure gateway subscribes; consider **always publish** on order path or **coalesced flush** after skip. | Med |
| **C — WS works; UI doesn’t apply** | **Possible** if T2 ≪ T3 and no GET; check `setQueryData` and payload shape (`userId` vs auth `user.id`). | `useAccountSummary.ts` 33–91 | Fix handler / payload mismatch; verify `wsClient` event type. | Low |
| **D — `place_order` / compute path slow** | **Possible** if **T1−T0 ≈ 4–5s** (user waits on POST). Heavy `compute_account_summary_inner` work would block **response** and block **await** before idempotency/NATS steps. | `orders.rs` 887+; `deposits.rs` `compute_account_summary_inner` | Profile SQL + Redis in `place_order`; defer non-critical work **only if** business rules allow. | High |
| **E — Compounding** | **Possible** (e.g. slow POST + missed WS + later refetch on focus). | Combination | Untangle with T0–T3. | Med |

### Required next step (measurement)

Run **Step 1C + 1D + Step 5** once in the environment where the bug reproduces. The single most discriminating observation is:

- **GET `/api/account/summary` ~5s after POST** → revisit **Hypothesis A** (something is refetching outside the grep scope, or a different client build).
- **No GET; WS frame delayed ~5s** → **Hypothesis B** / gateway / Redis pubsub / auth-service publish path (logs: `✅ Published account summary…`).
- **WS frame immediate; UI ~5s** → **Hypothesis C**.
- **POST itself ~5s** → **Hypothesis D**.

---

## Chat-sized summary (one paragraph)

Static analysis of `src/` shows **no** `refetchInterval` (and no 5s timer) tied to `['accountSummary']`, and `backend/auth-service` still uses **`PUBLISH_THROTTLE_MS = 250`** with a **synchronous** `compute_and_cache_account_summary(...).await` immediately after `tx.commit()` in `place_order`, so a **classic 5s React Query poll** on that query is **not** what the current tree implements. The **~4–5s** behaviour is therefore **not explained by the inspected throttle constant or by obvious frontend polling on this hook**; confirming the real regression requires **one** DevTools pass recording **(1)** whether GET `/api/account/summary` fires after the order and **(2)** when the first `account.summary.updated` WS frame arrives relative to POST start/response (**Steps 1C, 1D, 5**). Until those timings are captured, treat the root cause as **open between B, C, D, and E** above.

**Recommended next step:** Capture T0–T3 and a Network row for `/api/account/summary` on a single reproducing order; paste results into the “Recorded” placeholders in this doc and narrow to one hypothesis.
