-- Sync with auth User model and register flow (compare with local DB / database/schema + 0001_auth_users).
-- 1) users.last_login_at (User model expects this name; auth_service updates it on login).
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;
-- 2) user_groups: signup_slug (auth register ?ref=slug) + columns from 016.
ALTER TABLE user_groups ADD COLUMN IF NOT EXISTS signup_slug VARCHAR(20) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_groups_signup_slug ON user_groups(signup_slug) WHERE signup_slug IS NOT NULL;
ALTER TABLE user_groups ADD COLUMN IF NOT EXISTS default_price_profile_id UUID NULL;
ALTER TABLE user_groups ADD COLUMN IF NOT EXISTS default_leverage_profile_id UUID NULL;
ALTER TABLE user_groups ADD COLUMN IF NOT EXISTS margin_call_level NUMERIC(5,2) NULL;
ALTER TABLE user_groups ADD COLUMN IF NOT EXISTS stop_out_level NUMERIC(5,2) NULL;
