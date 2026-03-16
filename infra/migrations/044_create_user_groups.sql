-- user_groups is required for auth register (default group and group_id checks).
CREATE TABLE IF NOT EXISTS user_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255),
    description TEXT,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO user_groups (id, name, description, status)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'Default', 'Default user group', 'active')
ON CONFLICT (id) DO NOTHING;

-- auth register INSERT uses these on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS min_leverage INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_leverage INTEGER;
