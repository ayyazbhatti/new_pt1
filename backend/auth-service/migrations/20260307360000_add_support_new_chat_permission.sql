-- Add support:new_chat for "New chat" button on Support page (start conversation with a user).

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('support:new_chat', 'New chat', 'a0000003-0000-0000-0000-000000000003', 3)
ON CONFLICT (permission_key) DO NOTHING;
