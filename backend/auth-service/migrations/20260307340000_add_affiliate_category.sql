-- Add "Affiliate" as a separate permission category and move affiliate permissions into it.

INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a0000010-0000-0000-0000-000000000010', 'Affiliate', 16)
ON CONFLICT (id) DO NOTHING;

UPDATE permissions
SET category_id = 'a0000010-0000-0000-0000-000000000010', sort_order = 1
WHERE permission_key = 'affiliate:view';

UPDATE permissions
SET category_id = 'a0000010-0000-0000-0000-000000000010', sort_order = 2
WHERE permission_key = 'affiliate:edit';
