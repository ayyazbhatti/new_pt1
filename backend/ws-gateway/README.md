# ws-gateway

Real-time WebSocket server (ticks, account summary, chat, etc.). Must use the **same `JWT_SECRET` and `JWT_ISSUER`** as `auth-service`, or the browser will show WebSocket auth errors such as **`InvalidSignature`**.

## Local dev (recommended)

From repo root (loads `.env` and `backend/auth-service/.env` so JWT matches auth):

```bash
chmod +x scripts/run-ws-gateway-dev.sh   # once
./scripts/run-ws-gateway-dev.sh
```

Defaults: `WS_PORT=3003`, `HTTP_PORT=9002`, `REDIS_URL=redis://127.0.0.1:6379`.

`cargo run` from this crate loads **`../auth-service/.env` first** and **overrides** `JWT_SECRET` / `JWT_ISSUER` from that file so they match auth-service even when your IDE or shell injects a different `JWT_SECRET` (a common cause of WebSocket `InvalidSignature`).

## After changing `JWT_SECRET`

1. Restart **auth-service** with the new secret.
2. Restart **ws-gateway** with the **identical** secret.
3. **Log out and log in** in the app (or clear tokens) so the access token is re-signed with the new secret.
