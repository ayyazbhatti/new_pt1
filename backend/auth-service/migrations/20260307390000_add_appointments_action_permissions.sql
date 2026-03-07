-- Add separate permissions per action for Appointments (view already exists).

UPDATE permissions SET label = 'View appointments' WHERE permission_key = 'appointments:view';

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('appointments:create', 'Create appointments', 'a0000012-0000-0000-0000-000000000012', 2),
  ('appointments:edit', 'Edit appointments', 'a0000012-0000-0000-0000-000000000012', 3),
  ('appointments:delete', 'Delete appointments', 'a0000012-0000-0000-0000-000000000012', 4),
  ('appointments:reschedule', 'Reschedule appointments', 'a0000012-0000-0000-0000-000000000012', 5),
  ('appointments:cancel', 'Cancel appointments', 'a0000012-0000-0000-0000-000000000012', 6),
  ('appointments:complete', 'Complete appointments', 'a0000012-0000-0000-0000-000000000012', 7),
  ('appointments:send_reminder', 'Send reminder', 'a0000012-0000-0000-0000-000000000012', 8)
ON CONFLICT (permission_key) DO NOTHING;
