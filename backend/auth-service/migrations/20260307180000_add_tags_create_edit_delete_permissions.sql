-- Add tags:create, tags:edit, tags:delete under Tags category for Create/Edit/Delete tag actions.

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('tags:create', 'Create tags', 'a0000009-0000-0000-0000-000000000009', 2),
  ('tags:edit', 'Edit tags', 'a0000009-0000-0000-0000-000000000009', 3),
  ('tags:delete', 'Delete tags', 'a0000009-0000-0000-0000-000000000009', 4)
ON CONFLICT (permission_key) DO NOTHING;
