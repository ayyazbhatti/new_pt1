-- Remove max_open_positions and max_open_orders from user_groups (no longer used per group).

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_groups' AND column_name = 'max_open_positions'
    ) THEN
        ALTER TABLE user_groups DROP COLUMN max_open_positions;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_groups' AND column_name = 'max_open_orders'
    ) THEN
        ALTER TABLE user_groups DROP COLUMN max_open_orders;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_groups' AND column_name = 'max_open_positions_per_user'
    ) THEN
        ALTER TABLE user_groups DROP COLUMN max_open_positions_per_user;
    END IF;
END $$;
