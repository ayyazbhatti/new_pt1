-- Admin call records: one row per call (admin-initiated call to user) for history and reporting.
CREATE TABLE IF NOT EXISTS admin_call_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL UNIQUE,
  admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'initiated',
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  ended_by TEXT,
  admin_display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_call_records_admin_user_id ON admin_call_records(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_call_records_user_id ON admin_call_records(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_call_records_initiated_at ON admin_call_records(initiated_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_call_records_status ON admin_call_records(status);

COMMENT ON TABLE admin_call_records IS 'Records of admin-to-user calls (initiate, answer, reject, end, timeout) for call history.';
