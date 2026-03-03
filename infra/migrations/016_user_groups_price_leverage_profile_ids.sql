-- Add default_price_profile_id and default_leverage_profile_id to user_groups
-- so GET /api/admin/groups returns price_profile and leverage_profile (list uses full query).
-- Run this if your user_groups was created without these columns (e.g. infra-only migrations).

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user_groups' AND column_name = 'default_price_profile_id'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN default_price_profile_id UUID NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user_groups' AND column_name = 'default_leverage_profile_id'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN default_leverage_profile_id UUID NULL;
    END IF;
END $$;

-- Optional: ensure margin_call_level and stop_out_level exist (required by list_groups_full)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user_groups' AND column_name = 'margin_call_level'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN margin_call_level NUMERIC(5,2) NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user_groups' AND column_name = 'stop_out_level'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN stop_out_level NUMERIC(5,2) NULL;
    END IF;
END $$;
