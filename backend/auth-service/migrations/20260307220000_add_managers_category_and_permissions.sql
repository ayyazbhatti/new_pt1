-- Add "Managers" permission category and managers:view, managers:create, managers:edit, managers:delete.

INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a000000a-0000-0000-0000-00000000000a', 'Managers', 10)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('managers:view', 'View managers', 'a000000a-0000-0000-0000-00000000000a', 1),
  ('managers:create', 'Create managers', 'a000000a-0000-0000-0000-00000000000a', 2),
  ('managers:edit', 'Edit managers', 'a000000a-0000-0000-0000-00000000000a', 3),
  ('managers:delete', 'Delete managers', 'a000000a-0000-0000-0000-00000000000a', 4)
ON CONFLICT (permission_key) DO NOTHING;
