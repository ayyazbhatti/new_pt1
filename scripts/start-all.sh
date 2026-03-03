#!/usr/bin/env bash
# Start infra, run migrations, then start all backend services and Vite.
# Prerequisite: Docker running (for Postgres, NATS, Redis).
set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Load .env so child processes get JWT_SECRET, DATABASE_URL, etc.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

echo "==> Starting infra (Postgres, Redis, NATS)..."
cd infra && docker-compose up -d && cd "$REPO_ROOT"

echo "==> Waiting for Postgres..."
for i in {1..30}; do
  if PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" psql -h localhost -U postgres -d newpt -c "SELECT 1" >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then echo "Postgres did not become ready."; exit 1; fi
  sleep 1
done

echo "==> Applying migrations..."
if [ -d "infra/migrations" ]; then
  shopt -s nullglob
  for f in infra/migrations/*.sql; do
    echo "  Applying $(basename "$f")..."
    PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" psql -h localhost -U postgres -d newpt -f "$f" || true
  done
  shopt -u nullglob 2>/dev/null || true
else
  echo "  (no infra/migrations directory, skipping)"
fi

echo "==> Starting auth-service (port 3000)..."
(cd "$REPO_ROOT/backend/auth-service" && cargo run --bin auth-service) &
AUTH_PID=$!

echo "==> Starting data-provider (port 3001)..."
(HTTP_PORT=3001 REDIS_URL="${REDIS_URL:-redis://localhost:6379}" NATS_URL="${NATS_URL:-nats://localhost:4222}" cd "$REPO_ROOT/backend/data-provider" && cargo run) &
DATA_PROVIDER_PID=$!

echo "==> Starting order-engine (port 3002)..."
(PORT=3002 DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/newpt}" REDIS_URL="${REDIS_URL:-redis://localhost:6379}" NATS_URL="${NATS_URL:-nats://localhost:4222}" cd "$REPO_ROOT" && cargo run -p order-engine) &
ORDER_ENGINE_PID=$!

echo "==> Starting core-api (port 3004)..."
(cargo run -p core-api) &
CORE_PID=$!

echo "==> Starting gateway-ws (port 3003, matches Vite proxy)..."
if [ -z "${JWT_SECRET:-}" ]; then
  echo "  WARNING: JWT_SECRET is not set. WebSocket auth will fail and real-time balance updates will not work."
  echo "  Set JWT_SECRET in .env (same value as auth-service) or export it before running this script."
fi
(PORT=3003 JWT_SECRET="${JWT_SECRET}" cargo run -p gateway-ws) &
GW_PID=$!

echo "==> Starting email-worker..."
(cargo run -p email-worker) &
EMAIL_PID=$!

echo "==> Starting Vite (port 5173)..."
npm run dev &
VITE_PID=$!

echo ""
echo "All started. PIDs: auth=$AUTH_PID data-provider=$DATA_PROVIDER_PID order-engine=$ORDER_ENGINE_PID core=$CORE_PID gateway=$GW_PID email=$EMAIL_PID vite=$VITE_PID"
echo "  App:          http://localhost:5173"
echo "  Auth API:     http://localhost:3000"
echo "  Data Provider:  http://localhost:3001/health"
echo "  Order Engine: http://localhost:3002/health"
echo "  Leads API:    http://localhost:3004"
echo "  WebSocket:    ws://localhost:3003/ws (proxied via Vite at ws://localhost:5173/ws)"
echo "To stop: kill $AUTH_PID $DATA_PROVIDER_PID $ORDER_ENGINE_PID $CORE_PID $GW_PID $EMAIL_PID $VITE_PID"
wait
