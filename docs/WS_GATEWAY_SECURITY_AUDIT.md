# WebSocket Gateway (ws-gateway) Security & Correctness Audit

**Scope:** `backend/ws-gateway/src/` — connection lifecycle, JWT auth, subscriptions, Redis/NATS fan-out, per-user routing.  
**Out of scope:** Publishers in auth-service/order-engine (assumed audited); separate `apps/gateway-ws` binary (noted in §8).  
**Method:** Static read-only review.  
**Date:** 2026-05-19

**Related:** [AUTH_SERVICE_SECURITY_AUDIT.md](./AUTH_SERVICE_SECURITY_AUDIT.md), [FINANCE_MODULE_SECURITY_AUDIT.md](./FINANCE_MODULE_SECURITY_AUDIT.md), [TRADING_API_SECURITY_AUDIT.md](./TRADING_API_SECURITY_AUDIT.md)

---

# 0. Executive Summary

The ws-gateway authenticates via a **first-message `auth` JSON** with HS256 JWT (shared `JWT_SECRET`), registers connections in a **normalized `user_id` index**, and fans out Redis pub/sub and NATS subjects to per-connection `mpsc` queues (4096 cap, ticks dropped when full). Per-user routing for orders, positions, wallet, and account summary **keys off `user_id` in the payload** — correct when publishers are honest. However, **`deposits:requests` and `deposits:approved` are broadcast to every connected client** (including all traders), leaking other users’ deposit amounts and approval events. Unauthenticated sockets are **never registered** and therefore **not subject to heartbeat/stale cleanup**, while `MAX_CONNECTIONS` and per-message rate limits exist in config but are **not enforced** on upgrade. JWT validation is **one-shot at connect** with no DB revalidation; disabled users and role changes do not disconnect existing sessions.

**Trust score: 3/10**

**Go/no-go:** **No-go** until deposit/notification fan-out is fixed and unauthenticated connection limits are enforced.

**Top 3 issues:**
1. **`deposit.request.created` delivered to all WebSocket clients** — any logged-in user sees every pending deposit (Critical).
2. **`deposit.request.approved` duplicated to all connections** after user delivery — cross-user financial disclosure (Critical).
3. **No auth deadline / no `MAX_CONNECTIONS` enforcement** — unauthenticated connection exhaustion (High).

---

# 1. Module Inventory

| Path | Lines | Purpose |
|------|------:|---------|
| `main.rs` | 366 | Boot, Redis channels, NATS chat/AI subscribers, heartbeat task |
| `ws/session.rs` | 714 | WebSocket read/write loop, auth, subscribe, VoIP signaling |
| `stream/broadcaster.rs` | 638 | Redis → per-conn dispatch |
| `state/connection_registry.rs` | 175 | conn/user/symbol indexes |
| `ws/protocol.rs` | 187 | `ClientMessage` / `ServerMessage` types |
| `config.rs` | 114 | Env limits (mostly unused at runtime) |
| `validation/message_validation.rs` | 143 | Size/symbol/channel validation |
| `auth/jwt.rs` | 92 | JWT decode + expiry |
| `stream/redis_subscriber.rs` | 99 | Redis pub/sub ingest |
| `ws/server.rs` | 50 | Axum `/ws` upgrade (no pre-auth gate) |
| `state/call_registry.rs` | 65 | In-memory call state |
| `health/health.rs` | 39 | `/health`, `/metrics` |
| `routing/subscription_router.rs` | 24 | **Dead wrapper** — not referenced from `main` or `session` |
| `metrics/metrics.rs` | 47 | Metrics helpers |
| `*/mod.rs` | small | Module roots |

**Note:** `apps/gateway-ws` is a **second** WebSocket stack in the monorepo with its own NATS forwarding; this audit is **only** `backend/ws-gateway`.

---

# 2. Architecture & Data Flow

## Connection lifecycle

```
Client TCP → GET /ws (no auth)
    → WebSocket upgrade (immediate)
    → mpsc::channel(4096) registered in Broadcaster
    → recv loop:
         Text → parse ClientMessage
              → auth: JWT validate → registry.register(user_id, role, group_id)
              → subscribe: symbol index only (requires registry.get)
              → ping → pong + heartbeat
    → disconnect: unregister conn + symbol subs

Parallel:
    Redis pub/sub → mpsc(10000) → Broadcaster::handle_message
    NATS chat.> / ai.chat.> / ai.report.> → send_to_connections
```

## Redis channels (subscribed in `main.rs:53-63`)

| Channel | Routing |
|---------|---------|
| `price:ticks` | Symbol subscribers + group_id price match |
| `orders:updates` | `payload.user_id` → `get_user_connections` |
| `positions:updates` | `payload.user_id` → user connections |
| `risk:alerts` | `payload.user_id` → user connections |
| `deposits:requests` | **ALL `connection_txs`** |
| `deposits:approved` | User + **ALL connections** |
| `notifications:push` | `userId` if present, else **ALL** |
| `wallet:balance:updated` | `userId` / `user_id` → user only |
| `account:summary:updated` | `userId` / `user_id` → user only |

## NATS subjects (`main.rs`)

| Pattern | Routing |
|---------|---------|
| `chat.support` | `get_admin_connection_ids()` (admin + super_admin only) |
| `chat.user.{user_id}` | Target user connections **+ all admin connections** |
| `ai.chat.user.{user_id}` | Target user connections only |
| `ai.report.admin.{admin_id}` | Connections for `admin_id` (**no role re-check**) |

## Per-user routing model

```6:8:backend/ws-gateway/src/state/connection_registry.rs
fn normalize_user_id(user_id: &str) -> String {
    user_id.trim().to_lowercase().replace('-', "")
}
```

- Register: `user_connections[normalize(user_id)] → Vec<conn_id>`
- Lookup: same normalization on NATS/Redis `user_id` fields
- **UUID with/without dashes** should match; case-insensitive

## `ClientMessage` variants (`protocol.rs`)

`auth`, `subscribe`, `unsubscribe`, `ping`, `call.initiate`, `call.answer`, `call.reject`, `call.end`, `call.webrtc.*`

## `ServerMessage` variants (emit path)

`auth_success`, `auth_error`, `tick`, `order_update`, `position_update`, `risk_alert`, `pong`, `error`, `subscribed`, `unsubscribed`, `deposit.request.created`, `deposit.request.approved`, `notification.push`, `wallet.balance.updated`, `account.summary.updated`, call/*, `chat.message`, `ai.chat.delta`, `ai.report.delta`

---

# 3. Findings — DETAILED

---
### F1: All users receive every `deposits:requests` event
- **Severity:** 🔴 Critical
- **Category:** Cross-User Routing | Information Disclosure
- **Location:** `backend/ws-gateway/src/stream/broadcaster.rs:498-515`
- **Code:**

```498:515:backend/ws-gateway/src/stream/broadcaster.rs
    async fn broadcast_deposit_request(
        ...
        // Broadcast to all connections (admin should receive this)
        // In production, filter by user role from registry
        for entry in connection_txs.iter() {
            let conn_id = *entry.key();
            try_dispatch_conn(registry, connection_txs, conn_id, message.clone());
        }
```

- **What's wrong:** Redis `deposits:requests` (published from auth-service on user deposit create) is pushed to **every** authenticated WebSocket, not admins only.
- **Attack scenario:** Trader A is connected. Trader B submits `POST /api/deposits/request` for $50,000. Trader A’s terminal receives `{ "type": "deposit.request.created", "payload": { "userId": "...", "amount": 50000, ... } }`.
- **Impact:** Cross-user PII and financial intent disclosure; regulatory breach.
- **Recommended fix:** Route only to `get_admin_connection_ids()` and optionally scoped managers; never to non-admin roles.

---
### F2: `deposits:approved` sent to all connections after user copy
- **Severity:** 🔴 Critical
- **Category:** Cross-User Routing | Information Disclosure
- **Location:** `backend/ws-gateway/src/stream/broadcaster.rs:518-546`
- **Code:**

```533:544:backend/ws-gateway/src/stream/broadcaster.rs
        let connections = registry.get_user_connections(user_id);
        for conn_id in connections {
            try_dispatch_conn(registry, connection_txs, conn_id, message.clone());
        }
        // Also send to all admins (they should see the approval)
        // For now, broadcast to all - in production filter by role
        for entry in connection_txs.iter() {
            let conn_id = *entry.key();
            try_dispatch_conn(registry, connection_txs, conn_id, message.clone());
        }
```

- **What's wrong:** After delivering to the depositor, the same approval (amount, `newBalance`, `transactionId`) is fan-out to **every** connected client.
- **Impact:** Any user sees others’ approved deposits and balances.
- **Recommended fix:** Second loop = `get_admin_connection_ids()` only; dedupe conn_ids.

---
### F3: Unauthenticated connections never time out; `MAX_CONNECTIONS` unused
- **Severity:** 🟠 High
- **Category:** Resource Limit | Authentication
- **Location:** `ws/server.rs:33-48`, `session.rs:110-111`, `main.rs:336-347`, `config.rs:60-62`
- **Code:**

```33:48:backend/ws-gateway/src/ws/server.rs
async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| async move {
        let mut session = Session::new(...);
        session.handle(socket).await;
    })
}
```

```336:347:backend/ws-gateway/src/main.rs
    // Stale cleanup only unregister() connections that were registered at auth
    let stale = registry_heartbeat.get_stale_connections(timeout_secs);
```

- **What's wrong:** Upgrade is unconditional. `is_authenticated` is local to recv task; **unauth sockets never call `registry.register`**, so heartbeat monitor never removes them. `config.server.max_connections` defaults to **10,000,000** and is **never read** in `server.rs`/`session.rs`.
- **Attack scenario:** Bot opens 50k TCP/WebSocket connections, never sends `auth` — each holds tasks + `mpsc(4096)` sender until process OOM.
- **Impact:** DoS; no per-IP cap either.
- **Recommended fix:** Auth within N seconds or close; enforce global + per-IP connection caps at upgrade; count unauth sockets separately.

---
### F4: JWT trusted for connection lifetime — no revalidation / no kick on revoke
- **Severity:** 🟠 High
- **Category:** Authentication
- **Location:** `ws/session.rs:162-197`, `auth/jwt.rs:79-90`
- **What's wrong:** Single `auth` message; `is_authenticated` never re-checked. No periodic JWT re-validation, no DB lookup for `trading_access` / `deleted_at`. Aligns with auth audit F9 (JWT-only trust).
- **Attack scenario:** User disabled after connect continues receiving wallet/position updates until disconnect.
- **Impact:** Revoked users retain live data feed.
- **Recommended fix:** Re-validate JWT every N minutes; subscribe to user revoke events; close on failure.

---
### F5: `chat.user.{id}` fan-out includes all admins — no tag/group scope
- **Severity:** 🟠 High
- **Category:** Authorization | Cross-User Routing
- **Location:** `main.rs:198-207`
- **Code:**

```198:207:backend/ws-gateway/src/main.rs
                } else if subject.starts_with("chat.user.") {
                    let user_id = subject.strip_prefix("chat.user.").unwrap_or("");
                    let mut ids = registry_chat.get_user_connections(user_id);
                    let mut admin_ids = registry_chat.get_admin_connection_ids();
                    ids.append(&mut admin_ids);
```

- **What's wrong:** Every `admin`/`super_admin` connection receives **all** users’ support chat messages. Scoped managers (`manager` role) are excluded from `get_admin_connection_ids` but **all** global admins see **all** tenants.
- **Impact:** Cross-book support PII; manifests auth audit scoping gap on live channel.
- **Recommended fix:** Publish `chat.manager.{tag}` or filter admin conn_ids by allowed user set from JWT claims / registry metadata.

---
### F6: AI report stream routes by subject user id only — no admin role check
- **Severity:** 🟡 Medium
- **Category:** Authorization | Admin channel isolation
- **Location:** `main.rs:277-296`
- **Code:**

```277:296:backend/ws-gateway/src/main.rs
                let admin_id = match subject.strip_prefix("ai.report.admin.") {
                    Some(id) if !id.is_empty() => id.to_string(),
                    _ => continue,
                };
                ...
                let conn_ids = registry_reports.get_user_connections(&admin_id);
                ...
                broadcaster_reports.send_to_connections(&conn_ids, ws_msg);
```

- **What's wrong:** Any connection whose JWT `sub` matches `admin_id` receives `ai.report.delta`. A **regular user** cannot subscribe to another admin’s id unless they steal that token. **No check** that `conn.role` is admin/manager. Compromised user JWT does not get admin reports unless subject matches their id — OK. Stolen **admin** JWT gets reports — expected.
- **Gap:** If auth-service mis-publishes to `ai.report.admin.{wrong_id}`, wrong admin receives it; no role gate as defense-in-depth.
- **Recommended fix:** Before send, filter `conn_ids` to connections where `role` is admin/super_admin/manager.

---
### F7: Order/position/wallet routing trusts publisher `user_id` (no WS-side verify)
- **Severity:** 🟡 Medium
- **Category:** Cross-User Routing | Other
- **Location:** `broadcaster.rs:293-359`, `369-442`, `586-610`
- **What's wrong:** Gateway does not verify that the publishing service is allowed to emit for that `user_id`. Malicious or buggy publisher on Redis can target arbitrary users (same class as engine F9 on NATS).
- **Impact:** Defense-in-depth missing at edge.
- **Recommended fix:** HMAC on Redis payloads or gateway-side correlation with signed event envelope.

---
### F8: `notifications:push` without `userId` broadcasts to everyone
- **Severity:** 🟡 Medium
- **Category:** Cross-User Routing
- **Location:** `broadcaster.rs:554-576`
- **What's wrong:** Missing `userId`/`user_id` → fan-out to all connections.
- **Impact:** Depends on publisher discipline; one bad publish leaks notifications globally.
- **Recommended fix:** Require user id; drop or admin-only default.

---
### F9: Inbound `channels` on subscribe are validated but not used for routing
- **Severity:** 🔵 Low
- **Category:** Other
- **Location:** `message_validation.rs:45-52`, `connection_registry.rs:84-94`, `broadcaster.rs` (no channel filter)
- **What's wrong:** Client may pass `channels: ["orders","positions"]` but Redis order/position events are delivered to **all** authenticated users via `user_id` in payload, regardless of symbol subscription or channel list.
- **Impact:** Misleading API; no extra leakage beyond user’s own events.
- **Note:** Ticks correctly require symbol subscription.

---
### F10: Config rate limits and max connections are dead code
- **Severity:** 🟡 Medium
- **Category:** Resource Limit
- **Location:** `config.rs:36-40`, `message_validation.rs` (no RPS check)
- **What's wrong:** `max_requests_per_second`, `rate_limit_burst` never referenced in `session.rs`.
- **Recommended fix:** Token bucket per `conn_id` on inbound messages.

---
### F11: Auth errors and logging disclose token material
- **Severity:** 🟡 Medium
- **Category:** Information Disclosure
- **Location:** `session.rs:115`, `234-236`, `236-238`
- **Code:**

```234:238:backend/ws-gateway/src/ws/session.rs
                                        error!("❌ Token validation failed for connection {}: {}", conn_id, e);
                                        error!("   Token (first 50 chars): {}", token.chars().take(50).collect::<String>());
                                        let error_msg = ServerMessage::AuthError {
                                            error: format!("Invalid token: {}", e),
```

- **What's wrong:** Logs first 50 chars of bearer token; client gets distinct messages for expired vs invalid (`AuthError` strings differ).
- **Impact:** Log leakage; minor enumeration.
- **Recommended fix:** Generic auth failure to client; never log token substrings.

---
### F12: `manager` role excluded from admin deposit/chat routing
- **Severity:** 🔵 Low
- **Category:** Authorization
- **Location:** `connection_registry.rs:127-136`
- **What's wrong:** `get_admin_connection_ids` only `admin` | `super_admin`. Managers with `finance:view` won’t get `chat.support` or intended admin streams on ws-gateway (while F1 wrongly sends deposits to **traders**).
- **Impact:** Product inconsistency, not direct leakage.

---

## 3.1 Connection authentication — confirmed

**Handshake:** First **text** JSON message with `"type":"auth"` and `token` (`session.rs:162-243`). No query-param or header auth on upgrade.

**Validation:** `JwtAuth::validate_token` — HS256, `validate_exp = true` (`auth/jwt.rs:64-81`). **Requires `JWT_SECRET`** (`config.rs:81-84`) — no dev fallback in ws-gateway (stricter than auth-service).

**Duplicate `is_expired`:** Checked after decode (`session.rs:176-185`) — redundant with `validate_exp`.

**Auth failure:** `auth_error` JSON sent; connection **stays open** (no forced close).

**Unauth flood:** No limit (F3).

**Per-IP rate limit:** **None.**

---

## 3.2 Connection re-authentication — confirmed

- No refresh requirement; no re-auth message handling (duplicate `auth` ignored silently, `session.rs:163-166`).
- Disabled/deleted users: **not checked** at gateway (F4).

---

## 3.3 Subscription authorization — confirmed

| Subscribe aspect | Check |
|------------------|-------|
| Authenticated | `registry.get(&conn_id)` required (`session.rs:247`) |
| Symbols | Normalized alphanumeric, max 500, max len 20 |
| Channels | If non-empty: only `tick`, `positions`, `orders`, `risk` — **not enforced in fan-out** (F9) |
| Symbol entitlements | **None** — any symbol allowed |
| Admin channels | **No client subscribe** for deposits; deposits pushed via Redis globally (F1) |

**Support chat:** Delivered via NATS, not client subscribe. Regular users **do not** receive `chat.support`; they **do** receive other users’ deposit events (F1).

---

## 3.4 Per-user message routing — confirmed

**Registry functions:**

```119:125:backend/ws-gateway/src/state/connection_registry.rs
    pub fn get_user_connections(&self, user_id: &str) -> Vec<Uuid> {
        let key = normalize_user_id(user_id);
        self.user_connections.get(&key)...
    }
```

**NATS `chat.user.{uuid}`:** `strip_prefix("chat.user.")` — malformed subjects with extra dots could mis-parse; typical UUID subjects OK.

**No active connections:** `try_send` never called — **silent drop** (no queue/replay).

**Concurrency:** Per-conn `mpsc`; no ordering guarantee across events; single consumer per conn preserves order.

---

## 3.5 AI chat / report routing — confirmed

| Subject | Recipients | Role check |
|---------|------------|------------|
| `ai.chat.user.{user_id}` | `get_user_connections(user_id)` only | N/A |
| `ai.report.admin.{admin_id}` | `get_user_connections(admin_id)` | **No** (F6) |

---

## 3.6 Cross-user leakage matrix

| Event | Source | Routing | Leak? |
|-------|--------|---------|-------|
| Tick | Redis `price:ticks` | Symbol subscribers + group | No (intended broadcast to subscribers) |
| Order update | Redis `orders:updates` | `user_id` in payload | No* (*if publisher honest) |
| Position update | Redis `positions:updates` | `user_id` | No* |
| Wallet balance | Redis `wallet:balance:updated` | `userId` | No |
| Account summary | Redis `account:summary:updated` | `userId` in JSON | No |
| Deposit request | Redis `deposits:requests` | **ALL clients** | **YES (F1)** |
| Deposit approved | Redis `deposits:approved` | User + **ALL** | **YES (F2)** |
| Notification | Redis `notifications:push` | User or ALL | **If no userId (F8)** |
| Support chat | NATS `chat.support` | Admins only | No to traders |
| User chat | NATS `chat.user.*` | User + all admins | Admins see all users (F5) |
| AI chat | NATS `ai.chat.user.*` | User only | No |
| AI report | NATS `ai.report.admin.*` | Matching admin id | No to other users |

---

## 3.7 Admin connection identification

- **Stored at auth:** `conn.role` from JWT (`session.rs:192`).
- **Promote/demote while connected:** Role **not** refreshed; streams follow old role until reconnect.
- **`get_admin_connection_ids`:** admin | super_admin only.

---

## 3.8 Resource limits

| Limit | Config default | Enforced? |
|-------|----------------|-----------|
| Max connections | 10,000,000 | **No** |
| Max symbols / client | 500 | Yes (validator) |
| Max message size | 65536 | Yes |
| Max RPS | 100 | **No** |
| mpsc per conn | 4096 | Yes (`try_send`, drop tick if full) |
| Max subscriptions | — | Symbol count only |

---

## 3.9 Slow clients

```23:30:backend/ws-gateway/src/stream/broadcaster.rs
    match tx.try_send(msg) {
        Ok(()) => {}
        Err(TrySendError::Full(m)) => {
            if matches!(m, ServerMessage::Tick { .. }) { } else {
                debug!("conn {} outbound queue full; dropping non-tick", conn_id);
```

- Non-tick events **dropped** when queue full — wallet/position updates can be lost silently.
- Backend Redis publish is async — **does not block** on slow clients (good).

**Heartbeat:** Client `ping` JSON or WS Ping/Pong updates `last_heartbeat`. Server monitor every **60s** removes stale **registered** conns after `connection_timeout_secs` (default **300**). Does **not** close TCP for stale entries (only `unregister` — send task may linger until write fails).

---

## 3.10 Input validation

- Unknown `ClientMessage` types: JSON parse fails → `INVALID_JSON` error, connection continues.
- Symbol: strip non-alphanumeric, uppercase, max 20 chars — injection via symbol name unlikely.
- Token max 2048 chars.

---

## 3.11 Information disclosure

See F11. `info!` logs full inbound message text (`session.rs:115`) — may include tokens if client mis-sends.

---

## 3.12 Audit trail

- Connection open/close: `info!` with `conn_id`
- Auth success/failure: `info!` / `error!` with user_id
- Wallet broadcast: `info!` with user_id and payload debug
- Failed auth: logged with token prefix (bad)

---

## 3.13 Numeric / serialization safety

- Malformed Redis JSON: `warn!` and skip — **no panic**
- `ServerMessage` uses `serde_json::Value` for deposit/notification/chat/AI payloads — **no size cap** before fan-out beyond Redis message size

---

## 3.14 Multi-tenancy / scoping

- **Managers:** Not in admin id list; still receive **all deposit requests** as regular authenticated users (F1) — worst of both worlds.
- No tag/group filter anywhere in ws-gateway.

---

## 3.15 Reconnection

- **No replay** of missed messages; silent drop if offline.
- Reconnection storm: each conn spawns tasks + Redis/NATS shared — can stress CPU; no admission control (F3).

---

## 3.16 Test coverage

**No tests** in `backend/ws-gateway` (`#[test]` grep empty).

---

# 4. Strengths

- **JWT secret required** at startup (no empty default in ws-gateway).
- **Per-user index normalization** avoids common UUID dash/case mismatches for wallet/order/position.
- **Ticks filtered** by symbol subscription and `group_id` for marked prices.
- **`try_send` + bounded queue** prevents unbounded memory on slow clients; ticks dropped preferentially.
- **Call signaling** checks admin role and call participant ids before WebRTC relay.
- **AI chat** correctly user-scoped on NATS subject.
- **Inbound validation** for symbol count, channel allowlist, message size, call SDP bounds.

---

# 5. Trust Score Breakdown

| Dimension | Score | Justification |
|-----------|------:|---------------|
| Connection authentication | 4 | JWT OK; no auth timeout; no revoke |
| Subscription authorization | 5 | Auth-gated subscribe; symbols public |
| Per-user routing correctness | 6 | Good for most Redis events |
| Cross-user leakage resistance | 2 | Deposit broadcast critical |
| Admin channel isolation | 4 | Chat OK; deposits broken |
| Resource limits | 2 | Config unused |
| Audit trail | 5 | Verbose but token leakage |
| Test coverage | 1 | None |
| Error/panic safety | 7 | Malformed JSON handled |
| Information disclosure | 4 | Auth errors + logs |

**Harmonic mean ≈ 3.0 → Overall 3/10**

---

# 6. Production Go-Live Verdict

## 🔴 **Not ready**

Deposit events must not be delivered to trader connections. Unauthenticated connection handling and global broadcast paths are incompatible with a multi-tenant brokerage without immediate fixes (F1–F3).

---

# 7. Prioritized Fix List

| # | Finding | Effort | Risk | Sprint |
|---|---------|--------|------|--------|
| 1 | F1 — Admin-only `deposits:requests` | S | Critical PII leak | 1 |
| 2 | F2 — Admin-only second leg of `deposits:approved` | S | Balance leak | 1 |
| 3 | F3 — Auth deadline + max connections + per-IP cap | M | DoS | 1 |
| 4 | F4 — Periodic JWT revalidation / kick revoked users | M | Stale access | 2 |
| 5 | F5 — Scoped support chat to managers’ users | L | Cross-tenant chat | 2 |
| 6 | F6 — Role-check on AI report delivery | S | Defense in depth | 2 |
| 7 | F8 — Require userId on notifications | S | Mis-publish blast | 3 |
| 8 | F10 — Wire rate limiter | M | Abuse | 3 |
| 9 | Tests for routing matrix | L | Regressions | 3 |

---

# 8. Cross-Module Notes

| Module | Note |
|--------|------|
| **auth-service** | Publishes `deposits:requests` with `userId` — gateway must not fan out to traders |
| **auth-service JWT** | Impersonation tokens (auth F8) appear as normal JWTs here — full WS access as target user |
| **finance** | Deposit approve pushes Redis events consumed by F1/F2 paths |
| **order-engine** | Publishes `positions:updates` / `orders:updates` with `user_id` — gateway trusts field |
| **apps/gateway-ws** | Separate service also subscribes `wallet.balance.updated` on NATS — confirm production uses one gateway or both; avoid duplicate/conflicting routing |

---

*End of audit. Static analysis only.*
