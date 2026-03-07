-- Add "Appointments" as a separate permission category for the admin Appointments page.

INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a0000012-0000-0000-0000-000000000012', 'Appointments', 18)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('appointments:view', 'View and manage appointments', 'a0000012-0000-0000-0000-000000000012', 1)
ON CONFLICT (permission_key) DO NOTHING;
