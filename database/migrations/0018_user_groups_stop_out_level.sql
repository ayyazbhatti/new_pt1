-- Migration: Add stop_out_level to user_groups (per-group threshold % for stop out / close all positions).
-- NULL = no automatic stop out in application logic.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_groups' AND column_name = 'stop_out_level'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN stop_out_level NUMERIC(5,2) NULL;
    END IF;
END $$;
