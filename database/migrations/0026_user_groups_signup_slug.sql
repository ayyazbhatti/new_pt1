-- Add signup_slug to user_groups for readable signup links (e.g. /register?ref=golduser).
-- Unique, 3-20 chars; optional for existing groups.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_groups' AND column_name = 'signup_slug'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN signup_slug VARCHAR(20) NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_user_groups_signup_slug ON user_groups(signup_slug) WHERE signup_slug IS NOT NULL;
    END IF;
END $$;
