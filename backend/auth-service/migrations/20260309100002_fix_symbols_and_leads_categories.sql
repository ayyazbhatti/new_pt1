-- Fix Symbols and Leads so they are separate: ensure each category has the correct name
-- and that symbols:* permissions belong to Symbols (a000000d) and leads:* to Leads (a0000015).

-- 1. Ensure Symbols category exists with correct name
INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a000000d-0000-0000-0000-00000000000d', 'Symbols', 13)
ON CONFLICT (id) DO UPDATE SET name = 'Symbols', sort_order = 13;

-- 2. Ensure Leads category exists with correct name
INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a0000015-0000-0000-0000-000000000015', 'Leads', 20)
ON CONFLICT (id) DO UPDATE SET name = 'Leads', sort_order = 20;

-- 3. Put all symbols:* permissions under Symbols category
UPDATE permissions
SET category_id = 'a000000d-0000-0000-0000-00000000000d'
WHERE permission_key IN ('symbols:view', 'symbols:edit', 'symbols:create', 'symbols:delete');

-- 4. Put all leads:* permissions under Leads category
UPDATE permissions
SET category_id = 'a0000015-0000-0000-0000-000000000015'
WHERE permission_key LIKE 'leads:%';
