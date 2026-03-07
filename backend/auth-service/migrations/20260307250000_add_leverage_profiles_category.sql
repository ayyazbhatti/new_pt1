-- Add "Leverage Profiles" as a separate permission category and move leverage_profiles permissions into it.

INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a000000c-0000-0000-0000-00000000000c', 'Leverage Profiles', 12)
ON CONFLICT (id) DO NOTHING;

UPDATE permissions
SET category_id = 'a000000c-0000-0000-0000-00000000000c', sort_order = 1
WHERE permission_key = 'leverage_profiles:view';

UPDATE permissions
SET category_id = 'a000000c-0000-0000-0000-00000000000c', sort_order = 2
WHERE permission_key = 'leverage_profiles:edit';
