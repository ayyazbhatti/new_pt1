-- When a notification was marked read (server-side persistence for PATCH mark-read)
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

COMMENT ON COLUMN notifications.read_at IS 'Set when read transitions to true via API or future paths.';
