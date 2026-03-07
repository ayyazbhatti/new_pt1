-- Split "Users & Groups" into two categories: "Users" and "Groups".

-- 1. Rename "Users & Groups" to "Users"
UPDATE permission_categories
SET name = 'Users'
WHERE id = 'a0000004-0000-0000-0000-000000000004';

-- 2. Insert new category "Groups" (sort_order 5); shift others down
INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a0000008-0000-0000-0000-000000000008', 'Groups', 5);

UPDATE permission_categories SET sort_order = 6 WHERE id = 'a0000005-0000-0000-0000-000000000005';
UPDATE permission_categories SET sort_order = 7 WHERE id = 'a0000006-0000-0000-0000-000000000006';
UPDATE permission_categories SET sort_order = 8 WHERE id = 'a0000007-0000-0000-0000-000000000007';

-- 3. Move groups:view and groups:edit to the new Groups category
UPDATE permissions
SET category_id = 'a0000008-0000-0000-0000-000000000008'
WHERE permission_key IN ('groups:view', 'groups:edit');
