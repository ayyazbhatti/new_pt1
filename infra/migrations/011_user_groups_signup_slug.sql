-- Add signup_slug to user_groups for readable signup links (e.g. /register?ref=golduser).
ALTER TABLE user_groups ADD COLUMN IF NOT EXISTS signup_slug VARCHAR(20) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_groups_signup_slug ON user_groups(signup_slug) WHERE signup_slug IS NOT NULL;
