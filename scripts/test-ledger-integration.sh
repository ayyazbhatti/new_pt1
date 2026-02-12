#!/bin/bash
# Test script for ledger integration

set -e

echo "🧪 Testing Ledger Integration for Deposits"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Database connection
DB_CMD="docker exec trading-postgres psql -U postgres -d newpt -t -A"

echo "📊 Step 1: Checking current state..."
echo ""

# Check current counts
DEPOSIT_REQUESTS=$($DB_CMD -c "SELECT COUNT(*) FROM deposit_requests;")
TRANSACTIONS=$($DB_CMD -c "SELECT COUNT(*) FROM transactions WHERE deposit_request_id IS NOT NULL;")
LEDGER_ENTRIES=$($DB_CMD -c "SELECT COUNT(*) FROM ledger_entries WHERE type = 'deposit';")
WALLETS=$($DB_CMD -c "SELECT COUNT(*) FROM wallets;")

echo "  Current deposit requests: $DEPOSIT_REQUESTS"
echo "  Current transactions (with deposit_request_id): $TRANSACTIONS"
echo "  Current ledger entries (deposit type): $LEDGER_ENTRIES"
echo "  Current wallets: $WALLETS"
echo ""

echo "✅ Migration Status:"
MIGRATION_CHECK=$($DB_CMD -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'deposit_request_id';")
if [ -n "$MIGRATION_CHECK" ]; then
    echo -e "  ${GREEN}✓ deposit_request_id column exists${NC}"
else
    echo -e "  ${RED}✗ deposit_request_id column missing${NC}"
    exit 1
fi

INDEX_CHECK=$($DB_CMD -c "SELECT indexname FROM pg_indexes WHERE tablename = 'transactions' AND indexname = 'idx_transactions_deposit_request_id';")
if [ -n "$INDEX_CHECK" ]; then
    echo -e "  ${GREEN}✓ Index exists${NC}"
else
    echo -e "  ${RED}✗ Index missing${NC}"
    exit 1
fi

echo ""
echo "📝 Step 2: Test Flow Instructions"
echo ""
echo "To test the complete flow:"
echo "  1. Create a deposit request via API (POST /api/deposits/request)"
echo "  2. Check transactions table for new transaction"
echo "  3. Approve the deposit (POST /api/admin/deposits/{id}/approve)"
echo "  4. Check ledger_entries table for new entry"
echo "  5. Check wallets table for updated balance"
echo ""

echo "🔍 Quick verification queries:"
echo ""
echo "  # Check recent deposit requests with transactions:"
echo "  SELECT dr.id, dr.amount, dr.status, t.id as transaction_id, t.status as tx_status"
echo "  FROM deposit_requests dr"
echo "  LEFT JOIN transactions t ON t.deposit_request_id = dr.id"
echo "  ORDER BY dr.created_at DESC LIMIT 5;"
echo ""
echo "  # Check ledger entries for deposits:"
echo "  SELECT le.id, le.delta, le.balance_after, le.ref, le.created_at"
echo "  FROM ledger_entries le"
echo "  WHERE le.type = 'deposit'"
echo "  ORDER BY le.created_at DESC LIMIT 5;"
echo ""
echo "  # Check wallets:"
echo "  SELECT w.id, w.user_id, w.currency, w.available_balance, w.updated_at"
echo "  FROM wallets w"
echo "  ORDER BY w.updated_at DESC LIMIT 5;"
echo ""

echo -e "${GREEN}✅ Setup complete! Ready for testing.${NC}"

