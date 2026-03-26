# Local Startup (Short)

## Terminal 1 - Infra
Use case: start required containers (Postgres, Redis, NATS).

```bash
cd /c/data/Projects/dTrader/new_pt1
docker compose -f infra/docker-compose.yml up -d
```

## Terminal 2 - Auth Service
Use case: login/auth APIs on port `3000`.

```bash
cd /c/data/Projects/dTrader/new_pt1/backend/auth-service
cargo run --bin auth-service
```

## Terminal 3 - Data Provider
Use case: market price feed + provider APIs.

```bash
cd /c/data/Projects/dTrader/new_pt1/backend/data-provider
cargo run
```

## Terminal 4 - WS Gateway
Use case: websocket bridge for live stream clients.

```bash
cd /c/data/Projects/dTrader/new_pt1/backend/ws-gateway
WS_PORT=3003 HTTP_PORT=9002 cargo run
```

## Terminal 5A - Order Engine
Use case: order processing service.

```bash
cd /c/data/Projects/dTrader/new_pt1
PORT=3002 cargo run -p order-engine
```

## Terminal 5B - Core API
Use case: core backend API service.

```bash
cd /c/data/Projects/dTrader/new_pt1
PORT=3004 cargo run -p core-api
```

## Terminal 5C - Frontend
Use case: UI app for login and terminal.

```bash
cd /c/data/Projects/dTrader/new_pt1
npm run dev
```

## Quick Checks
Use case: verify services are live.

```bash
curl http://localhost:3000/health
curl http://localhost:9002/health
curl http://localhost:9004/health
curl http://localhost:3002/health
```

App URL: `http://localhost:5173/login`

## Stop All Services
Use case: stop local stack quickly.

- In each running terminal: press `Ctrl + C`.
- Stop infra containers:

```bash
cd /c/data/Projects/dTrader/new_pt1
docker compose -f infra/docker-compose.yml down
```

## One-shot Start (PowerShell)
Use case: start everything in one command (no `/bin/bash`).

```powershell
cd C:\data\Projects\dTrader\new_pt1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-all-once.ps1
```

Notes:
- If ports are already in use, stop old terminals first (`Ctrl + C`) before re-running.
- Logs are written to `deploy/logs/`.

What `start-all-once.ps1` does (very short):
- Starts containers via `infra/docker-compose.yml` (Postgres/Redis/NATS)
- Waits for Postgres readiness
- Applies `infra/migrations/*.sql` inside the Postgres container (uses `docker exec`, no host `psql` needed)
- Starts `auth-service`, `ws-gateway`, `data-provider`, `order-engine`, `core-api`, and the `frontend`
- Writes logs to `deploy/logs/*.out.log` and `deploy/logs/*.err.log`
