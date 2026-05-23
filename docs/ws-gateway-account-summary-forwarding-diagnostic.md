# ws-gateway: account summary forwarding (code-only diagnostic)

**Question:** Why might account summary updates take **4–5 seconds** to reach the browser, given Redis/auth are fast?

**Scope:** Read-only review of `backend/ws-gateway` (+ minimal cross-refs to `auth-service` publish payload and frontend `wsClient`). **No code or config changes.**

**Hypotheses:** **C1** registry miss · **C2** send queue / backpressure · **C3** userId format mismatch · **C4** event type rename mismatch · **C5** `wsClient` routing · **C6** combination.

---

## Step 1 — Forwarding function `broadcast_account_summary`

**File:** `backend/ws-gateway/src/stream/broadcaster.rs`

### Full function (lines 621–642)

```621:642:backend/ws-gateway/src/stream/broadcaster.rs
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

### Answers (Step 1 checklist)

1. **user_id extraction:** JSON field **`userId` first**, else **`user_id`**; value must be a **JSON string** (`.as_str()`). Not parsed as `Uuid` here — stays `&str` into the registry.
2. **Lookup:** `registry.get_user_connections(user_id)` → `Vec<Uuid>` connection ids.
3. **Send:** `try_dispatch_conn(registry, connection_txs, conn_id, message.clone())` for each id (**non-blocking** `try_send` inside that helper).
4. **Logs on delivery failure:** **None inside this function.** If `connections` is **empty**, the loop runs **zero times** and the function returns **`Ok(())` silently** — no `warn!` / `info!` (important for **C1**).

---

## Step 2 — Connection registry

**File:** `backend/ws-gateway/src/state/connection_registry.rs`

### Normalization (used on register and lookup)

```5:8:backend/ws-gateway/src/state/connection_registry.rs
fn normalize_user_id(user_id: &str) -> String {
    user_id.trim().to_lowercase().replace('-', "")
}
```

### `get_user_connections`

```119:125:backend/ws-gateway/src/state/connection_registry.rs
    pub fn get_user_connections(&self, user_id: &str) -> Vec<Uuid> {
        let key = normalize_user_id(user_id);
        self.user_connections
            .get(&key)
            .map(|entry| entry.value().clone())
            .unwrap_or_default()
    }
```

### Registration (`register`)

```40:52:backend/ws-gateway/src/state/connection_registry.rs
    pub fn register(&self, conn: Connection) {
        let conn_id = conn.conn_id;
        let user_id = conn.user_id.clone();
        let key = normalize_user_id(&user_id);

        // Register connection
        self.connections.insert(conn_id, conn);

        // Index by normalized user_id so wallet balance etc. find the connection
        self.user_connections
            .entry(key)
            .or_insert_with(Vec::new)
            .push(conn_id);
    }
```

**Stored `Connection.user_id`:** raw string from JWT `sub` (see Step 9). **Index key:** **lowercase, no hyphens** — lookup uses the **same** normalization, so **canonical UUID with dashes vs without** should still match (**reduces C3 risk**).

---

## Step 3 — User ID matching (end-to-end)

### 3.1 Auth-service published JSON shape

`AccountSummary` uses **`#[serde(rename_all = "camelCase")]`** and `user_id: String` filled with `user_id.to_string()` (UUID hyphenated form from Rust `Uuid`).

```614:618:backend/auth-service/src/routes/deposits.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub user_id: String,
```

Published payload is `serde_json::to_string(&summary_with_threshold)` in `compute_and_cache_account_summary_with_prices` — so the Redis message body includes **`"userId":"<uuid-with-dashes>"`** (camelCase of `user_id`).

### 3.2 ws-gateway extraction

See Step 1: **`userId` OR `user_id`**, string only.

### 3.3 Registry stores JWT `sub`

See Step 9 — `claims.sub` as `String` (UUID string if that’s what the token uses).

### 3.4 Lookup

Same normalization for register and `get_user_connections` (Step 2).

**Comparison:** **No format mismatch is evident in code** between publish (`userId` string) and registry key (normalized `sub`), assuming JWT `sub` is the same user id string auth uses in summary (**C3 not supported** by static analysis; still verify token `sub` in a failing session if needed).

---

## Step 4 — `try_dispatch_conn` and logging

**File:** `backend/ws-gateway/src/stream/broadcaster.rs`

```14:47:backend/ws-gateway/src/stream/broadcaster.rs
fn try_dispatch_conn(
    registry: &ConnectionRegistry,
    connection_txs: &DashMap<Uuid, mpsc::Sender<ServerMessage>>,
    conn_id: Uuid,
    msg: ServerMessage,
) {
    let Some(tx_ref) = connection_txs.get(&conn_id) else {
        return;
    };
    let sender = tx_ref.value().clone();
    drop(tx_ref);
    match sender.try_send(msg) {
        Ok(()) => {}
        Err(TrySendError::Full(m)) => {
            if matches!(m, ServerMessage::Tick { .. }) {
                // expected under high tick rate
            } else if matches!(
                &m,
                ServerMessage::OrderUpdate { .. } | ServerMessage::PositionUpdate { .. }
            ) {
                // Avoid dropping fills / position opens when the queue is full of ticks.
                let sender2 = sender.clone();
                tokio::spawn(async move {
                    let _ = sender2.send(m).await;
                });
            } else {
                debug!("conn {} outbound queue full; dropping non-tick", conn_id);
            }
        }
        Err(TrySendError::Closed(_)) => {
            connection_txs.remove(&conn_id);
            registry.unregister(conn_id);
        }
    }
}
```

| Outcome | Log on success? | Log on failure? |
|--------|-----------------|-------------------|
| `try_send` **Ok** | **No** | — |
| Queue **full**, message is **Tick** | — | **None** (silent drop by design) |
| Queue **full**, **OrderUpdate / PositionUpdate** | — | **No** (spawn + blocking `send`) |
| Queue **full**, **anything else** (includes **`AccountSummaryUpdated`**) | — | **`debug!`** only: `outbound queue full; dropping non-tick` |
| **Closed** | — | **No** explicit log; removes conn + unregisters |

**`broadcast_account_summary` with zero connections:** **Silent** `Ok(())` — **no** “no WS session” line in **`ws-gateway`** (that phrase exists in **`apps/gateway-ws`**, not this crate).

**Smoking-gun pattern from code:** Message can be **received from Redis**, **lookup returns []**, and **nothing is logged** → looks like “WS path dead” until some **other** refresh path updates the UI (**C1** behaviorally; **not provable** from grep patterns written for gateway-ws).

---

## Step 5 — Production log check (operator command)

Command run (2026-05-23):

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production logs ws-gateway --since 1h 2>&1 | grep -iE "no WS session|no session|sent_count|0 connections|no connection"
```

**Result:** **No lines** (empty).

**Interpretation:**

- **`ws-gateway` does not emit strings like “no WS session for user”** on empty fan-out — those greps **cannot confirm C1** for this binary.
- A useful production check for **C2** at default log levels would need **`dropping non-tick`** (DEBUG). Sample **24h** count: **`grep -c "dropping non-tick"` → `0`** on the captured log stream (either queue rarely full at this volume, or DEBUG not enabled in prod).

**C1 from logs:** **Not confirmed** with the suggested grep; **code** shows **C1 would be silent** anyway.

---

## Step 6 — Send queue / backpressure (**C2**)

### Channel capacity

```10:12:backend/ws-gateway/src/stream/broadcaster.rs
/// Max queued outbound messages per WebSocket. Slow clients cannot grow memory without bound;
/// price ticks are safe to drop when the queue is full.
pub const WS_CONN_CHANNEL_CAP: usize = 4096;
```

**Channel creation** (`session.rs`):

```58:58:backend/ws-gateway/src/ws/session.rs
        let (tx, mut rx) = mpsc::channel::<ServerMessage>(WS_CONN_CHANNEL_CAP);
```

### Account summary when queue is full

`AccountSummaryUpdated` is **not** `Tick`, **not** `OrderUpdate` / `PositionUpdate` → falls in **`else`** → **`debug!`** and **message is dropped** (no `spawn` + `send().await` retry).

**Evidence for C2:** By design, **account summary can be discarded** under tick pressure while **orders/positions** are retried. UI could then update only on a **later** successful publish / other refresh — latency depends on traffic (**consistent multi-second** lag would need sustained saturation or rare drops plus slow follow-up).

---

## Step 7 — Frontend `wsClient.subscribe` (**C5**)

**File:** `src/shared/ws/wsClient.ts`

- **Registration:** `subscribe(handler)` adds to a `Set<MessageHandler>`; returns unsubscribe that `delete`s the handler (`250:255:src/shared/ws/wsClient.ts`).
- **On message:** `JSON.parse` → **`forEach` on every handler** with the full `data` object — **no** type whitelist that would skip `account.summary.updated` (`148:157:src/shared/ws/wsClient.ts`).
- **Filtering:** Special cases only for `auth_success`, `auth_error`, extra logging — **not** dropping unknown types before dispatch.

**C5:** **Not supported** — generic dispatch runs for all parsed `type` values.

---

## Step 8 — Event type string (**C4**)

**File:** `backend/ws-gateway/src/ws/protocol.rs`

```121:124:backend/ws-gateway/src/ws/protocol.rs
    #[serde(rename = "account.summary.updated")]
    AccountSummaryUpdated {
        payload: serde_json::Value,
    },
```

Envelope is `#[serde(tag = "type")]` on `ServerMessage` (`42:43`), so JSON has **`"type":"account.summary.updated"`**.

Frontend union includes the same literal (`259:261:src/shared/ws/wsEvents.ts`).

**C4:** **Not supported** — names align.

---

## Step 9 — Auth handshake → registry user_id

**File:** `backend/ws-gateway/src/ws/session.rs` (auth branch)

```189:217:backend/ws-gateway/src/ws/session.rs
                                match jwt_auth.validate_token(token) {
                                    Ok(claims) => {
                                        // ...
                                        let conn = Connection {
                                            conn_id,
                                            user_id: claims.sub.clone(),
                                            group_id: claims.group_id.clone(),
                                            role: claims.role.clone(),
                                            subscriptions: Arc::new(dashmap::DashMap::new()),
                                            last_heartbeat: std::time::Instant::now(),
                                        };
                                        registry.register(conn);
                                        is_authenticated = true;
                                        info!("✅ Connection {} registered with user_id: {}", conn_id, claims.sub);
```

**JWT `sub` deserialization** (`auth/jwt.rs`): accepts UUID or string, normalizes UUID to **`.to_string()`** (hyphenated canonical UUID form).

```19:35:backend/ws-gateway/src/auth/jwt.rs
// Helper to deserialize sub field which can be UUID or string
fn deserialize_sub<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Sub {
        Uuid(uuid::Uuid),
        String(String),
    }
    
    match Sub::deserialize(deserializer)? {
        Sub::Uuid(uuid) => Ok(uuid.to_string()),
        Sub::String(s) => Ok(s),
    }
}
```

**Comparison to auth-service summary JSON:** Both are expected to be the **same user’s UUID as a string**; registry lookup **strips hyphens and lowercases**, matching the normalized key used when indexing **`userId`** from Redis.

---

## Step 10 — Verdict

| ID | Verdict | Supported by this read-only pass? |
|----|---------|-------------------------------------|
| **C1** | Session not in registry / empty fan-out | **Plausible** behaviorally, **not** observable via the suggested prod grep strings — **`broadcast_account_summary` never logs empty results**. |
| **C2** | Queue saturation drops non-tick messages | **Strong code evidence:** `AccountSummaryUpdated` on **`TrySendError::Full`** is **`debug!` + drop** only; **unlike** orders/positions **no** `tokio::spawn`+`send().await` recovery (`25:41:broadcaster.rs`). |
| **C3** | userId mismatch | **Not supported** — normalization + `userId`/`user_id` + JWT `sub` string path line up in code. |
| **C4** | Wrong serde rename | **Not supported** — `account.summary.updated` on both sides. |
| **C5** | `wsClient` drops events | **Not supported** — handlers receive all types. |
| **C6** | Multiple | Possible **C1 + C2** (miss first delivery, later tick summary blocked intermittently) — needs runtime metrics. |

**Most likely single root from ws-gateway code alone:** **C2** — **account summary is a second-class citizen** on a full per-connection queue: it can be **dropped** under load with **only a DEBUG line**, while **orders/positions** are explicitly retried. That matches “sometimes UI catches up later” without requiring HTTP polling.

**Secondary structural issue:** **C1-style failures are silent** (no INFO/WARN when **zero** connections), so ops cannot grep for “no session” on **`ws-gateway`** the way the earlier doc suggested for **`apps/gateway-ws`**.

**Fix direction (for a future change, not done here):** (1) Treat **`AccountSummaryUpdated`** like order/position under `Full` (queue + async `send`), or use a **small reserved capacity** / priority queue; (2) add **`warn!`** when `get_user_connections` returns empty for a summary event (with user id) to validate **C1** in prod; (3) temporarily enable **DEBUG** or metrics counters for **`dropping non-tick`** to validate **C2** in prod.

---

## Appendix — Commands used (production)

```bash
ssh root@ptf.interwarepvt.com
cd /opt/newpt
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production logs ws-gateway --since 1h 2>&1 | grep -iE "no WS session|no session|sent_count|0 connections|no connection"
# (empty)

docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production logs ws-gateway --since 24h 2>&1 | grep -c "dropping non-tick"
# 0
```
