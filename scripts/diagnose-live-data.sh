#!/bin/bash

echo "=========================================="
echo "  Live Data Flow Diagnosis"
echo "=========================================="
echo ""

# Issue 1: Order-engine tick handler
echo "🔍 Issue 1: Order-Engine Tick Handler"
echo "----------------------------------------"
HEALTH=$(curl -s http://localhost:3002/health)
HANDLER_ALIVE=$(echo $HEALTH | python3 -c "import sys, json; print(json.load(sys.stdin)['subscription']['handler_task_alive'])" 2>/dev/null)
MSG_RECEIVED=$(echo $HEALTH | python3 -c "import sys, json; print(json.load(sys.stdin)['subscription']['messages_received'])" 2>/dev/null)

if [ "$HANDLER_ALIVE" = "False" ] || [ "$HANDLER_ALIVE" = "false" ]; then
    echo "❌ PROBLEM: Tick handler task is NOT alive"
    echo "   - This means order-engine is not processing price ticks"
    echo "   - Check order-engine logs for errors"
else
    echo "✅ Tick handler is alive"
fi

if [ "$MSG_RECEIVED" = "0" ]; then
    echo "❌ PROBLEM: No messages received"
    echo "   - Order-engine is subscribed but not receiving ticks"
else
    echo "✅ Messages received: $MSG_RECEIVED"
fi
echo ""

# Issue 2: WebSocket server
echo "🔍 Issue 2: Frontend WebSocket Connection"
echo "----------------------------------------"
WS_PORT=$(lsof -i :9003 | grep LISTEN | wc -l)
if [ "$WS_PORT" -eq 0 ]; then
    echo "❌ PROBLEM: No WebSocket server on port 9003"
    echo "   - Frontend expects: ws://localhost:9003"
    echo "   - apps/data-provider (port 3001) only publishes to NATS"
    echo "   - Need to start backend/data-provider or gateway-ws"
else
    echo "✅ WebSocket server running on port 9003"
fi
echo ""

# Issue 3: Data flow
echo "🔍 Issue 3: Data Flow Chain"
echo "----------------------------------------"
echo "Step 1: Data Provider → NATS"
NATS_MSGS=$(curl -s http://localhost:8222/varz 2>/dev/null | python3 -c "import sys, json; print(json.load(sys.stdin).get('in_msgs', 0))" 2>/dev/null)
if [ "$NATS_MSGS" -gt 1000 ]; then
    echo "✅ Data provider is publishing to NATS ($NATS_MSGS messages)"
else
    echo "⚠️  Low message count: $NATS_MSGS"
fi

echo ""
echo "Step 2: NATS → Order-Engine"
if [ "$HANDLER_ALIVE" = "True" ] || [ "$HANDLER_ALIVE" = "true" ]; then
    echo "✅ Order-engine is subscribed and processing"
else
    echo "❌ Order-engine tick handler is NOT running"
fi

echo ""
echo "Step 3: Order-Engine → Frontend (via WebSocket)"
if [ "$WS_PORT" -gt 0 ]; then
    echo "✅ WebSocket server available"
else
    echo "❌ No WebSocket server - frontend cannot receive prices"
fi
echo ""

# Summary
echo "=========================================="
echo "  Summary"
echo "=========================================="
echo ""
echo "Root Causes:"
echo "1. Order-engine tick handler task is not running"
echo "2. No WebSocket server on port 9003 for frontend"
echo ""
echo "Solutions:"
echo "1. Check order-engine logs: tail -f /tmp/order-engine.log"
echo "2. Start backend/data-provider WebSocket server OR"
echo "3. Configure frontend to use gateway-ws on port 3003"
echo ""

