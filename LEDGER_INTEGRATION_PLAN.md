# Ledger Integration Plan for Deposits

## Overview
Convert deposit requests into proper ledger transactions with full audit trail and balance tracking.

## Current State
- ✅ `transactions` table exists with proper structure
- ✅ `ledger_entries` table exists for balance tracking
- ✅ `deposit_requests` table exists (needs to be linked to transactions)
- ✅ Transaction types: 'deposit', 'withdrawal', 'adjustment', 'fee', 'rebate'
- ✅ Transaction statuses: 'pending', 'completed', 'rejected', 'failed'
- ✅ Transaction methods: 'card', 'bank', 'crypto', 'manual'

## What Needs to Be Done

### 1. Database Schema Updates

#### Option A: Add transaction_id to deposit_requests
```sql
ALTER TABLE deposit_requests 
ADD COLUMN transaction_id UUID REFERENCES transactions(id);
CREATE INDEX idx_deposit_requests_transaction_id ON deposit_requests(transaction_id);
```

#### Option B: Add deposit_request_id to transactions (Better approach)
```sql
ALTER TABLE transactions 
ADD COLUMN deposit_request_id UUID;
CREATE INDEX idx_transactions_deposit_request_id ON transactions(deposit_request_id);
```

### 2. Backend Changes

#### A. Create Transaction When Deposit Request is Created
- When user creates deposit request, create a transaction record:
  - `type`: 'deposit'
  - `method`: 'manual'
  - `status`: 'pending'
  - `reference`: deposit_request_id (or unique reference)
  - `amount`: deposit amount
  - `net_amount`: deposit amount (no fees for manual deposits)
  - `fee`: 0
  - Link via `deposit_request_id` or `transaction_id`

#### B. Update Transaction on Approval
- When admin approves deposit:
  1. Update transaction status to 'completed'
  2. Set `completed_at` timestamp
  3. Set `created_by` to admin_id
  4. Create ledger entry:
     - Get or create wallet for user
     - Calculate balance_after
     - Create ledger entry with delta = amount
  5. Update wallet balance

#### C. Update Transaction on Rejection
- When admin rejects deposit:
  1. Update transaction status to 'rejected'
  2. Set `rejection_reason`
  3. Set `cancelled_at` timestamp
  4. Do NOT create ledger entry

#### D. Create Ledger Entry Function
- Helper function to create ledger entries:
  - Get wallet (or create if doesn't exist)
  - Calculate balance_after = current_balance + delta
  - Insert ledger entry
  - Update wallet balance

### 3. Frontend Changes

#### A. Show Transaction Information
- Display transaction ID in deposit details modal
- Show transaction status
- Link to transaction history

#### B. Transaction History View
- New page/component to view all transactions
- Filter by type, status, date range
- Show ledger entries for each transaction
- Export transaction history

#### C. Enhanced Deposit Details
- Show linked transaction ID
- Show transaction status
- Show ledger entry if completed
- Show balance before/after

### 4. API Endpoints Needed

#### New Endpoints:
- `GET /api/admin/transactions` - List all transactions
- `GET /api/admin/transactions/:id` - Get transaction details
- `GET /api/admin/transactions/:id/ledger` - Get ledger entries for transaction
- `GET /api/users/:id/transactions` - Get user's transaction history
- `GET /api/users/:id/ledger` - Get user's ledger entries

### 5. Benefits of Ledger System

1. **Full Audit Trail**: Every balance change is recorded
2. **Transaction History**: Complete history of all financial operations
3. **Balance Verification**: Can verify balances by summing ledger entries
4. **Reconciliation**: Easy to reconcile accounts
5. **Reporting**: Better financial reporting capabilities
6. **Compliance**: Meets regulatory requirements for financial record-keeping
7. **Reversibility**: Can reverse transactions if needed
8. **Multi-currency Support**: Each currency has its own ledger

### 6. Implementation Steps

1. **Phase 1: Database Migration**
   - Add transaction_id column to deposit_requests OR
   - Add deposit_request_id to transactions
   - Create indexes

2. **Phase 2: Backend Integration**
   - Modify create_deposit_request to create transaction
   - Modify approve_deposit to update transaction and create ledger entry
   - Modify reject_deposit to update transaction status
   - Create helper functions for ledger operations

3. **Phase 3: Frontend Updates**
   - Update deposit details modal to show transaction info
   - Create transaction history component
   - Add transaction links in deposit list

4. **Phase 4: Testing & Validation**
   - Test transaction creation
   - Test ledger entry creation
   - Verify balance calculations
   - Test transaction reversal (if needed)

### 7. Example Flow

**Deposit Request Created:**
```
1. User creates deposit request → deposit_requests table
2. System creates transaction → transactions table
   - status: 'pending'
   - type: 'deposit'
   - method: 'manual'
   - reference: deposit_request_id
3. Link: deposit_requests.transaction_id = transactions.id
```

**Deposit Approved:**
```
1. Admin approves → Update deposit_requests.status = 'APPROVED'
2. Update transaction → transactions.status = 'completed'
3. Get/create wallet → wallets table
4. Create ledger entry → ledger_entries table
   - delta: +amount
   - balance_after: current_balance + amount
5. Update wallet balance → wallets.available_balance += amount
```

**Deposit Rejected:**
```
1. Admin rejects → Update deposit_requests.status = 'REJECTED'
2. Update transaction → transactions.status = 'rejected'
3. Set rejection_reason
4. NO ledger entry created
```

## Files to Modify

### Backend:
- `backend/auth-service/src/routes/deposits.rs` - Main deposit logic
- Create: `backend/auth-service/src/services/ledger_service.rs` - Ledger operations
- Create: `backend/auth-service/src/services/transaction_service.rs` - Transaction operations

### Frontend:
- `src/features/admin/deposits/components/DepositDetailsModal.tsx` - Show transaction info
- Create: `src/features/admin/transactions/` - Transaction management
- `src/features/admin/deposits/types.ts` - Add transaction fields

### Database:
- Migration file to add transaction_id column
- Migration to ensure wallets table exists

