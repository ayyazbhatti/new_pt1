-- Managers: users promoted to admin with a permission profile. One row per manager.
-- users.permission_profile_id is kept in sync when status = 'active'.
-- Requires: permission_profiles (008_permission_profiles.sql).

CREATE TABLE IF NOT EXISTS managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  permission_profile_id UUID NOT NULL REFERENCES permission_profiles(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_managers_user_id ON managers(user_id);
CREATE INDEX IF NOT EXISTS idx_managers_status ON managers(status);
CREATE INDEX IF NOT EXISTS idx_managers_permission_profile_id ON managers(permission_profile_id);

COMMENT ON TABLE managers IS 'Staff with admin access; links user to a permission profile. users.permission_profile_id synced when status=active.';
