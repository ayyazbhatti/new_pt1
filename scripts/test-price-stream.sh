#!/bin/bash

# Quick test script to verify data-provider is sending live prices

echo "=========================================="
echo "  Testing Data Provider Price Stream"
echo "=========================================="
echo ""

# Check if data-provider is running
if ! curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo "❌ Data Provider is not running on port 3001"
    exit 1
fi

echo "✅ Data Provider is running"
echo ""

# Check NATS connection
NATS_MSGS_BEFORE=$(curl -s http://localhost:8222/varz 2>/dev/null | grep -o '"in_msgs":[0-9]*' | cut -d: -f2)
echo "📊 NATS messages before: $NATS_MSGS_BEFORE"

# Wait 3 seconds
echo "⏳ Waiting 3 seconds for price updates..."
sleep 3

# Check NATS messages again
NATS_MSGS_AFTER=$(curl -s http://localhost:8222/varz 2>/dev/null | grep -o '"in_msgs":[0-9]*' | cut -d: -f2)
echo "📊 NATS messages after: $NATS_MSGS_AFTER"

MSG_DIFF=$((NATS_MSGS_AFTER - NATS_MSGS_BEFORE))
echo ""

if [ "$MSG_DIFF" -gt 0 ]; then
    echo "✅ SUCCESS: Data Provider is publishing live prices!"
    echo "   - Published approximately $MSG_DIFF messages in 3 seconds"
    echo "   - Expected: ~6 messages per symbol (2 per second × 3 seconds)"
    echo "   - With 12 symbols: ~72 messages expected"
    echo ""
    echo "📈 Price data is being sent to NATS subjects:"
    echo "   - ticks.BTCUSD"
    echo "   - ticks.ETHUSD"
    echo "   - ticks.SOLUSD"
    echo "   - ... and 9 more symbols"
else
    echo "⚠️  WARNING: No new messages detected"
    echo "   This could mean:"
    echo "   - Data provider is not fetching from Binance"
    echo "   - NATS publishing is failing"
    echo "   - Check logs for errors"
fi

echo ""
echo "🔍 To verify specific prices, check order-engine logs or subscribe to NATS:"
echo "   nats sub 'ticks.>'"

