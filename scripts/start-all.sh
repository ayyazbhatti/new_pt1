#!/usr/bin/env bash
# Start infra, run migrations, then start all backend services and Vite.
# Prerequisite: Docker running (for Postgres, NATS, Redis).
set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Load .env so child processes get JWT_SECRET, DATABASE_URL, etc.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# Default env for services
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/newpt}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export NATS_URL="${NATS_URL:-nats://localhost:4222}"
export JWT_SECRET="${JWT_SECRET:-dev-jwt-secret-key-change-in-production-minimum-32-characters-long}"
export JWT_ISSUER="${JWT_ISSUER:-newpt}"

echo "==> Starting infra (Postgres, Redis, NATS)..."
cd infra && docker compose up -d 2>/dev/null || docker-compose up -d 2>/dev/null || true
cd "$REPO_ROOT"

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
  shopt -s nullglob 2>/dev/null || true
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

echo "==> Starting ws-gateway (WS 3003, health 9002)..."
(WS_PORT=3003 HTTP_PORT=9002 REDIS_URL="$REDIS_URL" JWT_SECRET="$JWT_SECRET" JWT_ISSUER="$JWT_ISSUER" cd "$REPO_ROOT/backend/ws-gateway" && cargo run) &
GW_PID=$!

echo "==> Starting data-provider (WS 9003, HTTP 9004)..."
(WS_PORT=9003 HTTP_PORT=9004 REDIS_URL="$REDIS_URL" NATS_URL="$NATS_URL" cd "$REPO_ROOT/backend/data-provider" && cargo run) &
DATA_PROVIDER_PID=$!

echo "==> Starting order-engine (port 3002)..."
(PORT=3002 REDIS_URL="$REDIS_URL" NATS_URL="$NATS_URL" cd "$REPO_ROOT" && cargo run -p order-engine) &
ORDER_ENGINE_PID=$!

echo "==> Starting core-api (port 3004)..."
(PORT=3004 DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" NATS_URL="$NATS_URL" cd "$REPO_ROOT" && cargo run -p core-api) &
CORE_PID=$!

echo "==> Starting Vite (port 5173)..."
npm run dev &
VITE_PID=$!

echo ""
echo "All started. PIDs: auth=$AUTH_PID ws-gateway=$GW_PID data-provider=$DATA_PROVIDER_PID order-engine=$ORDER_ENGINE_PID core=$CORE_PID vite=$VITE_PID"
echo "  App:           http://localhost:5173"
echo "  Auth API:      http://localhost:3000"
echo "  WS Gateway:    ws://localhost:3003/ws, health http://localhost:9002/health"
echo "  Data Provider: ws://localhost:9003, health http://localhost:9004/health"
echo "  Order Engine:  http://localhost:3002/health"
echo "  Core API:      http://localhost:3004"
echo "To stop: kill $AUTH_PID $GW_PID $DATA_PROVIDER_PID $ORDER_ENGINE_PID $CORE_PID $VITE_PID"
wait
