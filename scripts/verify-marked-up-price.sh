#!/bin/bash
# Verify per-group marked-up price: Redis, data-provider groups, and optional gateway tick.
# Run after: Docker is up, and start-all-servers.sh has been run (auth + data-provider + gateway up).

set -e
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
G1_ID="7a0cedd1-76fa-41b2-91d7-6d29968aecdb"  # g1 group UUID from DB

echo "=== 1. Redis: price:groups (should include g1) ==="
redis-cli -u "$REDIS_URL" SMEMBERS price:groups 2>/dev/null || echo "redis-cli failed (install redis-tools or use docker exec)"

echo ""
echo "=== 2. Redis: markup for g1 + BTCUSDT (should show bid/ask 1% for p1) ==="
redis-cli -u "$REDIS_URL" GET "symbol:markup:BTCUSDT:$G1_ID" 2>/dev/null || true

echo ""
echo "=== 3. Data-provider log: loaded price groups ==="
if [ -f /tmp/Data\ Provider.log ]; then
  grep -E "Loaded.*price groups|price groups" /tmp/Data\ Provider.log | tail -5
else
  echo "Log not found at /tmp/Data Provider.log"
fi

echo ""
echo "=== 4. Health checks ==="
for port in 3000 3001 3003; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$port/health" 2>/dev/null || echo "000")
  echo "  localhost:$port -> $code"
done

echo ""
echo "If price:groups contains g1 and symbol:markup:BTCUSDT:g1 exists, data-provider will send marked-up prices for g1."
echo "Have a g1 user log in and subscribe to BTCUSDT; they should see ~1% higher bid/ask (p1 profile)."
