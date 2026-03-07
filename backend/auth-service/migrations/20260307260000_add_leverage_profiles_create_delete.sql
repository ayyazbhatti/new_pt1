-- Add leverage_profiles:create and leverage_profiles:delete for full leverage profiles feature.

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('leverage_profiles:create', 'Create leverage profiles', 'a000000c-0000-0000-0000-00000000000c', 3),
  ('leverage_profiles:delete', 'Delete leverage profiles', 'a000000c-0000-0000-0000-00000000000c', 4)
ON CONFLICT (permission_key) DO NOTHING;
