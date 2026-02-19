-- Migration: Add margin_call_level to user_groups (per-group threshold % for margin call warning).
-- NULL = use platform default (e.g. 50%) in application logic.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_groups' AND column_name = 'margin_call_level'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN margin_call_level NUMERIC(5,2) NULL;
    END IF;
END $$;
