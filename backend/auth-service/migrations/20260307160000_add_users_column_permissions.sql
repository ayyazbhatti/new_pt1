-- Add 4 new permissions under Users category for the Users page column dropdowns.
-- They will appear in the Create/Edit permission profile popup under "Users".

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('users:edit_group', 'Assign user to group', 'a0000004-0000-0000-0000-000000000004', 4),
  ('users:edit_account_type', 'Edit account type', 'a0000004-0000-0000-0000-000000000004', 5),
  ('users:edit_margin', 'Edit margin calculation', 'a0000004-0000-0000-0000-000000000004', 6),
  ('users:edit_trading_access', 'Edit trading access', 'a0000004-0000-0000-0000-000000000004', 7)
ON CONFLICT (permission_key) DO NOTHING;
