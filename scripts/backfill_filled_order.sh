#!/bin/bash

# Script to backfill a filled order from Redis to database
# Usage: ./backfill_filled_order.sh <order_id>

ORDER_ID="${1:-1cd55067-7253-4b4a-9dc9-93744d8d3481}"

echo "🔍 Backfilling order $ORDER_ID from Redis to database..."
echo ""

# Get order data from Redis
ORDER_DATA=$(redis-cli -h localhost -p 6379 GET "order:$ORDER_ID" 2>/dev/null)

if [ -z "$ORDER_DATA" ]; then
    echo "❌ Order not found in Redis"
    exit 1
fi

echo "✅ Order found in Redis"
echo ""

# Extract data using Python
USER_ID=$(echo "$ORDER_DATA" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('user_id', ''))" 2>/dev/null)
SYMBOL=$(echo "$ORDER_DATA" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('symbol', ''))" 2>/dev/null)
SIDE=$(echo "$ORDER_DATA" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('side', ''))" 2>/dev/null)
ORDER_TYPE=$(echo "$ORDER_DATA" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('order_type', ''))" 2>/dev/null)
SIZE=$(echo "$ORDER_DATA" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('size', '0'))" 2>/dev/null)
FILLED_SIZE=$(echo "$ORDER_DATA" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('filled_size', '0'))" 2>/dev/null)
AVG_PRICE=$(echo "$ORDER_DATA" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('average_fill_price', '0'))" 2>/dev/null)
FILLED_AT=$(echo "$ORDER_DATA" | python3 -c "import sys, json; data=json.load(sys.stdin); ts=data.get('filled_at', ''); print(ts if isinstance(ts, str) else '')" 2>/dev/null)
CREATED_AT=$(echo "$ORDER_DATA" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('created_at', ''))" 2>/dev/null)

echo "Order Details:"
echo "  User ID: $USER_ID"
echo "  Symbol: $SYMBOL"
echo "  Side: $SIDE"
echo "  Type: $ORDER_TYPE"
echo "  Size: $SIZE"
echo "  Filled Size: $FILLED_SIZE"
echo "  Avg Price: $AVG_PRICE"
echo "  Filled At: $FILLED_AT"
echo ""

# Check if order exists in database
ORDER_EXISTS=$(docker exec trading-postgres psql -U postgres -d newpt -t -A -c "SELECT COUNT(*) FROM orders WHERE id = '$ORDER_ID';" 2>/dev/null | tr -d ' ')

if [ "$ORDER_EXISTS" = "0" ]; then
    echo "⚠️  Order not found in database. Need to create it first."
    echo ""
    echo "Getting symbol_id..."
    SYMBOL_ID=$(docker exec trading-postgres psql -U postgres -d newpt -t -A -c "SELECT id FROM symbols WHERE code = '$SYMBOL' LIMIT 1;" 2>/dev/null | tr -d ' ')
    
    if [ -z "$SYMBOL_ID" ] || [ "$SYMBOL_ID" = "" ]; then
        echo "❌ Symbol $SYMBOL not found in database. Cannot create order."
        exit 1
    fi
    
    echo "Creating order in database..."
    # Convert timestamps
    CREATED_TS=$(echo "$CREATED_AT" | python3 -c "import sys; from datetime import datetime; print(datetime.fromisoformat(sys.stdin.read().replace('Z', '+00:00')).timestamp())" 2>/dev/null)
    FILLED_TS=$(echo "$FILLED_AT" | python3 -c "import sys; ts=int(sys.stdin.read()); print(ts / 1000.0)" 2>/dev/null || echo "$FILLED_AT")
    
    # Convert side and type to lowercase for database enum
    SIDE_LOWER=$(echo "$SIDE" | tr '[:upper:]' '[:lower:]')
    TYPE_LOWER=$(echo "$ORDER_TYPE" | tr '[:upper:]' '[:lower:]')
    
    docker exec trading-postgres psql -U postgres -d newpt <<EOF
INSERT INTO orders (
    id, user_id, symbol_id, side, type, size, 
    filled_size, average_price, status, 
    created_at, updated_at, filled_at
)
VALUES (
    '$ORDER_ID',
    '$USER_ID',
    '$SYMBOL_ID',
    '$SIDE_LOWER'::order_side,
    '$TYPE_LOWER'::order_type,
    $SIZE,
    $FILLED_SIZE,
    $AVG_PRICE,
    'filled'::order_status,
    to_timestamp($CREATED_TS),
    to_timestamp($FILLED_TS),
    to_timestamp($FILLED_TS)
)
ON CONFLICT (id) DO UPDATE SET
    status = 'filled'::order_status,
    filled_size = $FILLED_SIZE,
    average_price = $AVG_PRICE,
    filled_at = to_timestamp($FILLED_TS),
    updated_at = to_timestamp($FILLED_TS);

SELECT 'Order created/updated' as status, id, status, filled_size, average_price, filled_at 
FROM orders 
WHERE id = '$ORDER_ID';
EOF
else
    echo "✅ Order exists in database. Updating to filled status..."
    FILLED_TS=$(echo "$FILLED_AT" | python3 -c "import sys; ts=int(sys.stdin.read()); print(ts / 1000.0)" 2>/dev/null || echo "$FILLED_AT")
    
    docker exec trading-postgres psql -U postgres -d newpt <<EOF
UPDATE orders
SET 
    status = 'filled'::order_status,
    filled_size = $FILLED_SIZE,
    average_price = $AVG_PRICE,
    filled_at = to_timestamp($FILLED_TS),
    updated_at = to_timestamp($FILLED_TS)
WHERE id = '$ORDER_ID';

SELECT 'Order updated' as status, id, status, filled_size, average_price, filled_at 
FROM orders 
WHERE id = '$ORDER_ID';
EOF
fi

echo ""
echo "✅ Backfill complete!"

