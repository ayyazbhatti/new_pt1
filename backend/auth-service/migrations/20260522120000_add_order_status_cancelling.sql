-- Add 'cancelling' status to order_status enum for split-brain prevention on order cancellation.
-- The cancelling state means: API has accepted the cancel request and forwarded to engine,
-- but engine has not yet confirmed via evt.order.updated.
--
-- Wrapped in DO block for idempotency. If your migration runner wraps this file in a transaction
-- and ALTER TYPE fails, run this statement outside a transaction (see database/migrations/0003 pattern).

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'cancelling'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'order_status')
    ) THEN
        ALTER TYPE order_status ADD VALUE 'cancelling' BEFORE 'cancelled';
    END IF;
END $$;
