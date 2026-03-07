-- Add finance:manual_adjustment for Manual Adjustment on Transactions page.

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('finance:manual_adjustment', 'Manual adjustment', 'a000000b-0000-0000-0000-00000000000b', 4)
ON CONFLICT (permission_key) DO NOTHING;
