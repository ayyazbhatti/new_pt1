-- Split "Trading & Finance" into "Trading" and "Finance" sections.

-- 1. Rename category to "Trading" (keep trading:view, trading:place_orders in it)
UPDATE permission_categories
SET name = 'Trading'
WHERE id = 'a0000002-0000-0000-0000-000000000002';

-- 2. Insert "Finance" category (sort_order 3); shift Support and later categories down
INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a000000b-0000-0000-0000-00000000000b', 'Finance', 3)
ON CONFLICT (id) DO NOTHING;

UPDATE permission_categories SET sort_order = 4 WHERE id = 'a0000003-0000-0000-0000-000000000003';
UPDATE permission_categories SET sort_order = 5 WHERE id = 'a0000004-0000-0000-0000-000000000004';
UPDATE permission_categories SET sort_order = 6 WHERE id = 'a0000005-0000-0000-0000-000000000005';
UPDATE permission_categories SET sort_order = 7 WHERE id = 'a0000006-0000-0000-0000-000000000006';
UPDATE permission_categories SET sort_order = 8 WHERE id = 'a0000007-0000-0000-0000-000000000007';
UPDATE permission_categories SET sort_order = 9 WHERE id = 'a0000008-0000-0000-0000-000000000008';
UPDATE permission_categories SET sort_order = 10 WHERE id = 'a0000009-0000-0000-0000-000000000009';
UPDATE permission_categories SET sort_order = 11 WHERE id = 'a000000a-0000-0000-0000-00000000000a';

-- 3. Move deposits and finance permissions to Finance category
UPDATE permissions
SET category_id = 'a000000b-0000-0000-0000-00000000000b', sort_order = 1
WHERE permission_key = 'deposits:approve';

UPDATE permissions
SET category_id = 'a000000b-0000-0000-0000-00000000000b', sort_order = 2
WHERE permission_key = 'deposits:reject';

UPDATE permissions
SET category_id = 'a000000b-0000-0000-0000-00000000000b', sort_order = 3
WHERE permission_key = 'finance:view';
