#!/bin/bash

echo "=========================================="
echo "  WebSocket Balance Flow Test"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Step 1: Checking if services are running..."
if pgrep -f "auth-service" > /dev/null; then
    echo -e "${GREEN}✅ Auth Service is running${NC}"
    AUTH_PID=$(pgrep -f "auth-service" | head -1)
    AUTH_START=$(ps -p $AUTH_PID -o lstart= 2>/dev/null | awk '{print $4}')
    echo "   Started at: $AUTH_START"
else
    echo -e "${RED}❌ Auth Service is NOT running${NC}"
fi

if pgrep -f "gateway-ws" > /dev/null; then
    echo -e "${GREEN}✅ Gateway WS is running${NC}"
    GATEWAY_PID=$(pgrep -f "gateway-ws" | head -1)
    GATEWAY_START=$(ps -p $GATEWAY_PID -o lstart= 2>/dev/null | awk '{print $4}')
    echo "   Started at: $GATEWAY_START"
else
    echo -e "${RED}❌ Gateway WS is NOT running${NC}"
fi

echo ""
echo "Step 2: Checking Redis connection..."
if redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis is running${NC}"
else
    echo -e "${RED}❌ Redis is NOT running${NC}"
    exit 1
fi

echo ""
echo "Step 3: Checking if auth-service is subscribed to wallet:balance:request..."
SUBSCRIBERS=$(redis-cli PUBSUB NUMSUB "wallet:balance:request" 2>/dev/null | tail -1)
if [ "$SUBSCRIBERS" -gt 0 ]; then
    echo -e "${GREEN}✅ Auth-service is subscribed (${SUBSCRIBERS} subscriber(s))${NC}"
else
    echo -e "${YELLOW}⚠️  Auth-service is NOT subscribed (0 subscribers)${NC}"
    echo "   This means the service is running old code or the listener failed to start"
    echo "   Solution: Restart auth-service"
fi

echo ""
echo "Step 4: Checking if gateway-ws is subscribed to wallet:balance:updated..."
SUBSCRIBERS=$(redis-cli PUBSUB NUMSUB "wallet:balance:updated" 2>/dev/null | tail -1)
if [ "$SUBSCRIBERS" -gt 0 ]; then
    echo -e "${GREEN}✅ Gateway WS is subscribed (${SUBSCRIBERS} subscriber(s))${NC}"
else
    echo -e "${YELLOW}⚠️  Gateway WS is NOT subscribed (0 subscribers)${NC}"
    echo "   This means the service is running old code or the subscriber failed to start"
    echo "   Solution: Restart gateway-ws"
fi

echo ""
echo "Step 5: Testing balance request flow..."
echo "   Publishing test message to wallet:balance:request..."
TEST_USER_ID="00000000-0000-0000-0000-000000000001"
TEST_MSG="{\"user_id\":\"$TEST_USER_ID\",\"request_type\":\"initial_balance\"}"
RECIPIENTS=$(redis-cli PUBLISH "wallet:balance:request" "$TEST_MSG" 2>/dev/null)

if [ "$RECIPIENTS" -gt 0 ]; then
    echo -e "${GREEN}✅ Message published successfully (${RECIPIENTS} recipient(s))${NC}"
    echo "   Check auth-service logs for: '📥 Received wallet balance request'"
else
    echo -e "${YELLOW}⚠️  Message published but no subscribers (0 recipients)${NC}"
    echo "   This confirms auth-service listener is not active"
fi

echo ""
echo "=========================================="
echo "  Summary"
echo "=========================================="
echo ""
echo "If services show 0 subscribers:"
echo "  1. Stop services: pkill -f 'auth-service' && pkill -f 'gateway-ws'"
echo "  2. Restart: bash scripts/start-all-servers.sh"
echo ""
echo "After restart, check logs for:"
echo "  Auth Service: '✅ Subscribed to wallet:balance:request channel'"
echo "  Gateway WS: 'Subscribed to Redis channel: wallet:balance:updated'"
echo ""
echo "Then connect from frontend and check browser console for:"
echo "  '✅ WebSocket authenticated'"
echo "  '🔔 Received wallet.balance.updated event'"

