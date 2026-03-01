# Why Orders Are Not Executing – Checklist

## Order flow (summary)

1. **User** places order → **auth-service** `POST /api/orders` (or `/v1/orders`).
2. **Auth-service** publishes to **NATS** subject `cmd.order.place` (JetStream + basic pub/sub).
3. **Order-engine** subscribes to `cmd.order.place`, receives the message, stores order as **pending** (Redis + in-memory cache), publishes `event.order.accepted`.
4. **Market orders** are filled when a **tick** arrives:
   - **Data-provider** publishes ticks to **NATS** (`ticks.SYMBOL` or `ticks.SYMBOL.GROUP_ID`) every ~100ms.
   - **Order-engine** subscribes to `ticks.>`, receives ticks, updates last-tick cache, and **fills pending market orders** for that symbol in `tick_handler`.
5. Order-engine publishes `evt.order.updated` (status FILLED); auth-service and core-api react to that.

So for orders to **execute** (fill) you need:

- Auth-service **and** order-engine **and** data-provider all using the **same NATS**.
- Auth-service successfully publishing `cmd.order.place`.
- Data-provider successfully publishing ticks (e.g. `ticks.BTCUSDT`).
- Order-engine receiving both command and ticks.

---

## Most likely causes

### 1. Data-provider not connected to NATS (no ticks)

If data-provider fails to connect to NATS at startup, it logs:

`⚠️ Failed to connect to NATS. Tick publishing to order-engine will be disabled.`

Then it **never** publishes to `ticks.*`. Order-engine never gets ticks, so **market orders stay pending** and never fill.

**Check:** Start data-provider and look for `✅ Connected to NATS`. If you see the warning above, fix NATS (e.g. start NATS, correct `NATS_URL`).

**Fix:** Ensure NATS is running (e.g. port 4222) and `NATS_URL` is set the same for data-provider (e.g. `nats://127.0.0.1:4222` or `nats://localhost:4222`).

### 2. Auth-service not connected to NATS (place order never reaches order-engine)

If auth-service fails to connect to NATS, it still starts but **publish** in `place_order` will fail. The user would get a **500** when placing an order (order not created). If the user **does** see “order created” with status PENDING, then auth-service **is** publishing; the problem is downstream (order-engine or ticks).

**Check:** On startup, look for `✅ Connected to NATS`. When placing an order, look for `📤 Publishing order command to NATS` and `✅ Published to NATS (basic pub/sub)`.

### 3. Order-engine not connected to NATS (no commands or no ticks)

If order-engine fails to connect to NATS, it exits (main returns error). So if the process is running and health returns 200, it is connected. If it’s connected but **subscriptions** are wrong or JetStream is misconfigured, it might not receive messages.

**Check:** On startup, look for `✅ Subscribed to ticks.>` and `🔄 Place order handler started (basic pub/sub) - waiting for messages on cmd.order.place`. When an order is placed, you should see `📨 NATS message received` and `🚀 Calling handle_place_order()` in order-engine logs.

### 4. Different NATS URL or no NATS

If auth-service, order-engine, or data-provider use a different `NATS_URL` (e.g. one uses `nats://localhost:4222`, another a different host/port), or one of them has no NATS at all, then:

- Commands or ticks are published to a different broker (or nowhere), and order-engine never sees them.

**Check:** Ensure all three use the **same** `NATS_URL` (e.g. `nats://127.0.0.1:4222`). Restart each service after fixing.

### 5. Symbol / group mismatch (less common)

Order-engine fills a pending order when a tick arrives for the **same symbol** (and, for per-group ticks, same group_id). If the order’s symbol or group_id doesn’t match how data-provider publishes (e.g. symbol case, or group_id empty vs set), that order might never get a matching tick. Usually symbol is the same (e.g. BTCUSDT) if the UI and data-provider use the same convention.

---

## Quick checks

| Check | How |
|-------|-----|
| NATS running | `lsof -i :4222` or `nc -zv localhost 4222` |
| Auth-service NATS | Startup log: `✅ Connected to NATS` |
| Data-provider NATS | Startup log: `✅ Connected to NATS` (if you see the “Tick publishing disabled” warning, ticks are off) |
| Order-engine receiving place | When you place an order, order-engine log: `📨 NATS message received` then `🚀 Calling handle_place_order()` |
| Order-engine receiving ticks | Order-engine subscribes to `ticks.>`; no per-tick log by default, but if no ticks, market orders never fill |
| Same NATS_URL | Same value in auth-service, data-provider, and order-engine (e.g. in `.env` or start script) |

---

## What to do

1. **Confirm NATS is running** on the expected port (e.g. 4222).
2. **Restart data-provider** and confirm log: `✅ Connected to NATS`. If it’s not connected, fix NATS or `NATS_URL` and restart.
3. **Place a market order** (e.g. BTCUSDT) and watch:
   - **Auth-service:** `📤 Publishing order command to NATS` and `✅ Published to NATS (basic pub/sub)`.
   - **Order-engine:** `📨 NATS message received` and `🚀 Calling handle_place_order()`; then either immediate fill log or tick_handler filling on next tick.
4. If auth-service never logs the publish, fix auth-service NATS. If order-engine never logs receipt, fix order-engine NATS or subscription. If order-engine receives the order but it never fills, the usual cause is **no ticks** → fix data-provider NATS and ensure it publishes to `ticks.SYMBOL` (or `ticks.SYMBOL.GROUP_ID`).

---

## Summary

- **Orders not executing** usually means **market orders stay PENDING** because **no price ticks** reach the order-engine.
- The most common cause is **data-provider not connected to NATS**, so it never publishes ticks and the order-engine never has a chance to fill.
- Ensure **NATS is running**, **NATS_URL is identical** for auth-service, data-provider, and order-engine, and **data-provider logs “Connected to NATS”**; then place a test order and follow the logs as above.
