#!/bin/bash

# Script to check filled orders for a user
# Usage: ./check_user_filled_orders.sh <email>

EMAIL="${1:-nilazinoxa@mailinator.com}"

echo "🔍 Checking filled orders for: $EMAIL"
echo ""

# Try different database containers
for CONTAINER in trading-postgres tpc-postgres-dev; do
    if docker ps --format "{{.Names}}" | grep -q "^${CONTAINER}$"; then
        echo "✅ Found container: $CONTAINER"
        
        # Try different databases
        for DB in newpt trading_platform tpc; do
            echo "  Checking database: $DB"
            
            # Try different users
            for DB_USER in postgres tpc_user; do
                USER_ID=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB" -t -A -c "SELECT id FROM users WHERE email = '$EMAIL';" 2>/dev/null | head -1 | tr -d ' ')
                
                if [ -n "$USER_ID" ] && [ "$USER_ID" != "" ]; then
                    echo "  ✅ User Found!"
                    echo "  User ID: $USER_ID"
                    echo "  Database: $DB"
                    echo "  Container: $CONTAINER"
                    echo ""
                    echo "  === Filled Orders Count ==="
                    FILLED_COUNT=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB" -t -A -c "SELECT COUNT(*) FROM orders WHERE user_id = '$USER_ID' AND status = 'filled';" 2>/dev/null | tr -d ' ')
                    echo "  Total filled orders: ${FILLED_COUNT:-0}"
                    echo ""
                    
                    if [ "${FILLED_COUNT:-0}" -gt 0 ]; then
                        echo "  === Filled Orders Details ==="
                        docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB" -c "
                            SELECT 
                                o.id,
                                s.code as symbol,
                                o.side,
                                o.type,
                                o.size,
                                o.filled_size,
                                o.average_price,
                                o.status,
                                o.created_at,
                                o.filled_at
                            FROM orders o
                            LEFT JOIN symbols s ON o.symbol_id = s.id
                            WHERE o.user_id = '$USER_ID' AND o.status = 'filled'
                            ORDER BY o.created_at DESC
                            LIMIT 20;
                        " 2>/dev/null
                    else
                        echo "  ❌ No filled orders found for this user"
                    fi
                    exit 0
                fi
            done
        done
    fi
done

echo "❌ User not found in any database"
exit 1

