-- Migration: Add deposit_request_id to transactions table
-- This links transactions to deposit_requests for proper ledger integration

-- Add column to transactions table
ALTER TABLE transactions 
ADD COLUMN deposit_request_id UUID;

-- Create index for faster lookups
CREATE INDEX idx_transactions_deposit_request_id 
ON transactions(deposit_request_id);

-- Add comment for documentation
COMMENT ON COLUMN transactions.deposit_request_id IS 
'Optional reference to deposit_requests table if this transaction was initiated via deposit request workflow';

-- Ensure deposit_requests table exists (if not already created)
-- Note: This assumes deposit_requests table structure:
-- CREATE TABLE IF NOT EXISTS deposit_requests (
--     id UUID PRIMARY KEY,
--     user_id UUID NOT NULL,
--     amount NUMERIC(20, 8) NOT NULL,
--     currency VARCHAR(10) NOT NULL,
--     note TEXT,
--     status VARCHAR(50) NOT NULL,
--     created_at TIMESTAMP WITH TIME ZONE NOT NULL,
--     updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
--     approved_at TIMESTAMP WITH TIME ZONE,
--     rejected_at TIMESTAMP WITH TIME ZONE,
--     admin_id UUID
-- );

