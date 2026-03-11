-- Record which user (manager/admin/super_admin) created each affiliate scheme (commission layer).

ALTER TABLE affiliate_commission_layers
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_affiliate_commission_layers_created_by_user_id ON affiliate_commission_layers(created_by_user_id);

COMMENT ON COLUMN affiliate_commission_layers.created_by_user_id IS 'User (manager/admin/super_admin) who created this affiliate scheme.';
