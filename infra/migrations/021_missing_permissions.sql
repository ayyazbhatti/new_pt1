-- Add missing permission categories and permissions so all admin pages have corresponding access rights.
-- Uses existing category names for lookup (works with infra 019 schema). Idempotent: ON CONFLICT DO NOTHING.

-- New categories (if not exist) for Call and Appointments
INSERT INTO permission_categories (id, name, sort_order)
SELECT 'a0000008-0000-0000-0000-000000000008', 'Call', 8
WHERE NOT EXISTS (SELECT 1 FROM permission_categories WHERE LOWER(name) = 'call');

INSERT INTO permission_categories (id, name, sort_order)
SELECT 'a0000009-0000-0000-0000-000000000009', 'Appointments', 9
WHERE NOT EXISTS (SELECT 1 FROM permission_categories WHERE LOWER(name) = 'appointments');

-- Trading & Finance: trading actions + finance manual adjustment
INSERT INTO permissions (permission_key, label, category_id, sort_order)
SELECT k, l, (SELECT id FROM permission_categories WHERE LOWER(name) = 'trading & finance' LIMIT 1), s
FROM (VALUES
  ('trading:create_order', 'Create order', 10),
  ('trading:cancel_order', 'Cancel order', 11),
  ('trading:close_position', 'Close position', 12),
  ('trading:liquidate', 'Liquidate position', 13),
  ('finance:manual_adjustment', 'Manual adjustment', 14)
) AS v(k, l, s)
ON CONFLICT (permission_key) DO NOTHING;

-- Support: new chat
INSERT INTO permissions (permission_key, label, category_id, sort_order)
SELECT 'support:new_chat', 'New chat', id, 10
FROM permission_categories WHERE LOWER(name) = 'support' LIMIT 1
ON CONFLICT (permission_key) DO NOTHING;

-- Call category: call:view
INSERT INTO permissions (permission_key, label, category_id, sort_order)
SELECT 'call:view', 'Call user', id, 1
FROM permission_categories WHERE LOWER(name) = 'call' LIMIT 1
ON CONFLICT (permission_key) DO NOTHING;

-- Users & Groups: bulk create, column permissions, groups actions, managers
INSERT INTO permissions (permission_key, label, category_id, sort_order)
SELECT k, l, (SELECT id FROM permission_categories WHERE LOWER(name) = 'users & groups' LIMIT 1), s
FROM (VALUES
  ('users:bulk_create', 'Bulk create users', 10),
  ('users:edit_group', 'Assign user to group', 11),
  ('users:edit_account_type', 'Edit account type', 12),
  ('groups:create', 'Create groups', 13),
  ('groups:delete', 'Delete groups', 14),
  ('groups:symbol_settings', 'Symbol settings', 15),
  ('groups:price_profile', 'Edit price profile', 16),
  ('groups:tags', 'Tags', 17),
  ('managers:view', 'View managers', 18),
  ('managers:create', 'Create managers', 19),
  ('managers:edit', 'Edit managers', 20),
  ('managers:delete', 'Delete managers', 21)
) AS v(k, l, s)
ON CONFLICT (permission_key) DO NOTHING;

-- Configuration: tags, symbols, markup, swap, leverage_profiles
INSERT INTO permissions (permission_key, label, category_id, sort_order)
SELECT k, l, (SELECT id FROM permission_categories WHERE LOWER(name) = 'configuration' LIMIT 1), s
FROM (VALUES
  ('tags:view', 'View tags', 20),
  ('tags:create', 'Create tags', 21),
  ('tags:edit', 'Edit tags', 22),
  ('tags:delete', 'Delete tags', 23),
  ('symbols:create', 'Create symbols', 24),
  ('symbols:delete', 'Delete symbols', 25),
  ('markup:create', 'Create markup profiles', 26),
  ('markup:delete', 'Delete markup profiles', 27),
  ('swap:create', 'Create swap rules', 28),
  ('swap:delete', 'Delete swap rules', 29),
  ('leverage_profiles:create', 'Create leverage profiles', 30),
  ('leverage_profiles:delete', 'Delete leverage profiles', 31)
) AS v(k, l, s)
ON CONFLICT (permission_key) DO NOTHING;

-- Other Admin: affiliate create/delete
INSERT INTO permissions (permission_key, label, category_id, sort_order)
SELECT k, l, (SELECT id FROM permission_categories WHERE LOWER(name) = 'other admin' LIMIT 1), s
FROM (VALUES
  ('affiliate:create', 'Create affiliate schemes', 11),
  ('affiliate:delete', 'Delete affiliate schemes', 12)
) AS v(k, l, s)
ON CONFLICT (permission_key) DO NOTHING;

-- Appointments category: all appointment actions
INSERT INTO permissions (permission_key, label, category_id, sort_order)
SELECT k, l, (SELECT id FROM permission_categories WHERE LOWER(name) = 'appointments' LIMIT 1), s
FROM (VALUES
  ('appointments:view', 'View appointments', 1),
  ('appointments:create', 'Create appointments', 2),
  ('appointments:edit', 'Edit appointments', 3),
  ('appointments:delete', 'Delete appointments', 4),
  ('appointments:reschedule', 'Reschedule appointments', 5),
  ('appointments:cancel', 'Cancel appointments', 6),
  ('appointments:complete', 'Complete appointments', 7),
  ('appointments:send_reminder', 'Send reminder', 8)
) AS v(k, l, s)
ON CONFLICT (permission_key) DO NOTHING;
