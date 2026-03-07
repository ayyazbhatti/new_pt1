-- Add "Symbols" as a separate permission category and move symbols permissions into it.

INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a000000d-0000-0000-0000-00000000000d', 'Symbols', 13)
ON CONFLICT (id) DO NOTHING;

UPDATE permissions
SET category_id = 'a000000d-0000-0000-0000-00000000000d', sort_order = 1
WHERE permission_key = 'symbols:view';

UPDATE permissions
SET category_id = 'a000000d-0000-0000-0000-00000000000d', sort_order = 2
WHERE permission_key = 'symbols:edit';
