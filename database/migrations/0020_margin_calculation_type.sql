-- Total margin calculation type: hedged (sum of all positions) or net (per-symbol net then sum).
-- Default 'hedged' keeps current behaviour for all existing users.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'margin_calculation_type'
    ) THEN
        ALTER TABLE users
          ADD COLUMN margin_calculation_type VARCHAR(20) NOT NULL DEFAULT 'hedged';
        ALTER TABLE users
          ADD CONSTRAINT users_margin_calculation_type_check CHECK (margin_calculation_type IN ('hedged', 'net'));
    END IF;
END $$;
