#!/bin/bash
# Verify data-provider is sending live price data to Redis (used by ws-gateway → frontend).

set -e
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"

echo "=========================================="
echo "  Data Provider Live Data Check"
echo "=========================================="
echo ""

# 1) Data-provider health (try common ports)
DATA_PROVIDER_HEALTH=""
for port in 3001 9004 9002; do
  if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${port}/health" 2>/dev/null | grep -q 200; then
    DATA_PROVIDER_HEALTH="http://127.0.0.1:${port}/health"
    break
  fi
done

if [ -n "$DATA_PROVIDER_HEALTH" ]; then
  echo "✅ Data provider is running ($DATA_PROVIDER_HEALTH)"
  ROOMS=$(curl -s "$DATA_PROVIDER_HEALTH" 2>/dev/null | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('rooms', d.get('metrics', {}).get('rooms', '?')))" 2>/dev/null || echo "?")
  echo "   (rooms/metrics: $ROOMS)"
else
  echo "❌ Data provider not reachable on ports 3001, 9004, 9002"
  echo "   Start it with: cargo run -p data-provider (from repo root)"
fi
echo ""

# 2) Redis: subscribe to price:ticks and count messages for a few seconds
echo "📡 Checking Redis channel 'price:ticks' (listening 5s)..."
COUNT=0
TIMEOUT=5
if command -v redis-cli >/dev/null 2>&1; then
  TMPF=$(mktemp)
  redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" SUBSCRIBE price:ticks 2>/dev/null > "$TMPF" &
  RPID=$!
  sleep $TIMEOUT
  kill $RPID 2>/dev/null || true
  wait $RPID 2>/dev/null || true
  COUNT=$(grep -c '"symbol"' "$TMPF" 2>/dev/null || echo 0)
  rm -f "$TMPF"
else
  echo "   (install redis-cli to verify Redis stream)"
fi

if [ -n "$COUNT" ] && [ "$COUNT" -gt 0 ]; then
  echo "✅ Data provider is publishing live prices to Redis"
  echo "   Received $COUNT price tick(s) in ${TIMEOUT}s on channel price:ticks"
else
  echo "⚠️  No price:ticks messages seen in ${TIMEOUT}s"
  echo "   Possible causes:"
  echo "   - data-provider not running or not connected to Redis"
  echo "   - REDIS_URL in data-provider different from $REDIS_URL"
  echo "   - Only initial symbols (BTCUSDT, ETHUSDT, EURUSD, BNBUSDT, DOGEUSDT) are published"
fi
echo ""

# 3) ws-gateway (frontend connects here for ticks)
if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:9001/health" 2>/dev/null | grep -q 200; then
  echo "✅ ws-gateway is running (http://127.0.0.1:9001) — frontend uses this for live ticks"
else
  echo "⚠️  ws-gateway not reachable on port 9001 — frontend cannot get ticks"
fi
echo ""

echo "=========================================="
echo "  Data flow (frontend live prices)"
echo "=========================================="
echo "  data-provider → Redis (price:ticks) → ws-gateway → browser"
echo "  Initial symbols: BTCUSDT, ETHUSDT, EURUSD, BNBUSDT, DOGEUSDT"
echo ""
