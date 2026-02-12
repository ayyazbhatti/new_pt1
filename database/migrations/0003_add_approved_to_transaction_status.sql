-- Migration: Add 'approved' to transaction_status enum
-- This allows us to use 'approved' status instead of 'completed'

-- Add 'approved' to the enum if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'approved' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'transaction_status')
    ) THEN
        ALTER TYPE transaction_status ADD VALUE 'approved';
    END IF;
END $$;

-- Update existing 'completed' transactions to 'approved' (optional - comment out if you want to keep them separate)
-- UPDATE transactions SET status = 'approved'::transaction_status WHERE status = 'completed'::transaction_status;

