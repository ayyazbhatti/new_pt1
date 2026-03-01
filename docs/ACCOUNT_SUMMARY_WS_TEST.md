# Account summary WebSocket – test reference

## Which WebSocket is used for account metrics

Account metrics (balance, equity, margin, PnL) use the **same WebSocket as the rest of the app**: the **gateway-ws** connection. There is no separate WS for account summary.

- **Client:** `src/shared/ws/wsClient.ts` (singleton `wsClient`)
- **URL (dev):** `ws://${location.host}/ws?group=default` → Vite proxies `/ws` to **ws://localhost:3003**
- **URL (direct, no Vite):** `ws://localhost:3003/ws?group=default`
- **Server:** `apps/gateway-ws` (port **3003**)

The frontend listens on that single connection for the event type **`account.summary.updated`** and updates the account summary UI from the payload.

---

## Event you receive (for testing)

**Type:** `account.summary.updated`  
**Full message shape:**

```json
{
  "type": "account.summary.updated",
  "payload": {
    "userId": "23754218-4cc2-481c-b484-5640f80dc46c",
    "balance": 10000.0,
    "equity": 10500.0,
    "marginUsed": 500.0,
    "freeMargin": 10000.0,
    "marginLevel": "2100",
    "marginCallLevelThreshold": 50.0,
    "stopOutLevelThreshold": 20.0,
    "realizedPnl": 0.0,
    "unrealizedPnl": 500.0,
    "updatedAt": "2026-02-28T00:15:00.000Z"
  }
}
```

The frontend accepts both **camelCase** (above) and **snake_case** (e.g. `user_id`, `margin_used`, `free_margin`, `realized_pnl`, `unrealized_pnl`, `updated_at`).

---

## How to test

### 1. Connect and auth (required)

The gateway only sends `account.summary.updated` to **authenticated** sessions. You must:

1. **Connect:** `ws://localhost:3003/ws?group=default` (or via Vite: `ws://localhost:5173/ws?group=default`)
2. **Authenticate:** send a message with your JWT:
   ```json
   { "type": "auth", "token": "<your_access_token>" }
   ```
3. Wait for: `{ "type": "auth_success", "user_id": "<uuid>", "group_id": "..." }`

Get `<your_access_token>` from the app (e.g. login in the UI and copy from devtools/Network or from localStorage).

### 2. Receive real account summary updates

Once authenticated, the **server** will push `account.summary.updated` when:

- Auth-service recomputes summary (e.g. on Redis `price:ticks` for your open positions) and publishes to Redis `account:summary:updated`
- Gateway-ws subscribes to that channel and forwards to your connection (matching `payload.userId` to your session `user_id`)

So with the app and backend running, open the trading UI, ensure you’re logged in and have a WS connection; you should see `account.summary.updated` in the browser console (see `[wsClient] Message type: account.summary.updated`).

### 3. Simulate an update (manual test)

You cannot inject a fake `account.summary.updated` from the browser because the gateway only forwards messages it receives from Redis; it doesn’t accept that event from clients.

To simulate:

**Option A – Backend:** Publish a message to Redis channel `account:summary:updated` with the JSON payload (same shape as above). Any subscriber (e.g. gateway-ws) will receive it and forward to the matching user’s WS sessions.

Example with Redis CLI:

```bash
# In redis-cli, publish a test message (replace USER_ID with your real user UUID)
PUBLISH account:summary:updated '{"userId":"YOUR-USER-UUID","balance":9999,"equity":10500,"marginUsed":500,"freeMargin":9499,"marginLevel":"2100","realizedPnl":0,"unrealizedPnl":500,"updatedAt":"2026-02-28T00:15:00.000Z"}'
```

**Option B – Browser console:** If the WS is already open and you have a handler that calls `queryClient.setQueryData`, you could temporarily patch the handler to also run when you broadcast a custom object – but the normal path is: backend publishes to Redis → gateway forwards to your WS → frontend receives `account.summary.updated` and updates the UI.

---

## Quick checklist

| Item | Value |
|------|--------|
| WS URL (dev, via Vite) | `ws://localhost:5173/ws?group=default` |
| WS URL (direct to gateway) | `ws://localhost:3003/ws?group=default` |
| Server | `apps/gateway-ws` (port **3003**) |
| Event type | `account.summary.updated` |
| Auth | Send `{ "type": "auth", "token": "<JWT>" }` after connect |
| Payload | See JSON above; camelCase or snake_case both work |

Using **wscat** (install: `npm i -g wscat`):

```bash
# Connect (replace with your JWT)
wscat -c "ws://localhost:3003/ws?group=default"

# After connection, send:
# {"type":"auth","token":"YOUR_JWT_HERE"}

# You should see auth_success, then account.summary.updated when backend pushes.
```
