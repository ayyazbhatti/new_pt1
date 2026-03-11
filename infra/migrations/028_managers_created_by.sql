-- Record which user (manager/admin/super_admin) created each manager record.

ALTER TABLE managers
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_managers_created_by_user_id ON managers(created_by_user_id);

COMMENT ON COLUMN managers.created_by_user_id IS 'User (manager/admin/super_admin) who created this manager record.';
