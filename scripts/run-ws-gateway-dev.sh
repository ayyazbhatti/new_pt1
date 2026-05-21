#!/usr/bin/env bash
# Start ws-gateway with the same JWT_* and REDIS_URL as local auth-service.
# InvalidSignature on WebSocket auth almost always means JWT_SECRET (or ISSUER) ≠ auth-service.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f .env ]; then set -a && . ./.env && set +a; fi
if [ -f backend/auth-service/.env ]; then set -a && . ./backend/auth-service/.env && set +a; fi

export WS_PORT="${WS_PORT:-3003}"
export HTTP_PORT="${HTTP_PORT:-9002}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export JWT_ISSUER="${JWT_ISSUER:-newpt}"

if [ -z "${JWT_SECRET:-}" ] || [ "${#JWT_SECRET}" -lt 32 ]; then
  echo "error: JWT_SECRET must be set (≥32 chars) and match auth-service exactly." >&2
  echo "  Copy backend/auth-service/.env.example → backend/auth-service/.env, or export JWT_SECRET." >&2
  exit 1
fi

echo "==> ws-gateway WS_PORT=$WS_PORT HTTP_PORT=$HTTP_PORT JWT_ISSUER=$JWT_ISSUER (JWT_SECRET length=${#JWT_SECRET})"
exec cargo run --manifest-path "$REPO_ROOT/backend/ws-gateway/Cargo.toml"
