-- Add "Call" as a separate permission category (after Support) for the Call user page.

INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a0000011-0000-0000-0000-000000000011', 'Call', 17)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('call:view', 'Call user', 'a0000011-0000-0000-0000-000000000011', 1)
ON CONFLICT (permission_key) DO NOTHING;
