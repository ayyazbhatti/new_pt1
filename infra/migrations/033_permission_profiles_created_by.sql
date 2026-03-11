-- Record which user (manager/admin/super_admin) created each permission profile.

ALTER TABLE permission_profiles
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_permission_profiles_created_by_user_id ON permission_profiles(created_by_user_id);

COMMENT ON COLUMN permission_profiles.created_by_user_id IS 'User (manager/admin/super_admin) who created this permission profile.';
