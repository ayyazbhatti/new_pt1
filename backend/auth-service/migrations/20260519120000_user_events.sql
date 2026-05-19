-- User events history (auth and future activity). Append-only audit stream for admin UI.

CREATE TABLE IF NOT EXISTS user_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  category        TEXT NOT NULL,
  ip              TEXT NULL,
  user_agent      TEXT NULL,
  meta            JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_events_subject_created
  ON user_events (subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_type_created
  ON user_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_created
  ON user_events (created_at DESC);

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('user_events:view', 'View user events history', 'a0000004-0000-0000-0000-000000000001', 10)
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO permission_profile_grants (profile_id, permission_key)
SELECT pp.id, 'user_events:view'
FROM permission_profiles pp
WHERE LOWER(pp.name) = 'full access'
ON CONFLICT (profile_id, permission_key) DO NOTHING;
