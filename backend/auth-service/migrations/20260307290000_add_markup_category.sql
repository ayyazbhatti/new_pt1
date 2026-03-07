-- Add "Markup" as a separate permission category and move markup permissions into it.

INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a000000e-0000-0000-0000-00000000000e', 'Markup', 14)
ON CONFLICT (id) DO NOTHING;

UPDATE permissions
SET category_id = 'a000000e-0000-0000-0000-00000000000e', sort_order = 1
WHERE permission_key = 'markup:view';

UPDATE permissions
SET category_id = 'a000000e-0000-0000-0000-00000000000e', sort_order = 2
WHERE permission_key = 'markup:edit';
