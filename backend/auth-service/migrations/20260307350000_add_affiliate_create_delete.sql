-- Add affiliate:create and affiliate:delete for full affiliate page feature.

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('affiliate:create', 'Create affiliate schemes', 'a0000010-0000-0000-0000-000000000010', 3),
  ('affiliate:delete', 'Delete affiliate schemes', 'a0000010-0000-0000-0000-000000000010', 4)
ON CONFLICT (permission_key) DO NOTHING;
