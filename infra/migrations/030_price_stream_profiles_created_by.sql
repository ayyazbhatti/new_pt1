-- Record which user (manager/admin/super_admin) created each markup (price stream) profile.

ALTER TABLE price_stream_profiles
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_price_stream_profiles_created_by_user_id ON price_stream_profiles(created_by_user_id);

COMMENT ON COLUMN price_stream_profiles.created_by_user_id IS 'User (manager/admin/super_admin) who created this markup profile.';
