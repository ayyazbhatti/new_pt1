#!/usr/bin/env bash
set -euo pipefail

# Host-level watchdog for data-provider freshness.
# Intended for cron/systemd on production server.
#
# Default target is frontend nginx proxy on host port 8080:
#   http://127.0.0.1:8080/dp/health/fresh
#
# Exit codes:
#   0 -> fresh/healthy
#   1 -> stale and restart failed
#   2 -> endpoint unreachable/invalid response

APP_DIR="${APP_DIR:-/opt/newpt}"
DEPLOY_DIR="${DEPLOY_DIR:-$APP_DIR/deploy}"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/.env.production}"
FRESH_URL="${FRESH_URL:-http://127.0.0.1:8080/dp/health/fresh}"
MAX_AGE_BINANCE_SECS="${MAX_AGE_BINANCE_SECS:-120}"
MAX_AGE_MMDPS_SECS="${MAX_AGE_MMDPS_SECS:-180}"

COMPOSE=(docker compose -f "$DEPLOY_DIR/docker-compose.prod.yml" --env-file "$ENV_FILE")

json="$(curl -fsS --max-time 10 "$FRESH_URL" || true)"
if [[ -z "$json" ]]; then
  echo "[feed-watchdog] ERROR: freshness endpoint unreachable: $FRESH_URL"
  exit 2
fi

status="$(
python3 - <<'PY' "$json" "$MAX_AGE_BINANCE_SECS" "$MAX_AGE_MMDPS_SECS"
import json, sys

raw = sys.argv[1]
max_bin = int(sys.argv[2])
max_mmdps = int(sys.argv[3])

try:
    data = json.loads(raw)
except Exception:
    print("invalid_json")
    raise SystemExit(0)

if not isinstance(data, dict):
    print("invalid_shape")
    raise SystemExit(0)

s = data.get("status")
bin_age = data.get("binance_tick_age_secs")
mmdps_age = data.get("mmdps_tick_age_secs")

bin_stale = (bin_age is None) or (int(bin_age) > max_bin)
mmdps_stale = (mmdps_age is not None) and (int(mmdps_age) > max_mmdps)

if s == "fresh" and not bin_stale and not mmdps_stale:
    print("fresh")
else:
    print("stale")
PY
)"

if [[ "$status" == "fresh" ]]; then
  echo "[feed-watchdog] OK: feed fresh"
  exit 0
fi

if [[ "$status" == "invalid_json" || "$status" == "invalid_shape" ]]; then
  echo "[feed-watchdog] ERROR: invalid freshness payload"
  exit 2
fi

echo "[feed-watchdog] STALE: restarting data-provider and ws-gateway"
if "${COMPOSE[@]}" up -d --force-recreate data-provider ws-gateway; then
  echo "[feed-watchdog] restart completed"
  exit 0
fi

echo "[feed-watchdog] ERROR: restart failed"
exit 1
