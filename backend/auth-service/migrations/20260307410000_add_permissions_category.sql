-- Add "Permissions" as a separate permission category (after Affiliate); move permission profile permissions into it.

INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a0000014-0000-0000-0000-000000000014', 'Permissions', 20)
ON CONFLICT (id) DO NOTHING;

UPDATE permissions
SET category_id = 'a0000014-0000-0000-0000-000000000014', sort_order = 1
WHERE permission_key = 'permissions:view';

UPDATE permissions
SET category_id = 'a0000014-0000-0000-0000-000000000014', sort_order = 2
WHERE permission_key = 'permissions:edit';
