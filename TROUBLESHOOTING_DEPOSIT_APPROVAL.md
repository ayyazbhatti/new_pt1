# Troubleshooting Deposit Approval 400 Error

## Issue
Getting `400 Bad Request` when trying to approve deposit request `a082b753-2f4a-444f-8075-874e20af4d85`

## Root Cause
The deposit request is already in `APPROVED` status, not `PENDING`. The backend correctly rejects the request because you cannot approve an already-approved deposit.

## Solution

### Option 1: Test with a PENDING Deposit
Find a deposit request with status `PENDING`:

```sql
SELECT id, amount, status, created_at 
FROM deposit_requests 
WHERE status = 'PENDING' 
ORDER BY created_at DESC;
```

Then approve that one instead.

### Option 2: Create a New Deposit Request
1. Login as a regular user
2. Go to deposit page or use API:
   ```bash
   POST /api/deposits/request
   {
     "amount": 100.50,
     "note": "Test deposit for ledger"
   }
   ```
3. This will create a new deposit request with status `PENDING`
4. Then approve it via admin panel

### Option 3: Check Deposit Status Before Approving
The frontend should check the deposit status and disable the approve button if it's already approved.

## Verification

Check deposit status:
```sql
SELECT id, status, approved_at, admin_id 
FROM deposit_requests 
WHERE id = 'a082b753-2f4a-444f-8075-874e20af4d85';
```

## Expected Behavior

- ✅ **PENDING** deposit → Can be approved → Returns 200 OK
- ❌ **APPROVED** deposit → Cannot be approved → Returns 400 Bad Request
- ❌ **REJECTED** deposit → Cannot be approved → Returns 400 Bad Request

## Code Logic

The backend checks:
```rust
if current_status != "PENDING" {
    return Err(StatusCode::BAD_REQUEST);
}
```

This is **correct behavior** - you should only be able to approve pending deposits.

## Next Steps

1. Find or create a PENDING deposit request
2. Try approving that one
3. Verify transaction and ledger entry are created

