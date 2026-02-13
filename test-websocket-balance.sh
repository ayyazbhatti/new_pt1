#!/bin/bash

# Test script to verify WebSocket balance flow

echo "Testing WebSocket Balance Flow"
echo "=============================="
echo ""

# Check if Redis is running
echo "1. Checking Redis connection..."
redis-cli ping > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "   ✅ Redis is running"
else
    echo "   ❌ Redis is not running"
    exit 1
fi

# Check if services are running
echo ""
echo "2. Checking services..."
if lsof -i :3000 > /dev/null 2>&1; then
    echo "   ✅ Auth Service (port 3000) is running"
else
    echo "   ❌ Auth Service (port 3000) is not running"
fi

if lsof -i :3003 > /dev/null 2>&1; then
    echo "   ✅ Gateway WS (port 3003) is running"
else
    echo "   ❌ Gateway WS (port 3003) is not running"
fi

# Test Redis pub/sub manually
echo ""
echo "3. Testing Redis pub/sub..."
echo "   Publishing test message to wallet:balance:request..."

# Create a test message
TEST_USER_ID="00000000-0000-0000-0000-000000000000"
TEST_MSG=$(cat <<EOF
{"user_id": "$TEST_USER_ID", "request_type": "initial_balance"}
EOF
)

# Publish to Redis
redis-cli PUBLISH "wallet:balance:request" "$TEST_MSG" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "   ✅ Message published successfully"
    echo "   ⏳ Check auth-service logs to see if it received the message"
else
    echo "   ❌ Failed to publish message"
fi

echo ""
echo "4. Checking Redis channels..."
echo "   Subscribed channels in ws-gateway:"
redis-cli PUBSUB CHANNELS | grep -E "(wallet|balance)" || echo "   (No wallet/balance channels found)"

echo ""
echo "Test complete. Check the logs of:"
echo "  - auth-service: Should show 'Received wallet balance request'"
echo "  - ws-gateway: Should show 'Published wallet balance request' and 'Broadcasting wallet.balance.updated'"
echo "  - Frontend console: Should show 'Received wallet.balance.updated'"

