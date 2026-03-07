-- Add "Swap" as a separate permission category and move swap permissions into it.

INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a000000f-0000-0000-0000-00000000000f', 'Swap', 15)
ON CONFLICT (id) DO NOTHING;

UPDATE permissions
SET category_id = 'a000000f-0000-0000-0000-00000000000f', sort_order = 1
WHERE permission_key = 'swap:view';

UPDATE permissions
SET category_id = 'a000000f-0000-0000-0000-00000000000f', sort_order = 2
WHERE permission_key = 'swap:edit';
