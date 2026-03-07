-- Add a separate "Tags" permission category (like Users and Groups) and move tags:view into it.
-- Tags appears after Users and Groups in the UI.

-- 1. Insert "Tags" category (sort_order 6); shift Configuration, Risk, Other down
INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a0000009-0000-0000-0000-000000000009', 'Tags', 6);

UPDATE permission_categories SET sort_order = 7 WHERE id = 'a0000005-0000-0000-0000-000000000005';
UPDATE permission_categories SET sort_order = 8 WHERE id = 'a0000006-0000-0000-0000-000000000006';
UPDATE permission_categories SET sort_order = 9 WHERE id = 'a0000007-0000-0000-0000-000000000007';

-- 2. Move tags:view from Other Admin to the new Tags category
UPDATE permissions
SET category_id = 'a0000009-0000-0000-0000-000000000009', sort_order = 1
WHERE permission_key = 'tags:view';
