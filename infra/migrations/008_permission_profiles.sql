-- Permission profiles: named sets of access rights assignable to users (e.g. manager/agent).
-- Required for dynamic permissions (auth-service).

-- Table: permission_profiles
CREATE TABLE IF NOT EXISTS permission_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_permission_profiles_name ON permission_profiles(LOWER(name));

-- Table: permission_profile_grants (one row per permission key per profile)
CREATE TABLE IF NOT EXISTS permission_profile_grants (
    profile_id UUID NOT NULL REFERENCES permission_profiles(id) ON DELETE CASCADE,
    permission_key VARCHAR(100) NOT NULL,
    PRIMARY KEY (profile_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_permission_profile_grants_profile_id ON permission_profile_grants(profile_id);

-- Add permission_profile_id to users (nullable; when set, effective permissions = profile's grants)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'permission_profile_id'
    ) THEN
        ALTER TABLE users
          ADD COLUMN permission_profile_id UUID REFERENCES permission_profiles(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_users_permission_profile_id ON users(permission_profile_id);
    END IF;
END $$;
