-- Ensure all permissions required for the Admin Users page and its column dropdowns exist.
-- Idempotent: ON CONFLICT DO NOTHING. Run after permission_categories and permissions exist
-- (e.g. after 20260307100000 and 20260307130000 split).
-- Users page: users:view, users:create, users:edit (Users category), groups:view, groups:edit (Groups category), tags:view (Other Admin).

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('users:view', 'View users', 'a0000004-0000-0000-0000-000000000004', 1),
  ('users:edit', 'Edit users', 'a0000004-0000-0000-0000-000000000004', 2),
  ('users:create', 'Create users', 'a0000004-0000-0000-0000-000000000004', 3),
  ('groups:view', 'View groups', 'a0000008-0000-0000-0000-000000000008', 1),
  ('groups:edit', 'Edit groups', 'a0000008-0000-0000-0000-000000000008', 2),
  ('tags:view', 'View tags', 'a0000007-0000-0000-0000-000000000007', 11)
ON CONFLICT (permission_key) DO NOTHING;
