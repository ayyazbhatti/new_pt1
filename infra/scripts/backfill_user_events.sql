-- One-time backfill: copy historical auth rows from audit_logs and user_sessions into user_events.
-- Idempotent: skips rows that already exist with same subject, event_type, and created_at.
-- Run: psql "$DATABASE_URL" -f infra/scripts/backfill_user_events.sql

-- From audit_logs (auth.register, auth.login, auth.logout)
INSERT INTO user_events (
  subject_user_id, actor_user_id, event_type, category, ip, user_agent, meta, created_at
)
SELECT
  al.actor_user_id,
  al.actor_user_id,
  al.action,
  'auth',
  NULLIF(TRIM(al.meta->>'ip'), ''),
  NULLIF(TRIM(al.meta->>'user_agent'), ''),
  COALESCE(al.meta, '{}'::jsonb),
  al.created_at
FROM audit_logs al
WHERE al.actor_user_id IS NOT NULL
  AND al.action IN ('auth.register', 'auth.login', 'auth.logout')
  AND NOT EXISTS (
    SELECT 1 FROM user_events ue
    WHERE ue.subject_user_id = al.actor_user_id
      AND ue.event_type = al.action
      AND ue.created_at = al.created_at
  );

-- From user_sessions (historical sessions as auth.session_created)
INSERT INTO user_events (
  subject_user_id, actor_user_id, event_type, category, ip, user_agent, meta, created_at
)
SELECT
  us.user_id,
  us.user_id,
  'auth.session_created',
  'auth',
  us.ip,
  us.user_agent,
  jsonb_build_object('session_id', us.id::text),
  us.created_at
FROM user_sessions us
WHERE NOT EXISTS (
  SELECT 1 FROM user_events ue
  WHERE ue.subject_user_id = us.user_id
    AND ue.event_type = 'auth.session_created'
    AND ue.created_at = us.created_at
);
