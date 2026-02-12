#!/bin/bash

# Script to check position history for a user by email
# Usage: ./check_user_positions.sh <email>

EMAIL="${1:-nilazinoxa@mailinator.com}"

echo "=== Checking Position History for: $EMAIL ==="
echo ""

# Try to find user ID from database
CONTAINER=$(docker ps --format "{{.Names}}" | grep -i postgres | head -1)

if [ -z "$CONTAINER" ]; then
    echo "❌ Postgres container not found"
    exit 1
fi

echo "Using Postgres container: $CONTAINER"
echo ""

# Try different database names
for DB in newpt trading_platform trading; do
    USER_ID=$(docker exec "$CONTAINER" psql -U postgres -d "$DB" -t -A -c "SELECT id FROM users WHERE email = '$EMAIL';" 2>/dev/null | head -1 | tr -d ' ')
    if [ -n "$USER_ID" ] && [ "$USER_ID" != "" ]; then
        echo "✅ User Found!"
        echo "User ID: $USER_ID"
        echo "Email: $EMAIL"
        echo "Database: $DB"
        echo ""
        echo "=== Position History ==="
        echo ""
        
        closed_count=0
        echo "Scanning closed positions..."
        
        for key in $(redis-cli -h localhost -p 6379 --scan --pattern "pos:by_id:*" 2>/dev/null); do
            pos_user_id=$(redis-cli -h localhost -p 6379 HGET "$key" "user_id" 2>/dev/null)
            if [ "$pos_user_id" = "$USER_ID" ]; then
                pos_status=$(redis-cli -h localhost -p 6379 HGET "$key" "status" 2>/dev/null)
                if [ "$pos_status" = "CLOSED" ]; then
                    closed_count=$((closed_count + 1))
                    pos_id=$(echo "$key" | sed 's/pos:by_id://')
                    symbol=$(redis-cli -h localhost -p 6379 HGET "$key" "symbol" 2>/dev/null)
                    side=$(redis-cli -h localhost -p 6379 HGET "$key" "side" 2>/dev/null)
                    pnl=$(redis-cli -h localhost -p 6379 HGET "$key" "realized_pnl" 2>/dev/null)
                    entry=$(redis-cli -h localhost -p 6379 HGET "$key" "entry_price" 2>/dev/null)
                    size=$(redis-cli -h localhost -p 6379 HGET "$key" "size" 2>/dev/null)
                    closed_at=$(redis-cli -h localhost -p 6379 HGET "$key" "closed_at" 2>/dev/null)
                    
                    echo "Closed Position #$closed_count:"
                    echo "  ID: ${pos_id:0:8}..."
                    echo "  Symbol: $symbol"
                    echo "  Side: $side"
                    echo "  Size: $size"
                    echo "  Entry Price: \$$entry"
                    echo "  Realized P&L: \$$pnl"
                    if [ -n "$closed_at" ] && [ "$closed_at" != "null" ] && [ "$closed_at" != "" ]; then
                        closed_date=$(date -r $(($closed_at / 1000)) 2>/dev/null || echo "$closed_at")
                        echo "  Closed At: $closed_date"
                    else
                        echo "  Closed At: N/A"
                    fi
                    echo ""
                fi
            fi
        done
        
        echo "=== Summary ==="
        if [ $closed_count -eq 0 ]; then
            echo "❌ This user has NO position history"
            echo "   (No closed positions found)"
        else
            echo "✅ This user HAS position history!"
            echo "   Total closed positions: $closed_count"
        fi
        exit 0
    fi
done

echo "❌ User not found: $EMAIL"
echo ""
echo "The user may not exist in the database."
exit 1

