-- Account type: hedging (default) or netting. Used by admin UI; execution logic unchanged in this phase.
-- Default 'hedging' keeps current behaviour for all existing users.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'account_type'
    ) THEN
        ALTER TABLE users
          ADD COLUMN account_type VARCHAR(20) NOT NULL DEFAULT 'hedging';
        ALTER TABLE users
          ADD CONSTRAINT users_account_type_check CHECK (account_type IN ('hedging', 'netting'));
    END IF;
END $$;
