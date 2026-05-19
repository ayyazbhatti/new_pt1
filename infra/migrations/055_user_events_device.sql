-- Device classification for user_events (mobile / tablet / desktop / bot / unknown).

ALTER TABLE user_events
  ADD COLUMN IF NOT EXISTS device_class TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS device_os TEXT NULL,
  ADD COLUMN IF NOT EXISTS device_browser TEXT NULL;

ALTER TABLE user_events DROP CONSTRAINT IF EXISTS user_events_device_class_check;
ALTER TABLE user_events ADD CONSTRAINT user_events_device_class_check
  CHECK (device_class IN ('mobile', 'tablet', 'desktop', 'bot', 'unknown'));

CREATE INDEX IF NOT EXISTS idx_user_events_device_class_created
  ON user_events (device_class, created_at DESC);

COMMENT ON COLUMN user_events.device_class IS 'Coarse device: mobile, tablet, desktop, bot, unknown (from User-Agent at insert)';
COMMENT ON COLUMN user_events.device_os IS 'Coarse OS name parsed from User-Agent';
COMMENT ON COLUMN user_events.device_browser IS 'Coarse browser name parsed from User-Agent';
