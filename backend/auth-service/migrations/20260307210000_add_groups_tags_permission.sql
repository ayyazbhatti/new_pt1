-- Add groups:tags for Tags column on Groups page.

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('groups:tags', 'Tags', 'a0000008-0000-0000-0000-000000000008', 7)
ON CONFLICT (permission_key) DO NOTHING;
