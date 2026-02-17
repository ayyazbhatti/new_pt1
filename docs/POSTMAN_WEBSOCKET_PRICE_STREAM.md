# Test price stream WebSocket in Postman

The terminal uses **ws://localhost:3003/ws** (gateway). You must **auth first**, then **subscribe** to symbols to receive live bid/ask ticks.

---

## 1. Get a JWT (HTTP in Postman)

1. **POST** `http://localhost:5173/api/auth/login` (or your auth base URL, e.g. `http://localhost:8080/api/auth/login` if auth-service is on 8080).
2. Body (JSON):
   ```json
   {
     "email": "pinycugumi@mailinator.com",
     "password": "YOUR_PASSWORD"
   }
   ```
3. From the response, copy `accessToken` (or `access_token`).

---

## 2. Open WebSocket in Postman

1. **New** → **WebSocket Request**.
2. **URL:** `ws://localhost:3003/ws`
3. Click **Connect**.

---

## 3. Send messages (in order)

### Step A – Auth (send first after connect)

In the message box, send this JSON (replace `YOUR_JWT` with the token from step 1):

```json
{"type":"auth","token":"YOUR_JWT"}
```

You should receive something like:

```json
{"type":"auth_success","user_id":"9588b879-ba31-4631-81e8-60b15b3d86cc","group_id":"2b5d78a7-4b78-423a-b093-ee82def43121"}
```

If auth fails you’ll get `{"type":"auth_error","error":"..."}`.

---

### Step B – Subscribe to symbols (send after auth_success)

Send:

```json
{"type":"subscribe","symbols":["BTCUSDT","ETHUSDT"],"channels":[]}
```

You should see a **subscribed** message, then **tick** messages with live bid/ask:

```json
{"type":"tick","symbol":"BTCUSDT","bid":"97500.50","ask":"97501.00","ts":1739780123456}
{"type":"tick","symbol":"ETHUSDT","bid":"3650.25","ask":"3650.75","ts":1739780123456}
```

---

## 4. Optional messages

- **Unsubscribe:**
  ```json
  {"type":"unsubscribe","symbols":["ETHUSDT"]}
  ```

- **Ping (keep-alive):**
  ```json
  {"type":"ping"}
  ```
  Server responds with `{"type":"pong"}`.

---

## Summary

| Step | Send |
|------|------|
| 1 | Get JWT via `POST /api/auth/login` |
| 2 | Connect to `ws://localhost:3003/ws` |
| 3 | Send `{"type":"auth","token":"<JWT>"}` |
| 4 | After `auth_success`, send `{"type":"subscribe","symbols":["BTCUSDT","ETHUSDT"],"channels":[]}` |
| 5 | Read incoming `{"type":"tick",...}` messages for live bid/ask |

Ensure **ws-gateway** is running on port 3003 and **data-provider** is publishing prices to Redis so ticks arrive.

**Important:** The gateway must use the **same `JWT_SECRET`** as the auth-service. If they differ, token validation can fail or the gateway may not decode `group_id` correctly, and you won’t get per-group (marked-up) prices. Copy `JWT_SECRET` from `backend/auth-service/.env` into `backend/ws-gateway/.env` or set it in the environment when starting the gateway. See `backend/ws-gateway/.env.example`.
