-- Add "Settings" as a separate permission category (after Appointments); move settings permissions into it.

INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a0000013-0000-0000-0000-000000000013', 'Settings', 19)
ON CONFLICT (id) DO NOTHING;

UPDATE permissions
SET category_id = 'a0000013-0000-0000-0000-000000000013', sort_order = 1
WHERE permission_key = 'settings:view';

UPDATE permissions
SET category_id = 'a0000013-0000-0000-0000-000000000013', sort_order = 2
WHERE permission_key = 'settings:edit';
