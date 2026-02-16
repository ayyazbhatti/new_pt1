-- Remove min_leverage and max_leverage from user_groups (leverage is now per-user, not per-group).

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_groups' AND column_name = 'min_leverage'
    ) THEN
        ALTER TABLE user_groups DROP COLUMN min_leverage;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_groups' AND column_name = 'max_leverage'
    ) THEN
        ALTER TABLE user_groups DROP COLUMN max_leverage;
    END IF;
    -- Legacy names from older schema
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_groups' AND column_name = 'max_leverage_min'
    ) THEN
        ALTER TABLE user_groups DROP COLUMN max_leverage_min;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_groups' AND column_name = 'max_leverage_max'
    ) THEN
        ALTER TABLE user_groups DROP COLUMN max_leverage_max;
    END IF;
END $$;
