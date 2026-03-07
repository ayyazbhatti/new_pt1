-- Permission definitions (categories + permissions) for admin UI and validation.
-- Single source of truth: UI and profile validation use this instead of hardcoded lists.

-- Categories (grouping for UI)
CREATE TABLE IF NOT EXISTS permission_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_permission_categories_name ON permission_categories(LOWER(name));

-- Permissions (key must match values stored in permission_profile_grants.permission_key)
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    permission_key VARCHAR(100) NOT NULL UNIQUE,
    label VARCHAR(255) NOT NULL,
    category_id UUID NOT NULL REFERENCES permission_categories(id) ON DELETE CASCADE,
    sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_permissions_category_id ON permissions(category_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_key ON permissions(permission_key);

-- Seed categories (idempotent: fixed UUIDs, skip if already present)
INSERT INTO permission_categories (id, name, sort_order)
VALUES
    ('a0000001-0000-0000-0000-000000000001'::uuid, 'Leads', 1),
    ('a0000002-0000-0000-0000-000000000001'::uuid, 'Trading & Finance', 2),
    ('a0000003-0000-0000-0000-000000000001'::uuid, 'Support', 3),
    ('a0000004-0000-0000-0000-000000000001'::uuid, 'Users & Groups', 4),
    ('a0000005-0000-0000-0000-000000000001'::uuid, 'Configuration', 5),
    ('a0000006-0000-0000-0000-000000000001'::uuid, 'Risk & Reports', 6),
    ('a0000007-0000-0000-0000-000000000001'::uuid, 'Other Admin', 7)
ON CONFLICT (id) DO NOTHING;

-- Seed permissions (idempotent: skip if key already exists)
INSERT INTO permissions (permission_key, label, category_id, sort_order)
VALUES
    ('leads:view_all', 'View all leads', 'a0000001-0000-0000-0000-000000000001'::uuid, 1),
    ('leads:view_assigned', 'View assigned leads', 'a0000001-0000-0000-0000-000000000001'::uuid, 2),
    ('leads:create', 'Create leads', 'a0000001-0000-0000-0000-000000000001'::uuid, 3),
    ('leads:edit', 'Edit leads', 'a0000001-0000-0000-0000-000000000001'::uuid, 4),
    ('leads:delete', 'Delete leads', 'a0000001-0000-0000-0000-000000000001'::uuid, 5),
    ('leads:assign', 'Assign leads', 'a0000001-0000-0000-0000-000000000001'::uuid, 6),
    ('leads:change_stage', 'Change stage', 'a0000001-0000-0000-0000-000000000001'::uuid, 7),
    ('leads:export', 'Export', 'a0000001-0000-0000-0000-000000000001'::uuid, 8),
    ('leads:settings', 'Settings', 'a0000001-0000-0000-0000-000000000001'::uuid, 9),
    ('leads:templates', 'Templates', 'a0000001-0000-0000-0000-000000000001'::uuid, 10),
    ('leads:assignment', 'Assignment rules', 'a0000001-0000-0000-0000-000000000001'::uuid, 11),
    ('leads:import', 'Import leads', 'a0000001-0000-0000-0000-000000000001'::uuid, 12),
    ('trading:view', 'View trading', 'a0000002-0000-0000-0000-000000000001'::uuid, 1),
    ('trading:place_orders', 'Place orders', 'a0000002-0000-0000-0000-000000000001'::uuid, 2),
    ('deposits:approve', 'Approve deposits', 'a0000002-0000-0000-0000-000000000001'::uuid, 3),
    ('deposits:reject', 'Reject deposits', 'a0000002-0000-0000-0000-000000000001'::uuid, 4),
    ('finance:view', 'View finance', 'a0000002-0000-0000-0000-000000000001'::uuid, 5),
    ('support:view', 'View support chat', 'a0000003-0000-0000-0000-000000000001'::uuid, 1),
    ('support:reply', 'Reply to users', 'a0000003-0000-0000-0000-000000000001'::uuid, 2),
    ('users:view', 'View users', 'a0000004-0000-0000-0000-000000000001'::uuid, 1),
    ('users:edit', 'Edit users', 'a0000004-0000-0000-0000-000000000001'::uuid, 2),
    ('users:create', 'Create users', 'a0000004-0000-0000-0000-000000000001'::uuid, 3),
    ('groups:view', 'View groups', 'a0000004-0000-0000-0000-000000000001'::uuid, 4),
    ('groups:edit', 'Edit groups', 'a0000004-0000-0000-0000-000000000001'::uuid, 5),
    ('symbols:view', 'View symbols', 'a0000005-0000-0000-0000-000000000001'::uuid, 1),
    ('symbols:edit', 'Edit symbols', 'a0000005-0000-0000-0000-000000000001'::uuid, 2),
    ('markup:view', 'View price markup', 'a0000005-0000-0000-0000-000000000001'::uuid, 3),
    ('markup:edit', 'Edit price markup', 'a0000005-0000-0000-0000-000000000001'::uuid, 4),
    ('swap:view', 'View swap rules', 'a0000005-0000-0000-0000-000000000001'::uuid, 5),
    ('swap:edit', 'Edit swap rules', 'a0000005-0000-0000-0000-000000000001'::uuid, 6),
    ('leverage_profiles:view', 'View leverage profiles', 'a0000005-0000-0000-0000-000000000001'::uuid, 7),
    ('leverage_profiles:edit', 'Edit leverage profiles', 'a0000005-0000-0000-0000-000000000001'::uuid, 8),
    ('risk:view', 'View risk', 'a0000006-0000-0000-0000-000000000001'::uuid, 1),
    ('risk:edit', 'Edit risk settings', 'a0000006-0000-0000-0000-000000000001'::uuid, 2),
    ('reports:view', 'View reports', 'a0000006-0000-0000-0000-000000000001'::uuid, 3),
    ('dashboard:view', 'View dashboard', 'a0000007-0000-0000-0000-000000000001'::uuid, 1),
    ('bonus:view', 'View bonus', 'a0000007-0000-0000-0000-000000000001'::uuid, 2),
    ('bonus:edit', 'Edit bonus', 'a0000007-0000-0000-0000-000000000001'::uuid, 3),
    ('affiliate:view', 'View affiliate', 'a0000007-0000-0000-0000-000000000001'::uuid, 4),
    ('affiliate:edit', 'Edit affiliate', 'a0000007-0000-0000-0000-000000000001'::uuid, 5),
    ('permissions:view', 'View permission profiles', 'a0000007-0000-0000-0000-000000000001'::uuid, 6),
    ('permissions:edit', 'Edit permission profiles', 'a0000007-0000-0000-0000-000000000001'::uuid, 7),
    ('system:view', 'View system', 'a0000007-0000-0000-0000-000000000001'::uuid, 8),
    ('settings:view', 'View settings', 'a0000007-0000-0000-0000-000000000001'::uuid, 9),
    ('settings:edit', 'Edit settings', 'a0000007-0000-0000-0000-000000000001'::uuid, 10)
ON CONFLICT (permission_key) DO NOTHING;
