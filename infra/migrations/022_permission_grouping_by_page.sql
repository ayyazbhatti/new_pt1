-- Group permissions by page (same as auth-service migrations / Saturday grouping).
-- Rename combined categories, add separate categories per page, move permissions into them.
-- Idempotent: safe to run multiple times.

-- 1. Rename "Users & Groups" -> "Users", "Trading & Finance" -> "Trading"
UPDATE permission_categories SET name = 'Users' WHERE LOWER(name) = 'users & groups';
UPDATE permission_categories SET name = 'Trading' WHERE LOWER(name) = 'trading & finance';

-- 2. Add new categories (one per page) – only if name doesn't exist (idempotent)
INSERT INTO permission_categories (id, name, sort_order)
SELECT v.id, v.name, v.sort_order FROM (VALUES
  ('a0000010-0000-0000-0000-000000000010'::uuid, 'Groups', 6),
  ('a0000011-0000-0000-0000-000000000011'::uuid, 'Tags', 7),
  ('a0000012-0000-0000-0000-000000000012'::uuid, 'Managers', 8),
  ('a0000013-0000-0000-0000-000000000013'::uuid, 'Finance', 3),
  ('a0000014-0000-0000-0000-000000000014'::uuid, 'Leverage Profiles', 9),
  ('a0000015-0000-0000-0000-000000000015'::uuid, 'Symbols', 10),
  ('a0000016-0000-0000-0000-000000000016'::uuid, 'Markup', 11),
  ('a0000017-0000-0000-0000-000000000017'::uuid, 'Swap', 12),
  ('a0000018-0000-0000-0000-000000000018'::uuid, 'Affiliate', 13),
  ('a0000019-0000-0000-0000-000000000019'::uuid, 'Permissions', 14),
  ('a0000020-0000-0000-0000-000000000020'::uuid, 'Settings', 19)
) AS v(id, name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM permission_categories c WHERE LOWER(c.name) = LOWER(v.name));

-- 3. Set sort_order so UI order matches: Leads, Trading, Finance, Support, Users, Groups, Tags, Managers, ...
UPDATE permission_categories SET sort_order = 1 WHERE LOWER(name) = 'leads';
UPDATE permission_categories SET sort_order = 2 WHERE LOWER(name) = 'trading';
UPDATE permission_categories SET sort_order = 3 WHERE LOWER(name) = 'finance';
UPDATE permission_categories SET sort_order = 4 WHERE LOWER(name) = 'support';
UPDATE permission_categories SET sort_order = 5 WHERE LOWER(name) = 'users';
UPDATE permission_categories SET sort_order = 6 WHERE LOWER(name) = 'groups';
UPDATE permission_categories SET sort_order = 7 WHERE LOWER(name) = 'tags';
UPDATE permission_categories SET sort_order = 8 WHERE LOWER(name) = 'managers';
UPDATE permission_categories SET sort_order = 9 WHERE LOWER(name) = 'leverage profiles';
UPDATE permission_categories SET sort_order = 10 WHERE LOWER(name) = 'symbols';
UPDATE permission_categories SET sort_order = 11 WHERE LOWER(name) = 'markup';
UPDATE permission_categories SET sort_order = 12 WHERE LOWER(name) = 'swap';
UPDATE permission_categories SET sort_order = 13 WHERE LOWER(name) = 'affiliate';
UPDATE permission_categories SET sort_order = 14 WHERE LOWER(name) = 'permissions';
UPDATE permission_categories SET sort_order = 15 WHERE LOWER(name) = 'call';
UPDATE permission_categories SET sort_order = 16 WHERE LOWER(name) = 'appointments';
UPDATE permission_categories SET sort_order = 17 WHERE LOWER(name) = 'settings';
UPDATE permission_categories SET sort_order = 18 WHERE LOWER(name) = 'risk & reports';
UPDATE permission_categories SET sort_order = 19 WHERE LOWER(name) = 'configuration';
UPDATE permission_categories SET sort_order = 20 WHERE LOWER(name) = 'other admin';

-- 4. Move permissions to the correct category (by name lookup)
-- Groups
UPDATE permissions SET category_id = (SELECT id FROM permission_categories WHERE LOWER(name) = 'groups' LIMIT 1)
WHERE permission_key IN ('groups:view', 'groups:edit', 'groups:create', 'groups:delete', 'groups:symbol_settings', 'groups:price_profile', 'groups:tags');

-- Tags
UPDATE permissions SET category_id = (SELECT id FROM permission_categories WHERE LOWER(name) = 'tags' LIMIT 1)
WHERE permission_key IN ('tags:view', 'tags:create', 'tags:edit', 'tags:delete');

-- Managers
UPDATE permissions SET category_id = (SELECT id FROM permission_categories WHERE LOWER(name) = 'managers' LIMIT 1)
WHERE permission_key IN ('managers:view', 'managers:create', 'managers:edit', 'managers:delete');

-- Finance (from old Trading & Finance)
UPDATE permissions SET category_id = (SELECT id FROM permission_categories WHERE LOWER(name) = 'finance' LIMIT 1)
WHERE permission_key IN ('deposits:approve', 'deposits:reject', 'finance:view', 'finance:manual_adjustment');

-- Leverage Profiles
UPDATE permissions SET category_id = (SELECT id FROM permission_categories WHERE LOWER(name) = 'leverage profiles' LIMIT 1)
WHERE permission_key IN ('leverage_profiles:view', 'leverage_profiles:edit', 'leverage_profiles:create', 'leverage_profiles:delete');

-- Symbols
UPDATE permissions SET category_id = (SELECT id FROM permission_categories WHERE LOWER(name) = 'symbols' LIMIT 1)
WHERE permission_key IN ('symbols:view', 'symbols:edit', 'symbols:create', 'symbols:delete');

-- Markup
UPDATE permissions SET category_id = (SELECT id FROM permission_categories WHERE LOWER(name) = 'markup' LIMIT 1)
WHERE permission_key IN ('markup:view', 'markup:edit', 'markup:create', 'markup:delete');

-- Swap
UPDATE permissions SET category_id = (SELECT id FROM permission_categories WHERE LOWER(name) = 'swap' LIMIT 1)
WHERE permission_key IN ('swap:view', 'swap:edit', 'swap:create', 'swap:delete');

-- Affiliate
UPDATE permissions SET category_id = (SELECT id FROM permission_categories WHERE LOWER(name) = 'affiliate' LIMIT 1)
WHERE permission_key IN ('affiliate:view', 'affiliate:edit', 'affiliate:create', 'affiliate:delete');

-- Permissions (profile)
UPDATE permissions SET category_id = (SELECT id FROM permission_categories WHERE LOWER(name) = 'permissions' LIMIT 1)
WHERE permission_key IN ('permissions:view', 'permissions:edit');

-- Settings
UPDATE permissions SET category_id = (SELECT id FROM permission_categories WHERE LOWER(name) = 'settings' LIMIT 1)
WHERE permission_key IN ('settings:view', 'settings:edit');
