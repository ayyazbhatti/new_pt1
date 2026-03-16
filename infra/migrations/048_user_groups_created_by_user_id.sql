-- UserGroup model expects created_by_user_id (admin_groups_service SELECT * FROM user_groups).
ALTER TABLE user_groups
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_user_groups_created_by_user_id ON user_groups(created_by_user_id);
