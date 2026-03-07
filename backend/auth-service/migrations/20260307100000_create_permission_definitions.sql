-- Permission definitions (categories + permissions) for admin UI and validation.
-- Single source of truth: UI loads from here; profile create/update validates keys against permissions.permission_key.

CREATE TABLE permission_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permission_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES permission_categories(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_permissions_category_id ON permissions(category_id);
CREATE INDEX idx_permissions_key ON permissions(permission_key);

COMMENT ON TABLE permission_categories IS 'Groups of permissions shown in admin UI (e.g. Leads, Trading & Finance).';
COMMENT ON TABLE permissions IS 'All valid permission keys and labels; profile grants reference permission_key.';

-- Seed categories (sort_order matches frontend order)
INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'Leads', 1),
  ('a0000002-0000-0000-0000-000000000002', 'Trading & Finance', 2),
  ('a0000003-0000-0000-0000-000000000003', 'Support', 3),
  ('a0000004-0000-0000-0000-000000000004', 'Users & Groups', 4),
  ('a0000005-0000-0000-0000-000000000005', 'Configuration', 5),
  ('a0000006-0000-0000-0000-000000000006', 'Risk & Reports', 6),
  ('a0000007-0000-0000-0000-000000000007', 'Other Admin', 7);

-- Seed permissions (category_id, permission_key, label, sort_order)
INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('leads:view_all', 'View all leads', 'a0000001-0000-0000-0000-000000000001', 1),
  ('leads:view_assigned', 'View assigned leads', 'a0000001-0000-0000-0000-000000000001', 2),
  ('leads:create', 'Create leads', 'a0000001-0000-0000-0000-000000000001', 3),
  ('leads:edit', 'Edit leads', 'a0000001-0000-0000-0000-000000000001', 4),
  ('leads:delete', 'Delete leads', 'a0000001-0000-0000-0000-000000000001', 5),
  ('leads:assign', 'Assign leads', 'a0000001-0000-0000-0000-000000000001', 6),
  ('leads:change_stage', 'Change stage', 'a0000001-0000-0000-0000-000000000001', 7),
  ('leads:export', 'Export', 'a0000001-0000-0000-0000-000000000001', 8),
  ('leads:settings', 'Settings', 'a0000001-0000-0000-0000-000000000001', 9),
  ('leads:templates', 'Templates', 'a0000001-0000-0000-0000-000000000001', 10),
  ('leads:assignment', 'Assignment rules', 'a0000001-0000-0000-0000-000000000001', 11),
  ('leads:import', 'Import leads', 'a0000001-0000-0000-0000-000000000001', 12),
  ('trading:view', 'View trading', 'a0000002-0000-0000-0000-000000000002', 1),
  ('trading:place_orders', 'Place orders', 'a0000002-0000-0000-0000-000000000002', 2),
  ('deposits:approve', 'Approve deposits', 'a0000002-0000-0000-0000-000000000002', 3),
  ('deposits:reject', 'Reject deposits', 'a0000002-0000-0000-0000-000000000002', 4),
  ('finance:view', 'View finance', 'a0000002-0000-0000-0000-000000000002', 5),
  ('support:view', 'View support chat', 'a0000003-0000-0000-0000-000000000003', 1),
  ('support:reply', 'Reply to users', 'a0000003-0000-0000-0000-000000000003', 2),
  ('users:view', 'View users', 'a0000004-0000-0000-0000-000000000004', 1),
  ('users:edit', 'Edit users', 'a0000004-0000-0000-0000-000000000004', 2),
  ('users:create', 'Create users', 'a0000004-0000-0000-0000-000000000004', 3),
  ('groups:view', 'View groups', 'a0000004-0000-0000-0000-000000000004', 4),
  ('groups:edit', 'Edit groups', 'a0000004-0000-0000-0000-000000000004', 5),
  ('symbols:view', 'View symbols', 'a0000005-0000-0000-0000-000000000005', 1),
  ('symbols:edit', 'Edit symbols', 'a0000005-0000-0000-0000-000000000005', 2),
  ('markup:view', 'View price markup', 'a0000005-0000-0000-0000-000000000005', 3),
  ('markup:edit', 'Edit price markup', 'a0000005-0000-0000-0000-000000000005', 4),
  ('swap:view', 'View swap rules', 'a0000005-0000-0000-0000-000000000005', 5),
  ('swap:edit', 'Edit swap rules', 'a0000005-0000-0000-0000-000000000005', 6),
  ('leverage_profiles:view', 'View leverage profiles', 'a0000005-0000-0000-0000-000000000005', 7),
  ('leverage_profiles:edit', 'Edit leverage profiles', 'a0000005-0000-0000-0000-000000000005', 8),
  ('risk:view', 'View risk', 'a0000006-0000-0000-0000-000000000006', 1),
  ('risk:edit', 'Edit risk settings', 'a0000006-0000-0000-0000-000000000006', 2),
  ('reports:view', 'View reports', 'a0000006-0000-0000-0000-000000000006', 3),
  ('dashboard:view', 'View dashboard', 'a0000007-0000-0000-0000-000000000007', 1),
  ('bonus:view', 'View bonus', 'a0000007-0000-0000-0000-000000000007', 2),
  ('bonus:edit', 'Edit bonus', 'a0000007-0000-0000-0000-000000000007', 3),
  ('affiliate:view', 'View affiliate', 'a0000007-0000-0000-0000-000000000007', 4),
  ('affiliate:edit', 'Edit affiliate', 'a0000007-0000-0000-0000-000000000007', 5),
  ('permissions:view', 'View permission profiles', 'a0000007-0000-0000-0000-000000000007', 6),
  ('permissions:edit', 'Edit permission profiles', 'a0000007-0000-0000-0000-000000000007', 7),
  ('system:view', 'View system', 'a0000007-0000-0000-0000-000000000007', 8),
  ('settings:view', 'View settings', 'a0000007-0000-0000-0000-000000000007', 9),
  ('settings:edit', 'Edit settings', 'a0000007-0000-0000-0000-000000000007', 10);
