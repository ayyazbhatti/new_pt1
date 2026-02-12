# Ledger Integration Test Results

## ✅ Migration Status

**Status**: ✅ **COMPLETE**

- ✅ `deposit_request_id` column added to `transactions` table
- ✅ Index `idx_transactions_deposit_request_id` created
- ✅ Column comment added for documentation
- ✅ Backend service compiled successfully
- ✅ Backend service restarted and running

## 📊 Current Database State

- **Deposit Requests**: 5 (existing, created before integration)
- **Transactions with deposit_request_id**: 0 (expected - old requests don't have transactions)
- **Ledger Entries**: 0 (expected - no deposits approved yet)
- **Wallets**: 0 (will be created when deposits are approved)

## 🧪 Testing Instructions

### Test 1: Create New Deposit Request

**Via API:**
```bash
# Login as user
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' \
  | jq -r '.token')

# Create deposit request
curl -X POST http://localhost:3000/api/deposits/request \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100.50, "note": "Test deposit"}'
```

**Verify Transaction Created:**
```sql
SELECT 
  dr.id as request_id,
  dr.amount,
  dr.status as request_status,
  t.id as transaction_id,
  t.status as transaction_status,
  t.reference,
  t.method
FROM deposit_requests dr
LEFT JOIN transactions t ON t.deposit_request_id = dr.id
WHERE dr.id = '<request_id_from_response>';
```

**Expected Result:**
- ✅ Transaction should be created with `status = 'pending'`
- ✅ `deposit_request_id` should link to the request
- ✅ `method = 'manual'`
- ✅ `type = 'deposit'`

### Test 2: Approve Deposit

**Via API:**
```bash
# Login as admin
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@newpt.local","password":"admin123"}' \
  | jq -r '.token')

# Approve deposit
curl -X POST http://localhost:3000/api/admin/deposits/<request_id>/approve \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Verify Ledger Entry Created:**
```sql
SELECT 
  le.id,
  le.wallet_id,
  le.type,
  le.delta,
  le.balance_after,
  le.ref,
  le.description,
  le.created_at
FROM ledger_entries le
WHERE le.type = 'deposit'
ORDER BY le.created_at DESC
LIMIT 1;
```

**Verify Wallet Updated:**
```sql
SELECT 
  w.id,
  w.user_id,
  w.currency,
  w.available_balance,
  w.updated_at
FROM wallets w
WHERE w.user_id = '<user_id>'
ORDER BY w.updated_at DESC
LIMIT 1;
```

**Verify Transaction Updated:**
```sql
SELECT 
  t.id,
  t.status,
  t.completed_at,
  t.created_by
FROM transactions t
WHERE t.deposit_request_id = '<request_id>';
```

**Expected Results:**
- ✅ Transaction status = 'completed'
- ✅ `completed_at` timestamp set
- ✅ `created_by` = admin_id
- ✅ Ledger entry created with `delta = amount`
- ✅ Wallet created/updated with new balance
- ✅ `balance_after` = previous balance + amount

### Test 3: Reject Deposit

**Via API:**
```bash
curl -X POST http://localhost:3000/api/admin/deposits/<request_id>/reject \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Insufficient documentation"}'
```

**Verify Transaction Updated:**
```sql
SELECT 
  t.id,
  t.status,
  t.rejection_reason,
  t.cancelled_at
FROM transactions t
WHERE t.deposit_request_id = '<request_id>';
```

**Expected Results:**
- ✅ Transaction status = 'rejected'
- ✅ `rejection_reason` set
- ✅ `cancelled_at` timestamp set
- ✅ NO ledger entry created (correct behavior)

## 🔍 Verification Queries

### Check All Deposit Requests with Transactions
```sql
SELECT 
  dr.id::text as request_id,
  dr.user_id::text,
  dr.amount,
  dr.status as request_status,
  dr.created_at,
  t.id::text as transaction_id,
  t.status as transaction_status,
  t.completed_at,
  t.rejection_reason
FROM deposit_requests dr
LEFT JOIN transactions t ON t.deposit_request_id = dr.id
ORDER BY dr.created_at DESC;
```

### Check All Ledger Entries
```sql
SELECT 
  le.id::text,
  le.wallet_id::text,
  le.type,
  le.delta,
  le.balance_after,
  le.ref,
  le.description,
  le.created_at
FROM ledger_entries le
ORDER BY le.created_at DESC;
```

### Check All Wallets
```sql
SELECT 
  w.id::text,
  w.user_id::text,
  w.wallet_type,
  w.currency,
  w.available_balance,
  w.locked_balance,
  w.updated_at
FROM wallets w
ORDER BY w.updated_at DESC;
```

### Balance Verification (Sum Ledger Entries)
```sql
SELECT 
  w.user_id::text,
  w.currency,
  w.available_balance as wallet_balance,
  COALESCE(SUM(le.delta), 0) as ledger_sum,
  (w.available_balance - COALESCE(SUM(le.delta), 0)) as difference
FROM wallets w
LEFT JOIN ledger_entries le ON le.wallet_id = w.id
GROUP BY w.id, w.user_id, w.currency, w.available_balance
HAVING ABS(w.available_balance - COALESCE(SUM(le.delta), 0)) > 0.01;
```

## ✅ Success Criteria

- [x] Migration applied successfully
- [x] Backend compiles without errors
- [x] Backend service running
- [ ] New deposit request creates transaction
- [ ] Approving deposit creates ledger entry
- [ ] Approving deposit updates wallet balance
- [ ] Rejecting deposit updates transaction status
- [ ] Rejecting deposit does NOT create ledger entry

## 📝 Notes

- Existing deposit requests (created before integration) won't have transactions
- Only new deposit requests will create transactions automatically
- Old deposits can be manually linked if needed (optional)

## 🚀 Next Steps

1. Test creating a new deposit request via UI or API
2. Verify transaction is created in database
3. Approve the deposit via admin panel
4. Verify ledger entry and wallet balance update
5. Test rejection flow
6. Verify no ledger entry on rejection

