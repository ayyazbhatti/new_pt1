-- Trading panel access: full (default), close_only, disabled.
-- full = can open and close; close_only = can only close; disabled = cannot trade.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'trading_access'
    ) THEN
        ALTER TABLE users
          ADD COLUMN trading_access VARCHAR(20) NOT NULL DEFAULT 'full';
        ALTER TABLE users
          ADD CONSTRAINT users_trading_access_check CHECK (trading_access IN ('full', 'close_only', 'disabled'));
    END IF;
END $$;
