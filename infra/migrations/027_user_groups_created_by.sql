-- Record which user (manager/admin/super_admin) created each group.

ALTER TABLE user_groups
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_groups_created_by_user_id ON user_groups(created_by_user_id);

COMMENT ON COLUMN user_groups.created_by_user_id IS 'User (manager/admin/super_admin) who created this group.';
