# Account Metrics Real-Time Not Showing – Root Cause Analysis

## How real-time is supposed to work

1. **Auth-service** computes account summary and publishes to **Redis** channel `account:summary:updated` (JSON payload with `userId`, balance, equity, margin, etc.).
2. **Ws-gateway** subscribes to Redis `account:summary:updated`; when a message arrives it looks up WebSocket connections for that `userId` and sends `account.summary.updated` to the browser.
3. **Frontend** `useAccountSummary` subscribes to `wsClient`; on `account.summary.updated` it updates the React Query cache so Balance, Equity, Margin, etc. re-render.

**When auth-service publishes:**
- Order filled/canceled (NATS `evt.order.updated`)
- Position opened/updated/closed (NATS `evt.position.updated`, `event.position.closed`)
- Price ticks (Redis `price:ticks`) for users with open positions → unrealized PnL
- Deposit/withdrawal flows

---

## Most likely root causes

### 1. **Auth-service and ws-gateway using different Redis**
- Auth-service publishes to `REDIS_URL` (default `redis://127.0.0.1:6379`).
- Ws-gateway subscribes to `REDIS_URL` (same default).
- If one service uses a different `.env` (e.g. Docker Redis vs local), they are on different instances and the gateway never sees the publish.
- **Check:** Ensure both use the same `REDIS_URL` (e.g. both `redis://127.0.0.1:6379` or both `redis://localhost:6379`).

### 2. **NATS not connected (auth-service)**
- Order and position events come from NATS. If auth-service fails to connect to NATS, it never runs `compute_and_cache_account_summary` on trade/position changes.
- On startup you should see either `✅ Connected to NATS` or `⚠️ Failed to connect to NATS...`.
- **Check:** Auth-service logs for NATS connection. If NATS is down, real-time updates on order/position events will not happen (REST and 5s refetch still work).

### 3. **WebSocket connection not registered for the user**
- Gateway only sends `account.summary.updated` to connections that have **authenticated** (received `auth_success`).
- If JWT is invalid or **ws-gateway uses a different `JWT_SECRET`** than auth-service, auth fails and the connection is never registered for that `user_id`, so the gateway has no one to send to.
- **Check:** Same `JWT_SECRET` (and `JWT_ISSUER`) on auth-service and ws-gateway. In browser DevTools → Network → WS, confirm you see `auth_success` after connect.

### 4. **Port / proxy**
- Frontend in dev uses `ws://${location.host}/ws` → Vite proxies `/ws` to **localhost:3003**.
- If ws-gateway is not bound to **3003** (e.g. default 9001), the proxy talks to the wrong port and the real gateway never gets the connection.
- **Check:** Start ws-gateway with `WS_PORT=3003` (and `HTTP_PORT=9002` if you use health on a separate port). Confirm nothing else is using 3003.

### 5. **No triggers (only 5s polling)**
- Summary is only **recomputed and published** when: order/position events (NATS), price ticks (Redis), or deposit/withdrawal.
- If the user has **no open positions**, price ticks do not trigger a publish for that user, so the only updates are the frontend’s **refetch every 5s** (`refetchInterval: 5000` in `useAccountSummary`). That can feel “not real-time.”
- **Check:** With an open position, move price (or wait for a tick); auth-service should log `✅ Published account summary to Redis` and the UI should update without waiting 5s.

### 6. **Gateway receives but finds 0 connections (silent)**
- In `broadcast_account_summary`, the gateway gets `user_id` from the payload and calls `get_user_connections(user_id)`. If the list is empty (e.g. user never authenticated on this gateway, or `user_id` format mismatch after normalization), it sends to no one and there is **no log**.
- **Check:** Add a log when `connections.is_empty()` (see suggested fix below) and restart gateway; if you see it when you expect an update, the issue is registration or `user_id` format.

---

## Verification checklist

| Check | How |
|-------|-----|
| Same Redis | Same `REDIS_URL` in auth-service and ws-gateway (e.g. both `redis://127.0.0.1:6379`). |
| NATS up | Auth-service logs `✅ Connected to NATS`. |
| JWT match | Same `JWT_SECRET` (and issuer) on auth-service and ws-gateway. |
| Gateway port | Ws-gateway started with `WS_PORT=3003`; Vite proxy targets `localhost:3003`. |
| WS auth | In browser, WebSocket frame shows `auth_success` after connect. |
| Auth publish | When you trade or have positions and ticks flow, auth-service logs `✅ Published account summary to Redis`. |
| Frontend event | In console, you see `[wsClient] Message type: account.summary.updated` when an update is pushed. |

---

## Suggested code change (gateway) – log when no connections

In `backend/ws-gateway/src/stream/broadcaster.rs`, in `broadcast_account_summary`, after `let connections = registry.get_user_connections(user_id);` add:

```rust
if connections.is_empty() {
    warn!("⚠️ account.summary.updated: no WebSocket connections for user_id={}", user_id);
} else {
    info!("📤 Sending account.summary.updated to {} connection(s) for user_id={}", connections.len(), user_id);
}
```

This confirms whether the gateway is receiving the Redis message but has no registered connection for that user (e.g. auth or `user_id` mismatch).

---

## Summary

- **No port conflict** in the code: gateway is intended to run on 3003 for Vite proxy; both services default to the same Redis URL.
- Most likely causes: **different Redis** between auth and gateway, **NATS not connected**, **JWT mismatch** so WS never registers, or **no publish triggers** (no positions/orders/ticks) so you only see 5s refetch.
- Use the checklist and the extra logging above to see whether the break is: auth not publishing, gateway not receiving, gateway not sending (0 connections), or frontend not handling the event.
