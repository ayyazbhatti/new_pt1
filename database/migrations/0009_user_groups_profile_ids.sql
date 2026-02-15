-- Migration: Add default_price_profile_id and default_leverage_profile_id to user_groups
-- So GET /api/admin/groups can return price_profile and leverage_profile for each group.
-- Columns added without REFERENCES so migration succeeds even if profile tables are missing.

-- Add default_price_profile_id if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_groups' AND column_name = 'default_price_profile_id'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN default_price_profile_id UUID NULL;
    END IF;
END $$;

-- Add default_leverage_profile_id if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_groups' AND column_name = 'default_leverage_profile_id'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN default_leverage_profile_id UUID NULL;
    END IF;
END $$;
