-- Record which user (manager/admin/super_admin) created each swap rule.

ALTER TABLE swap_rules
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_swap_rules_created_by_user_id ON swap_rules(created_by_user_id);

COMMENT ON COLUMN swap_rules.created_by_user_id IS 'User (manager/admin/super_admin) who created this swap rule.';
