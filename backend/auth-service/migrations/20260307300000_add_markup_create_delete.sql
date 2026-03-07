-- Add markup:create and markup:delete for full markup page feature.

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('markup:create', 'Create markup profiles', 'a000000e-0000-0000-0000-00000000000e', 3),
  ('markup:delete', 'Delete markup profiles', 'a000000e-0000-0000-0000-00000000000e', 4)
ON CONFLICT (permission_key) DO NOTHING;
