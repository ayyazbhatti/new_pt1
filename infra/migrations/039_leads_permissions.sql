-- Re-add Leads permission category and permissions (removed in 025; required for admin/leads and profile validation).
-- Idempotent: ON CONFLICT DO NOTHING.

INSERT INTO permission_categories (id, name, sort_order)
SELECT 'a0000024-0000-0000-0000-000000000024', 'Leads', 20
WHERE NOT EXISTS (SELECT 1 FROM permission_categories WHERE LOWER(name) = 'leads');

INSERT INTO permissions (permission_key, label, category_id, sort_order)
SELECT k, l, (SELECT id FROM permission_categories WHERE LOWER(name) = 'leads' LIMIT 1), s
FROM (VALUES
  ('leads:view', 'View leads', 1),
  ('leads:create', 'Create leads', 2),
  ('leads:edit', 'Edit leads', 3),
  ('leads:convert', 'Convert leads', 4),
  ('leads:assign', 'Assign owner', 5),
  ('leads:delete', 'Delete leads', 6),
  ('leads:export', 'Export leads', 7)
) AS v(k, l, s)
ON CONFLICT (permission_key) DO NOTHING;
