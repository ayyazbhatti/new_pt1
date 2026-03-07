-- Add groups:delete, groups:symbol_settings, groups:price_profile for Groups page actions.

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('groups:delete', 'Delete groups', 'a0000008-0000-0000-0000-000000000008', 3),
  ('groups:symbol_settings', 'Symbol settings', 'a0000008-0000-0000-0000-000000000008', 4),
  ('groups:price_profile', 'Edit price profile', 'a0000008-0000-0000-0000-000000000008', 5)
ON CONFLICT (permission_key) DO NOTHING;
