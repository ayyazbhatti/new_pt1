# Gateway WebSocket – Postman testing

Use this to test the **gateway-ws** connection (balance, wallet, positions, orders) in Postman.

---

## Quick test: realtime balance for one user

To test realtime balance for **mawetyzo@mailinator.com**:

1. **Get a JWT for that user**
   - **POST** `http://localhost:3000/api/auth/login`  
     (Auth service default port is 3000; use your app’s API base if different.)
   - Body (JSON):  
     `{ "email": "mawetyzo@mailinator.com", "password": "<that user's password>" }`
   - From the response, copy `accessToken`.

2. **WebSocket URL** (use the one where gateway-ws is running):
   - **If you use `scripts/start-all.sh` or Vite proxy:**  
     `ws://localhost:8090/ws?group=default`
   - **If gateway runs with default PORT (e.g. `cargo run -p gateway-ws`):**  
     `ws://localhost:3003/ws?group=default`

3. **In Postman:** Connect to that URL, then send:
   - Auth: `{"type":"auth","token":"<paste accessToken here>"}`
   - Subscribe: `{"type":"subscribe","symbols":[],"channels":["balances","wallet"]}`

4. Trigger a balance change (e.g. approve a deposit for that user); you should see a `wallet.balance.updated` message.

---

## 0. Gateway-ws configuration (required for auth)

For WebSocket auth (and thus real-time balance) to work, **gateway-ws** must be started with **`JWT_SECRET`** set to the **same value** as auth-service.

- Example: `export JWT_SECRET=dev-jwt-secret-key-change-in-production-minimum-32-characters-long`
- If you use `scripts/start-all.sh`, ensure `JWT_SECRET` is in your environment or source a `.env` that auth-service uses before running.

---

## 1. WebSocket URL

| Environment | URL |
|-------------|-----|
| **Direct to gateway** | `ws://localhost:8090/ws?group=default` |
| **Via Vite proxy (dev)** | `ws://localhost:5173/ws?group=default` (or your Vite host/port) |
| **Override** | Set `VITE_WS_URL` in frontend; use that same URL in Postman |

Default gateway port in code is **3003** (`PORT` env); your Vite proxy may point to **8090**. Use the URL where **gateway-ws** is actually running.

---

## 2. Get a JWT (for auth)

You need a valid access token from your auth API, e.g.:

- **POST** `http://localhost:<auth-api-port>/auth/login` (or your login endpoint)  
  Body (JSON): `{ "email": "user@example.com", "password": "..." }`
- Use the `accessToken` (or `token`) from the response in step 4.

---

## 3. In Postman

1. **New request** → change method to **WebSocket**.
2. **Enter URL**: e.g. `ws://localhost:8090/ws?group=default`.
3. Click **Connect**. After connection, you can send messages in the **Message** section.

---

## 4. Messages to send (in order)

### 4.1 Authenticate (send first after connect)

**Format:** JSON text frame.

```json
{
  "type": "auth",
  "token": "<YOUR_JWT_ACCESS_TOKEN>"
}
```

Alternative (legacy):

```json
{
  "op": "auth",
  "token": "<YOUR_JWT_ACCESS_TOKEN>"
}
```

**Expected response:**

```json
{
  "type": "auth_success",
  "user_id": "<uuid>",
  "group_id": "default"
}
```

On invalid token you may get:

```json
{
  "type": "auth_error",
  "error": "..."
}
```

---

### 4.2 Subscribe to balance / wallet (optional, for balance updates)

Send **after** you receive `auth_success`:

```json
{
  "type": "subscribe",
  "symbols": [],
  "channels": ["balances", "wallet"]
}
```

- `channels`: `["balances", "wallet"]` for balance/wallet updates.
- You can also add `"positions"`, `"orders"` if your gateway supports them.

No specific “subscribed” response is required for these channels; balance updates will arrive as `wallet.balance.updated`.

---

## 5. Incoming events (examples)

**Balance update (when balance changes):**

```json
{
  "type": "wallet.balance.updated",
  "payload": {
    "userId": "<user-uuid>",
    "balance": 12345.67,
    "available": 12000.00,
    "locked": 345.67,
    "currency": "USD",
    "equity": 12345.67,
    "margin_used": 0,
    "free_margin": 12345.67
  }
}
```

**Tick (if you subscribed to symbols):**

```json
{
  "type": "tick",
  "payload": {
    "symbol": "BTCUSD",
    "bid": 50000,
    "ask": 50001,
    ...
  }
}
```

---

## 6. Quick checklist

| Step | Action |
|------|--------|
| 1 | Start **gateway-ws** (e.g. `PORT=8090` or default 3003). |
| 2 | Get JWT from login API. |
| 3 | Postman: New WebSocket request → URL `ws://localhost:<port>/ws?group=default` → Connect. |
| 4 | Send: `{"type":"auth","token":"<JWT>"}`. |
| 5 | Wait for: `{"type":"auth_success", ...}`. |
| 6 | Send: `{"type":"subscribe","symbols":[],"channels":["balances","wallet"]}`. |
| 7 | Trigger a balance change (e.g. deposit approval); you should see `wallet.balance.updated` in the WebSocket. |

---

## 7. Notes

- **Query param:** `?group=default` is accepted by the gateway; frontend sends it.
- **Auth:** gateway-ws accepts both `type: "auth"` and `op: "auth"` with `token`.
- **Subscription:** Balance updates are pushed to sessions that are authenticated and (in the current gateway) subscribed to the right channels; subscribing to `balances` and `wallet` matches the frontend.
