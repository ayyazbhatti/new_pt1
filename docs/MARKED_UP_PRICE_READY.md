# Marked-up price: ready to use

Setup is complete so that **marked-up bid/ask prices** are shown in the user terminal (left symbol list and right trading panel) for users in groups with a price profile that has markup.

## What was done

1. **Gateway (backend/ws-gateway)**
   - Uses the **same JWT_SECRET** as auth-service (see `backend/ws-gateway/.env`).
   - Correctly decodes `user_id` and `group_id` from the JWT and sends **per-group** bid/ask from Redis `price:ticks`.
   - Group ID matching is normalized (UUID with/without dashes) so your group’s prices are always selected.
   - Empty `channels` in subscribe is allowed (price-only subscription).

2. **Start script (`scripts/start-all-servers.sh`)**
   - Starts **backend/ws-gateway** (not apps/gateway-ws) so the gateway reads from Redis and uses JWT `group_id`.
   - Starts **backend/data-provider** so it publishes per-group marked-up ticks to Redis `price:ticks`.
   - Ensures Gateway gets `JWT_SECRET` and `WS_PORT=3003`.

3. **Auth**
   - Auth-service already puts `group_id` in the JWT; the gateway now uses it for price routing.

## How to see marked-up prices

1. **Start all servers** (from project root):
   ```bash
   ./scripts/start-all-servers.sh
   ```
   This starts Redis, Postgres, NATS, auth-service, **backend data-provider**, **backend ws-gateway**, order-engine, core-api, and frontend.

2. **Log in** as a user in a group with markup, e.g.:
   - **pinycugumi@mailinator.com** (group **G1**, profile **p1**, 5% markup on BTCUSDT and ADAUSDT).

3. **Open the terminal** (trading view). The **left symbol list** and **right trading panel** show **live marked-up bid/ask** (e.g. ~5% above raw for symbols with that markup).

## Optional: verify with the test script

With **backend ws-gateway** and **backend data-provider** running:

1. Get a fresh JWT: `POST http://localhost:3000/api/auth/login` (or your auth URL) with body `{"email":"pinycugumi@mailinator.com","password":"YOUR_PASSWORD"}`.
2. Put the `accessToken` value into `scripts/test-price-ws.js` as `TOKEN`.
3. Run: `node scripts/test-price-ws.js`

If you see **“Yes: WebSocket is returning MARKED-UP prices”** and bid/ask ~5% above Binance, the flow is working.

## If you run services by hand

- **Gateway:** `cd backend/ws-gateway && ./target/release/ws-gateway` (loads `.env` there; ensure `JWT_SECRET` matches auth-service).
- **Data-provider:** `cd backend/data-provider && cargo run --release` (needs Redis; publishes `price:ticks` with per-group markup).
- **Auth-service:** must be running so login returns a JWT with `group_id`.

You’re ready to see marked-up prices in the terminal once these are running and you’re logged in as a user in a group with a markup profile.
