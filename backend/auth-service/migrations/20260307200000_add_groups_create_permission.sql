-- Add groups:create for Create Group button (separate from Edit groups).

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('groups:create', 'Create groups', 'a0000008-0000-0000-0000-000000000008', 6)
ON CONFLICT (permission_key) DO NOTHING;
