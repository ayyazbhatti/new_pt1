-- Total margin calculation type on users: hedged (default) or net. Required by auth-service.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'margin_calculation_type'
    ) THEN
        ALTER TABLE users
          ADD COLUMN margin_calculation_type VARCHAR(20) NOT NULL DEFAULT 'hedged';
        ALTER TABLE users
          ADD CONSTRAINT users_margin_calculation_type_check CHECK (margin_calculation_type IN ('hedged', 'net'));
    END IF;
END $$;
