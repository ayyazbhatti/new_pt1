-- Migration: Remove deposit_requests table
-- We now use only the transactions table for deposit requests

-- Drop foreign key constraint from transactions table if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'transactions_deposit_request_id_fkey'
        AND table_name = 'transactions'
    ) THEN
        ALTER TABLE transactions DROP CONSTRAINT transactions_deposit_request_id_fkey;
    END IF;
END $$;

-- Drop the deposit_request_id column from transactions table
ALTER TABLE transactions DROP COLUMN IF EXISTS deposit_request_id;

-- Drop the deposit_requests table
DROP TABLE IF EXISTS deposit_requests CASCADE;

