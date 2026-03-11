-- Record which user (manager/admin/super_admin) created each tag.

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tags_created_by_user_id ON tags(created_by_user_id);

COMMENT ON COLUMN tags.created_by_user_id IS 'User (manager/admin/super_admin) who created this tag.';
