#!/bin/bash

# Script to sync filled orders from Redis to PostgreSQL database
# This helps fix orders that were filled but not updated in the database

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_info() {
    echo -e "${GREEN}ℹ️${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠️${NC} $1"
}

print_error() {
    echo -e "${RED}❌${NC} $1"
}

print_success() {
    echo -e "${GREEN}✅${NC} $1"
}

echo "🔄 Syncing Filled Orders from Redis to PostgreSQL"
echo ""

# Check Redis connection
if ! redis-cli -h localhost -p 6379 ping > /dev/null 2>&1; then
    print_error "Redis is not accessible"
    exit 1
fi

# Check PostgreSQL connection
if ! docker exec trading-postgres psql -U postgres -d newpt -c "SELECT 1;" > /dev/null 2>&1; then
    print_error "PostgreSQL is not accessible"
    exit 1
fi

print_info "Scanning Redis for filled orders..."

# Get all order keys from Redis
ORDER_KEYS=$(redis-cli -h localhost -p 6379 --scan --pattern "order:*" 2>/dev/null)

FILLED_COUNT=0
SYNCED_COUNT=0
ERROR_COUNT=0

for ORDER_KEY in $ORDER_KEYS; do
    # Get order data from Redis
    ORDER_JSON=$(redis-cli -h localhost -p 6379 GET "$ORDER_KEY" 2>/dev/null)
    
    if [ -z "$ORDER_JSON" ]; then
        continue
    fi
    
    # Check if order is filled
    STATUS=$(echo "$ORDER_JSON" | jq -r '.status' 2>/dev/null)
    
    if [ "$STATUS" != "FILLED" ]; then
        continue
    fi
    
    FILLED_COUNT=$((FILLED_COUNT + 1))
    
    # Extract order details
    ORDER_ID=$(echo "$ORDER_JSON" | jq -r '.id' 2>/dev/null)
    USER_ID=$(echo "$ORDER_JSON" | jq -r '.user_id' 2>/dev/null)
    SYMBOL=$(echo "$ORDER_JSON" | jq -r '.symbol' 2>/dev/null)
    SIDE=$(echo "$ORDER_JSON" | jq -r '.side' 2>/dev/null)
    ORDER_TYPE=$(echo "$ORDER_JSON" | jq -r '.order_type' 2>/dev/null)
    SIZE=$(echo "$ORDER_JSON" | jq -r '.size' 2>/dev/null)
    FILLED_SIZE=$(echo "$ORDER_JSON" | jq -r '.filled_size' 2>/dev/null)
    AVG_PRICE=$(echo "$ORDER_JSON" | jq -r '.average_fill_price' 2>/dev/null)
    LIMIT_PRICE=$(echo "$ORDER_JSON" | jq -r '.limit_price' 2>/dev/null)
    STOP_LOSS=$(echo "$ORDER_JSON" | jq -r '.stop_loss' 2>/dev/null)
    CREATED_AT=$(echo "$ORDER_JSON" | jq -r '.created_at' 2>/dev/null)
    FILLED_AT=$(echo "$ORDER_JSON" | jq -r '.filled_at' 2>/dev/null)
    
    if [ -z "$ORDER_ID" ] || [ "$ORDER_ID" = "null" ]; then
        print_warning "Skipping order with missing ID: $ORDER_KEY"
        continue
    fi
    
    # Check if order exists in database
    ORDER_EXISTS=$(docker exec trading-postgres psql -U postgres -d newpt -t -A -c "SELECT COUNT(*) FROM orders WHERE id = '$ORDER_ID';" 2>/dev/null | tr -d ' ')
    
    if [ "$ORDER_EXISTS" = "0" ]; then
        # Order doesn't exist, need to create it
        print_info "Creating order $ORDER_ID in database..."
        
        # Get symbol_id
        SYMBOL_ID=$(docker exec trading-postgres psql -U postgres -d newpt -t -A -c "SELECT id FROM symbols WHERE code = '$SYMBOL' LIMIT 1;" 2>/dev/null | tr -d ' ')
        
        if [ -z "$SYMBOL_ID" ] || [ "$SYMBOL_ID" = "" ]; then
            print_warning "Symbol $SYMBOL not found in database, skipping order $ORDER_ID"
            ERROR_COUNT=$((ERROR_COUNT + 1))
            continue
        fi
        
        # Convert timestamps
        if [ -n "$CREATED_AT" ] && [ "$CREATED_AT" != "null" ]; then
            CREATED_AT_SQL="'$CREATED_AT'"
        else
            CREATED_AT_SQL="NOW()"
        fi
        
        if [ -n "$FILLED_AT" ] && [ "$FILLED_AT" != "null" ]; then
            # FILLED_AT might be a timestamp in milliseconds
            if [[ "$FILLED_AT" =~ ^[0-9]+$ ]] && [ ${#FILLED_AT} -gt 10 ]; then
                # Convert milliseconds to timestamp
                FILLED_AT_SQL="to_timestamp($FILLED_AT / 1000.0)"
            else
                FILLED_AT_SQL="NOW()"
            fi
        else
            FILLED_AT_SQL="NOW()"
        fi
        
        # Convert side and type to lowercase
        SIDE_LOWER=$(echo "$SIDE" | tr '[:upper:]' '[:lower:]')
        TYPE_LOWER=$(echo "$ORDER_TYPE" | tr '[:upper:]' '[:lower:]')
        
        # Insert order
        docker exec trading-postgres psql -U postgres -d newpt -c "
            INSERT INTO orders (
                id, user_id, symbol_id, side, type, size, price, stop_price,
                filled_size, average_price, status,
                created_at, updated_at, filled_at
            )
            VALUES (
                '$ORDER_ID', '$USER_ID', '$SYMBOL_ID', '$SIDE_LOWER'::order_side, '$TYPE_LOWER'::order_type,
                $SIZE, ${LIMIT_PRICE:-NULL}, ${STOP_LOSS:-NULL},
                $FILLED_SIZE, ${AVG_PRICE:-NULL}, 'filled'::order_status,
                $CREATED_AT_SQL, $FILLED_AT_SQL, $FILLED_AT_SQL
            )
            ON CONFLICT (id) DO UPDATE SET
                status = 'filled'::order_status,
                filled_size = $FILLED_SIZE,
                average_price = ${AVG_PRICE:-NULL},
                filled_at = $FILLED_AT_SQL,
                updated_at = $FILLED_AT_SQL;
        " > /dev/null 2>&1
        
        if [ $? -eq 0 ]; then
            print_success "Created order $ORDER_ID"
            SYNCED_COUNT=$((SYNCED_COUNT + 1))
        else
            print_error "Failed to create order $ORDER_ID"
            ERROR_COUNT=$((ERROR_COUNT + 1))
        fi
    else
        # Order exists, update it
        print_info "Updating order $ORDER_ID in database..."
        
        if [ -n "$FILLED_AT" ] && [ "$FILLED_AT" != "null" ]; then
            if [[ "$FILLED_AT" =~ ^[0-9]+$ ]] && [ ${#FILLED_AT} -gt 10 ]; then
                FILLED_AT_SQL="to_timestamp($FILLED_AT / 1000.0)"
            else
                FILLED_AT_SQL="NOW()"
            fi
        else
            FILLED_AT_SQL="NOW()"
        fi
        
        docker exec trading-postgres psql -U postgres -d newpt -c "
            UPDATE orders
            SET 
                status = 'filled'::order_status,
                filled_size = $FILLED_SIZE,
                average_price = ${AVG_PRICE:-NULL},
                filled_at = $FILLED_AT_SQL,
                updated_at = $FILLED_AT_SQL
            WHERE id = '$ORDER_ID';
        " > /dev/null 2>&1
        
        if [ $? -eq 0 ]; then
            print_success "Updated order $ORDER_ID"
            SYNCED_COUNT=$((SYNCED_COUNT + 1))
        else
            print_error "Failed to update order $ORDER_ID"
            ERROR_COUNT=$((ERROR_COUNT + 1))
        fi
    fi
done

echo ""
echo "=== Summary ==="
print_info "Filled orders found in Redis: $FILLED_COUNT"
print_success "Orders synced: $SYNCED_COUNT"
if [ $ERROR_COUNT -gt 0 ]; then
    print_error "Errors: $ERROR_COUNT"
fi
echo ""
print_success "Sync complete!"

