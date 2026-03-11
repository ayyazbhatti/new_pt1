-- Record which user (manager/admin/super_admin) created each leverage profile.

ALTER TABLE leverage_profiles
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leverage_profiles_created_by_user_id ON leverage_profiles(created_by_user_id);

COMMENT ON COLUMN leverage_profiles.created_by_user_id IS 'User (manager/admin/super_admin) who created this leverage profile.';
