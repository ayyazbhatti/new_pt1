-- Bulk operations page: allow managers with users:bulk_create to access bulk user creation.
-- Users category id from create_permission_definitions / split_users_and_groups_categories.

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('users:bulk_create', 'Bulk create users', 'a0000004-0000-0000-0000-000000000004', 8)
ON CONFLICT (permission_key) DO NOTHING;
