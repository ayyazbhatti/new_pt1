-- Add swap:create and swap:delete for full swap page feature.

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('swap:create', 'Create swap rules', 'a000000f-0000-0000-0000-00000000000f', 3),
  ('swap:delete', 'Delete swap rules', 'a000000f-0000-0000-0000-00000000000f', 4)
ON CONFLICT (permission_key) DO NOTHING;
