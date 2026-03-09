#!/bin/bash

# Restart only the data-provider service (backend/data-provider).
# Stops any process listening on data-provider ports (9003 WS, 9004 HTTP), then starts it again.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$REPO_ROOT/.env"
  set +a
fi

REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
NATS_URL="${NATS_URL:-nats://localhost:4222}"
DATA_PROVIDER_DIR="$REPO_ROOT/backend/data-provider"
WS_PORT=9003
HTTP_PORT=9004

# Kill process(es) using data-provider ports (avoid matching this script's path)
kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Stopping process(es) on port $port: $pids"
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 2
    # Force kill if still running
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
  fi
}

echo "==> Restarting data-provider (WS $WS_PORT, HTTP $HTTP_PORT)..."
kill_port $HTTP_PORT
kill_port $WS_PORT
sleep 1

echo "==> Starting data-provider..."
(WS_PORT=$WS_PORT HTTP_PORT=$HTTP_PORT REDIS_URL="$REDIS_URL" NATS_URL="$NATS_URL" cd "$DATA_PROVIDER_DIR" && cargo run) &
DATA_PROVIDER_PID=$!
echo "Data-provider started with PID $DATA_PROVIDER_PID"
echo "  WS:   ws://localhost:$WS_PORT"
echo "  Health: http://localhost:$HTTP_PORT/health"
echo "To stop: kill $DATA_PROVIDER_PID"
