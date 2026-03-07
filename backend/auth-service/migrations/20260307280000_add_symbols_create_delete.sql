-- Add symbols:create and symbols:delete for full symbols page feature.

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('symbols:create', 'Create symbols', 'a000000d-0000-0000-0000-00000000000d', 3),
  ('symbols:delete', 'Delete symbols', 'a000000d-0000-0000-0000-00000000000d', 4)
ON CONFLICT (permission_key) DO NOTHING;
