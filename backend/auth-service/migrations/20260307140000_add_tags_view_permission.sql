-- Add tags:view permission so Tags page can be gated separately from Users page.
-- Place under "Other Admin" category.
INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('tags:view', 'View tags', 'a0000007-0000-0000-0000-000000000007', 11)
ON CONFLICT (permission_key) DO NOTHING;
