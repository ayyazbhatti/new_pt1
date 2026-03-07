-- Add admin trading page action permissions: create order, cancel order, close position, liquidate.

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('trading:create_order', 'Create order', 'a0000002-0000-0000-0000-000000000002', 3),
  ('trading:cancel_order', 'Cancel order', 'a0000002-0000-0000-0000-000000000002', 4),
  ('trading:close_position', 'Close position', 'a0000002-0000-0000-0000-000000000002', 5),
  ('trading:liquidate', 'Liquidate position', 'a0000002-0000-0000-0000-000000000002', 6)
ON CONFLICT (permission_key) DO NOTHING;
